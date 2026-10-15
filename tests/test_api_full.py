import os
os.environ["DEV_MODE"] = "true"
import pytest
from datetime import datetime, timezone, timedelta
from fastapi.testclient import TestClient
from sqlmodel import Session, select, create_engine, SQLModel
from sqlmodel.pool import StaticPool

from main import app
from db import get_session
from db_models import (
    User, Group, GroupMember, Invite, ExpenseDB, ExpensePayerDB,
    ExpenseSplitDB, PersonalDebtDB, SettlementTransactionDB, ChatMessageDB
)
from retention import cleanup_expired_groups

# Use StaticPool so sqlite:///:memory: is shared across all session instances in the test process
TEST_DATABASE_URL = "sqlite:///:memory:"
test_engine = create_engine(
    TEST_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool
)


def override_get_session():
    with Session(test_engine) as session:
        yield session


app.dependency_overrides[get_session] = override_get_session


@pytest.fixture(autouse=True)
def setup_database():
    SQLModel.metadata.create_all(test_engine)
    yield
    SQLModel.metadata.drop_all(test_engine)


client = TestClient(app)


def test_user_signup_and_me():
    # 1. Signup user1
    res = client.post("/auth/signup", json={"username": "alice", "email": "alice@example.com"})
    assert res.status_code == 200
    data = res.json()
    assert data["username"] == "alice"

    # 2. Duplicate username should fail
    dup_res = client.post("/auth/signup", json={"username": "alice", "email": "other@example.com"})
    assert dup_res.status_code == 400

    # 3. GET /auth/me with Dev Header
    me_res = client.get("/auth/me", headers={"X-Dev-Username": "alice"})
    assert me_res.status_code == 200
    assert me_res.json()["username"] == "alice"


def test_group_creation_and_invites():
    # Signup users
    client.post("/auth/signup", json={"username": "alice", "email": "alice@example.com"})
    client.post("/auth/signup", json={"username": "bob", "email": "bob@example.com"})

    # Alice creates a group
    res = client.post(
        "/groups",
        json={"name": "Goa Trip", "admin_upi_id": "alice@okaxis"},
        headers={"X-Dev-Username": "alice"}
    )
    assert res.status_code == 200
    group_id = res.json()["id"]

    # Check Alice is admin
    g_res = client.get(f"/groups/{group_id}", headers={"X-Dev-Username": "alice"})
    assert g_res.status_code == 200
    members = g_res.json()["members"]
    assert len(members) == 1
    assert members[0]["is_admin"] is True
    assert members[0]["name"] == "alice"

    # Alice invites Bob via username
    inv_user = client.post(
        f"/groups/{group_id}/invite",
        json={"method": "username", "username": "bob"},
        headers={"X-Dev-Username": "alice"}
    )
    assert inv_user.status_code == 200
    assert inv_user.json()["status"] == "added"

    # Alice creates a join link
    inv_link = client.post(
        f"/groups/{group_id}/invite",
        json={"method": "join_link"},
        headers={"X-Dev-Username": "alice"}
    )
    assert inv_link.status_code == 200
    join_token = inv_link.json()["join_token"]

    # Charlie signs up and joins via link
    client.post("/auth/signup", json={"username": "charlie", "email": "charlie@example.com"})
    join_res = client.post(f"/groups/join/{join_token}", headers={"X-Dev-Username": "charlie"})
    assert join_res.status_code == 200
    assert join_res.json()["status"] == "joined"

    # Alice invites David by email before David signs up
    inv_email = client.post(
        f"/groups/{group_id}/invite",
        json={"method": "email", "email": "david@example.com"},
        headers={"X-Dev-Username": "alice"}
    )
    assert inv_email.status_code == 200
    assert inv_email.json()["status"] == "pending_invite_created"

    # David signs up -> invite auto-claimed!
    client.post("/auth/signup", json={"username": "david", "email": "david@example.com"})
    
    # Check members in group now (Alice, Bob, Charlie, David = 4 members)
    g_res2 = client.get(f"/groups/{group_id}", headers={"X-Dev-Username": "david"})
    assert g_res2.status_code == 200
    assert len(g_res2.json()["members"]) == 4


def test_multi_payer_and_unequal_splits():
    # Setup Group with 3 members
    u1 = client.post("/auth/signup", json={"username": "m_alice", "email": "m_alice@example.com"}).json()
    u2 = client.post("/auth/signup", json={"username": "m_bob", "email": "m_bob@example.com"}).json()
    u3 = client.post("/auth/signup", json={"username": "m_charlie", "email": "m_charlie@example.com"}).json()

    g = client.post("/groups", json={"name": "Dinner Group"}, headers={"X-Dev-Username": "m_alice"}).json()
    g_id = g["id"]
    client.post(f"/groups/{g_id}/invite", json={"method": "username", "username": "m_bob"}, headers={"X-Dev-Username": "m_alice"})
    client.post(f"/groups/{g_id}/invite", json={"method": "username", "username": "m_charlie"}, headers={"X-Dev-Username": "m_alice"})

    g_info = client.get(f"/groups/{g_id}", headers={"X-Dev-Username": "m_alice"}).json()
    mem_map = {m["name"]: m["id"] for m in g_info["members"]}

    # 1. Multi-payer with Exact Split
    # Total Rs. 3000: Alice pays 2000, Bob pays 1000.
    # Split: Alice 1000, Bob 1000, Charlie 1000.
    exp_res = client.post(
        f"/groups/{g_id}/expenses",
        json={
            "description": "Grand Feast",
            "total_amount": 3000.0,
            "split_type": "exact",
            "paid_by": [
                {"member_id": mem_map["m_alice"], "amount_paid": 2000.0},
                {"member_id": mem_map["m_bob"], "amount_paid": 1000.0}
            ],
            "split_among": [
                {"member_id": mem_map["m_alice"], "amount": 1000.0},
                {"member_id": mem_map["m_bob"], "amount": 1000.0},
                {"member_id": mem_map["m_charlie"], "amount": 1000.0}
            ]
        },
        headers={"X-Dev-Username": "m_alice"}
    )
    assert exp_res.status_code == 200

    # 2. Percentage Split
    # Total Rs. 1000 paid by Alice (100%).
    # Split: Alice 50%, Bob 30%, Charlie 20%.
    pct_res = client.post(
        f"/groups/{g_id}/expenses",
        json={
            "description": "Dessert",
            "total_amount": 1000.0,
            "split_type": "percentage",
            "paid_by": [{"member_id": mem_map["m_alice"], "amount_paid": 1000.0}],
            "split_among": [
                {"member_id": mem_map["m_alice"], "percentage": 50.0},
                {"member_id": mem_map["m_bob"], "percentage": 30.0},
                {"member_id": mem_map["m_charlie"], "percentage": 20.0}
            ]
        },
        headers={"X-Dev-Username": "m_alice"}
    )
    assert pct_res.status_code == 200

    # 3. Personal IOU
    # Charlie owes Bob 100
    debt_res = client.post(
        f"/groups/{g_id}/debts",
        json={
            "from_member_id": mem_map["m_charlie"],
            "to_member_id": mem_map["m_bob"],
            "amount": 100.0,
            "note": "Coffee"
        },
        headers={"X-Dev-Username": "m_charlie"}
    )
    assert debt_res.status_code == 200

    # Verify Balances
    # Alice: (+2000 paid - 1000 share) + (+1000 paid - 500 share) = +1500
    # Bob: (+1000 paid - 1000 share) + (0 paid - 300 share) + (+100 IOU) = -200
    # Charlie: (0 paid - 1000 share) + (0 paid - 200 share) + (-100 IOU) = -1300
    bal_res = client.get(f"/groups/{g_id}/balances", headers={"X-Dev-Username": "m_alice"}).json()
    assert bal_res["m_alice"] == 1500.0
    assert bal_res["m_bob"] == -200.0
    assert bal_res["m_charlie"] == -1300.0


def test_settlement_lifecycle_confirmation_and_freeze():
    # Setup group
    client.post("/auth/signup", json={"username": "s_alice", "email": "s_alice@example.com"})
    client.post("/auth/signup", json={"username": "s_bob", "email": "s_bob@example.com"})

    g = client.post(
        "/groups",
        json={"name": "Settlement Group", "admin_upi_id": "alice@upi"},
        headers={"X-Dev-Username": "s_alice"}
    ).json()
    g_id = g["id"]
    client.post(f"/groups/{g_id}/invite", json={"method": "username", "username": "s_bob"}, headers={"X-Dev-Username": "s_alice"})

    g_info = client.get(f"/groups/{g_id}", headers={"X-Dev-Username": "s_alice"}).json()
    mem_map = {m["name"]: m["id"] for m in g_info["members"]}

    # Alice pays 500, split with Bob (Bob owes 250)
    client.post(
        f"/groups/{g_id}/expenses/equal",
        json={
            "description": "Lunch",
            "total_amount": 500.0,
            "paid_by": mem_map["s_alice"],
            "split_among": [mem_map["s_alice"], mem_map["s_bob"]]
        },
        headers={"X-Dev-Username": "s_alice"}
    )

    # Bob (non-admin) tries to trigger /settle -> 403 Forbidden!
    non_admin_settle = client.post(f"/groups/{g_id}/settle", headers={"X-Dev-Username": "s_bob"})
    assert non_admin_settle.status_code == 403

    # Alice (admin) triggers /settle -> 200 OK
    settle_res = client.post(f"/groups/{g_id}/settle", headers={"X-Dev-Username": "s_alice"})
    assert settle_res.status_code == 200
    plan = settle_res.json()["settlements"]
    assert len(plan) == 1
    tx = plan[0]
    assert tx["from_name"] == "s_bob"
    assert tx["to_name"] == "s_alice"
    assert tx["amount"] == 250.0
    assert tx["status"] == "pending"
    assert "upi://pay" in tx["upi_link"]

    # Verify group is FROZEN: cannot add new expenses or debts
    frozen_exp = client.post(
        f"/groups/{g_id}/expenses/equal",
        json={
            "description": "Late Snack",
            "total_amount": 100.0,
            "paid_by": mem_map["s_alice"],
            "split_among": [mem_map["s_alice"], mem_map["s_bob"]]
        },
        headers={"X-Dev-Username": "s_alice"}
    )
    assert frozen_exp.status_code == 400
    assert "frozen" in frozen_exp.json()["detail"].lower()

    # 1. Non-payer (Alice) tries to mark paid -> 403 Forbidden!
    bad_mark = client.post(f"/settlements/{tx['id']}/mark-paid", headers={"X-Dev-Username": "s_alice"})
    assert bad_mark.status_code == 403

    # 2. Designated payer (Bob) marks paid -> status becomes paid_pending_confirmation
    mark_res = client.post(f"/settlements/{tx['id']}/mark-paid", headers={"X-Dev-Username": "s_bob"})
    assert mark_res.status_code == 200
    assert mark_res.json()["status"] == "paid_pending_confirmation"

    # Try cancelling settlement while payment is in motion -> 400 Bad Request!
    cancel_fail = client.post(f"/groups/{g_id}/cancel-settlement", headers={"X-Dev-Username": "s_alice"})
    assert cancel_fail.status_code == 400

    # 3. Receiver (Alice) denies payment -> status resets back to pending
    deny_res = client.post(f"/settlements/{tx['id']}/deny", headers={"X-Dev-Username": "s_alice"})
    assert deny_res.status_code == 200
    assert deny_res.json()["status"] == "pending"

    # Now that all transactions are pending again, admin can cancel settlement!
    cancel_ok = client.post(f"/groups/{g_id}/cancel-settlement", headers={"X-Dev-Username": "s_alice"})
    assert cancel_ok.status_code == 200
    assert cancel_ok.json()["status"] == "success"

    # Group is reopened: adding expense works now!
    unfrozen_exp = client.post(
        f"/groups/{g_id}/expenses/equal",
        json={
            "description": "Second Lunch",
            "total_amount": 500.0,
            "paid_by": mem_map["s_alice"],
            "split_among": [mem_map["s_alice"], mem_map["s_bob"]]
        },
        headers={"X-Dev-Username": "s_alice"}
    )
    assert unfrozen_exp.status_code == 200

    # Re-run settlement (Total debt is now 250 + 250 = 500)
    settle_res2 = client.post(f"/groups/{g_id}/settle", headers={"X-Dev-Username": "s_alice"}).json()
    tx2 = settle_res2["settlements"][0]
    assert tx2["amount"] == 500.0

    # Complete the full confirmation cycle:
    client.post(f"/settlements/{tx2['id']}/mark-paid", headers={"X-Dev-Username": "s_bob"})
    confirm_res = client.post(f"/settlements/{tx2['id']}/confirm", headers={"X-Dev-Username": "s_alice"})
    assert confirm_res.status_code == 200
    assert confirm_res.json()["status"] == "confirmed"

    # Verify that trying to deny an already-confirmed transaction fails with 400
    deny_confirmed = client.post(f"/settlements/{tx2['id']}/deny", headers={"X-Dev-Username": "s_alice"})
    assert deny_confirmed.status_code == 400
    assert "not awaiting confirmation" in deny_confirmed.json()["detail"].lower()

    # Verify group is stamped as fully_settled_at
    g_final = client.get(f"/groups/{g_id}", headers={"X-Dev-Username": "s_alice"}).json()
    assert g_final["fully_settled_at"] is not None
    assert g_final["is_frozen"] is True


def test_group_chat_and_retention():
    # Setup group
    client.post("/auth/signup", json={"username": "c_alice", "email": "c_alice@example.com"})
    client.post("/auth/signup", json={"username": "c_bob", "email": "c_bob@example.com"})

    g = client.post("/groups", json={"name": "Chat Group"}, headers={"X-Dev-Username": "c_alice"}).json()
    g_id = g["id"]
    client.post(f"/groups/{g_id}/invite", json={"method": "username", "username": "c_bob"}, headers={"X-Dev-Username": "c_alice"})

    # Send chat messages
    m1 = client.post(f"/groups/{g_id}/chat", json={"body": "Hello group!"}, headers={"X-Dev-Username": "c_alice"})
    assert m1.status_code == 200
    assert m1.json()["sender_username"] == "c_alice"

    m2 = client.post(f"/groups/{g_id}/chat", json={"body": "Hey Alice!"}, headers={"X-Dev-Username": "c_bob"})
    assert m2.status_code == 200

    chat_hist = client.get(f"/groups/{g_id}/chat", headers={"X-Dev-Username": "c_alice"}).json()
    assert len(chat_hist["messages"]) == 2
    assert chat_hist["is_read_only"] is False

    # Simulate group reaching fully_settled_at
    with Session(test_engine) as session:
        grp = session.get(Group, g_id)
        grp.fully_settled_at = datetime.now(timezone.utc) - timedelta(days=8)  # 8 days ago
        session.add(grp)
        session.commit()

    # Chat should now be read-only (reject new messages)
    m3 = client.post(f"/groups/{g_id}/chat", json={"body": "Trying to post in closed chat"}, headers={"X-Dev-Username": "c_alice"})
    assert m3.status_code == 400
    assert "closed" in m3.json()["detail"].lower()

    # Retention job: cleans up groups settled > 7 days ago
    with Session(test_engine) as session:
        deleted = cleanup_expired_groups(session, retention_days=7)
        assert g_id in deleted

        # Verify group is completely deleted
        assert session.get(Group, g_id) is None
        # Verify messages are cleaned up
        assert len(session.exec(select(ChatMessageDB).where(ChatMessageDB.group_id == g_id)).all()) == 0


def test_user_search_no_email_leaked():
    """GET /users/search must never return an email field."""
    client.post("/auth/signup", json={"username": "searchable", "email": "secret@private.com"})
    # Another user searches for them
    client.post("/auth/signup", json={"username": "searcher", "email": "searcher@example.com"})

    res = client.get("/users/search?q=sea", headers={"X-Dev-Username": "searcher"})
    assert res.status_code == 200
    results = res.json()
    assert len(results) >= 1
    for r in results:
        assert "email" not in r, f"email field leaked in search result: {r}"
        assert "id" in r
        assert "username" in r


def test_user_search_wildcard_injection_safe():
    """q=%% must not bypass LIKE escaping and dump every user."""
    # Create 3 known users
    for name in ["wildcard_a", "wildcard_b", "wildcard_c"]:
        client.post("/auth/signup", json={"username": name, "email": f"{name}@test.com"})
    # One more user to act as the requester
    client.post("/auth/signup", json={"username": "requester", "email": "req@test.com"})

    # A bare %% without autoescape would match every row; with autoescape it should return 0
    res = client.get("/users/search?q=%%25%%25", headers={"X-Dev-Username": "requester"})
    assert res.status_code == 200
    # The literal string "%%25%%25" won't match any username — result should be empty
    assert res.json() == [], f"Expected empty, got {res.json()}"

    # Also try the raw double-percent in its URL-encoded form
    res2 = client.get("/users/search?q=%25%25", headers={"X-Dev-Username": "requester"})
    assert res2.status_code == 200
    assert res2.json() == [], f"Expected empty for q=%%, got {res2.json()}"


def test_username_validation_and_normalization():
    """
    Signup username rules:
    - Must be 3-20 chars, [a-z0-9_] only (after lowercasing)
    - Stored lowercase: "Avinay_123" -> "avinay_123"
    - Bad formats rejected: "avinay@123" (@ not allowed), too short, too long
    - Duplicate detection is case-insensitive
    """
    # Valid: mixed-case input stored as lowercase
    res = client.post("/auth/signup", json={"username": "Avinay_123", "email": "avinay@test.com"})
    assert res.status_code == 200, f"Expected 200, got {res.status_code}: {res.json()}"
    assert res.json()["username"] == "avinay_123", "Should be stored lowercase"

    # Valid: all-lowercase with underscore
    res2 = client.post("/auth/signup", json={"username": "avinay_xyz", "email": "xyz@test.com"})
    assert res2.status_code == 200

    # Invalid: @ character not allowed
    bad_at = client.post("/auth/signup", json={"username": "avinay@123", "email": "bad1@test.com"})
    assert bad_at.status_code == 422, f"Expected 422 for 'avinay@123', got {bad_at.status_code}"

    # Invalid: too short (< 3 chars)
    bad_short = client.post("/auth/signup", json={"username": "ab", "email": "bad2@test.com"})
    assert bad_short.status_code == 422, f"Expected 422 for 'ab', got {bad_short.status_code}"

    # Invalid: too long (> 20 chars)
    bad_long = client.post("/auth/signup", json={"username": "a" * 21, "email": "bad3@test.com"})
    assert bad_long.status_code == 422, f"Expected 422 for 21-char name, got {bad_long.status_code}"

    # Invalid: contains space
    bad_space = client.post("/auth/signup", json={"username": "hello world", "email": "bad4@test.com"})
    assert bad_space.status_code == 422

    # Duplicate: "AVINAY_123" must collide with already-stored "avinay_123"
    dup = client.post("/auth/signup", json={"username": "AVINAY_123", "email": "dup@test.com"})
    assert dup.status_code == 400
    assert "taken" in dup.json()["detail"].lower()


def test_username_invite_case_insensitive():
    """Username invites find users regardless of the case passed."""
    client.post("/auth/signup", json={"username": "grp_admin", "email": "grp_admin@test.com"})
    client.post("/auth/signup", json={"username": "target_user", "email": "target@test.com"})

    g = client.post("/groups", json={"name": "CI Group"}, headers={"X-Dev-Username": "grp_admin"}).json()
    gid = g["id"]

    # Invite using mixed-case — should still find "target_user"
    res = client.post(
        f"/groups/{gid}/invite",
        json={"method": "username", "username": "Target_User"},
        headers={"X-Dev-Username": "grp_admin"}
    )
    assert res.status_code == 200
    assert res.json()["status"] == "added"


def test_signup_blocked_outside_dev_mode(monkeypatch):
    """POST /auth/signup must return 403 when DEV_MODE is false."""
    import main
    monkeypatch.setattr(main, "DEV_MODE", False)

    res = client.post("/auth/signup", json={"username": "prod_user", "email": "prod@test.com"})
    assert res.status_code == 403
    assert "disabled" in res.json()["detail"].lower()


def test_firebase_token_verification_and_username_patch(monkeypatch):
    """
    Test suite for Firebase auto-provisioning:
    - First login auto-provisions user with username_confirmed=False
    - Duplicate email prefixes receive distinct disambiguated usernames
    - Pending email invite is automatically claimed on first login
    - Unverified email in token gets 403
    - Invalid token gets 401
    - PATCH /auth/me/username validates, checks uniqueness (409), sets username_confirmed=True, and blocks further changes
    """
    import auth
    from firebase_admin import auth as fb_auth

    # Ensure Firebase is considered initialized for test
    monkeypatch.setattr(auth, "_firebase_initialized", True)

    # 1. Unverified email gets 403
    def mock_verify_unverified(token):
        return {"uid": "fb_unverified", "email": "unverified@example.com", "email_verified": False}

    monkeypatch.setattr(fb_auth, "verify_id_token", mock_verify_unverified)
    res_unverified = client.get("/auth/me", headers={"Authorization": "Bearer token_unverified"})
    assert res_unverified.status_code == 403
    assert "not verified" in res_unverified.json()["detail"].lower()

    # 2. Invalid token gets 401
    def mock_verify_invalid(token):
        raise ValueError("Decoding Firebase ID token failed")

    monkeypatch.setattr(fb_auth, "verify_id_token", mock_verify_invalid)
    res_invalid = client.get("/auth/me", headers={"Authorization": "Bearer bad_token"})
    assert res_invalid.status_code == 401
    assert res_invalid.json()["detail"] == "Invalid or expired sign-in"

    # 3. Create a group and add a pending email invite for sam@example.com
    client.post("/auth/signup", json={"username": "host_user", "email": "host@test.com"})
    grp = client.post("/groups", json={"name": "Auto Claim Grp"}, headers={"X-Dev-Username": "host_user"}).json()
    gid = grp["id"]
    client.post(
        f"/groups/{gid}/invite",
        json={"method": "email", "email": "Sam@Example.com"},  # mixed case to verify lowercase invite storage
        headers={"X-Dev-Username": "host_user"}
    )

    # 4. User 1: sam@example.com logs in with verified token
    def mock_verify_sam(token):
        return {"uid": "fb_sam_1", "email": "sam@example.com", "email_verified": True}

    monkeypatch.setattr(fb_auth, "verify_id_token", mock_verify_sam)
    res_sam = client.get("/auth/me", headers={"Authorization": "Bearer token_sam"})
    assert res_sam.status_code == 200
    sam_data = res_sam.json()
    assert sam_data["email"] == "sam@example.com"
    assert sam_data["username"] == "sam"
    assert sam_data["username_confirmed"] is False
    # Invite should be claimed! User should be a member of the group now
    assert sam_data["group_count"] == 1

    # 5. User 2: second user with same email prefix (sam@another.com)
    def mock_verify_sam2(token):
        return {"uid": "fb_sam_2", "email": "sam@another.com", "email_verified": True}

    monkeypatch.setattr(fb_auth, "verify_id_token", mock_verify_sam2)
    res_sam2 = client.get("/auth/me", headers={"Authorization": "Bearer token_sam2"})
    assert res_sam2.status_code == 200
    sam2_data = res_sam2.json()
    assert sam2_data["email"] == "sam@another.com"
    assert sam2_data["username"] != sam_data["username"], "Must get disambiguated username"
    assert sam2_data["username_confirmed"] is False

    # 6. Username PATCH tests for User 1 (sam)
    monkeypatch.setattr(fb_auth, "verify_id_token", mock_verify_sam)

    # Reject invalid format (@ symbol)
    patch_bad = client.patch(
        "/auth/me/username",
        json={"username": "sam@pro"},
        headers={"Authorization": "Bearer token_sam"}
    )
    assert patch_bad.status_code == 422

    # Reject taken name (sam2's username)
    patch_taken = client.patch(
        "/auth/me/username",
        json={"username": sam2_data["username"]},
        headers={"Authorization": "Bearer token_sam"}
    )
    assert patch_taken.status_code == 409
    assert "taken" in patch_taken.json()["detail"].lower()

    # Successfully update to new unique username
    patch_ok = client.patch(
        "/auth/me/username",
        json={"username": "sam_prime"},
        headers={"Authorization": "Bearer token_sam"}
    )
    assert patch_ok.status_code == 200
    assert patch_ok.json()["username"] == "sam_prime"
    assert patch_ok.json()["username_confirmed"] is True

    # Block subsequent updates once confirmed
    patch_again = client.patch(
        "/auth/me/username",
        json={"username": "sam_changed_again"},
        headers={"Authorization": "Bearer token_sam"}
    )
    assert patch_again.status_code == 400
    assert "already been confirmed" in patch_again.json()["detail"].lower()


# ---------------------------------------------------------------------
# Round 1 bug fixes
# ---------------------------------------------------------------------

def _dev_user(name):
    client.post("/auth/signup", json={"username": name, "email": f"{name}@example.com"})
    return {"X-Dev-Username": name}


def test_balances_use_usernames_and_list_every_member():
    alice, bob = _dev_user("alice"), _dev_user("bob")
    _dev_user("carol")
    gid = client.post("/groups", json={"name": "T"}, headers=alice).json()["id"]
    client.post(f"/groups/{gid}/invite", json={"method": "username", "username": "bob"}, headers=alice)
    client.post(f"/groups/{gid}/invite", json={"method": "username", "username": "carol"}, headers=alice)

    # Empty group: keys must be usernames, not numeric member ids.
    empty = client.get(f"/groups/{gid}/balances", headers=alice).json()
    assert set(empty.keys()) == {"alice", "bob", "carol"}
    assert all(v == 0.0 for v in empty.values())

    # An expense that doesn't involve carol: she must still be listed, at 0.0.
    members = client.get(f"/groups/{gid}", headers=alice).json()["members"]
    ids = {m["name"]: m["member_id"] if "member_id" in m else m["id"] for m in members}
    res = client.post(
        f"/groups/{gid}/expenses/equal",
        json={"description": "Dinner", "total_amount": 100, "paid_by": ids["alice"],
              "split_among": [ids["alice"], ids["bob"]]},
        headers=alice,
    )
    assert res.status_code == 200, res.text
    after = client.get(f"/groups/{gid}/balances", headers=alice).json()
    assert set(after.keys()) == {"alice", "bob", "carol"}
    assert after["alice"] == 50.0 and after["bob"] == -50.0 and after["carol"] == 0.0


def test_database_failure_does_not_leak_internals():
    from sqlalchemy.exc import OperationalError

    def broken_session():
        raise OperationalError("SELECT secret_col FROM user WHERE firebase_uid = 'z0ZB...'", {}, Exception("boom"))
        yield  # pragma: no cover

    safe_client = TestClient(app, raise_server_exceptions=False)
    app.dependency_overrides[get_session] = broken_session
    try:
        res = safe_client.get("/auth/me", headers={"X-Dev-Username": "alice", "Origin": "http://localhost:5173"})
    finally:
        app.dependency_overrides[get_session] = override_get_session

    assert res.status_code == 500
    assert res.json() == {"detail": "Something went wrong"}
    body = res.text.lower()
    assert "select" not in body and "secret_col" not in body and "z0zb" not in body
    # CORS wraps the error handler, so the browser can read this response.
    assert "access-control-allow-origin" in res.headers


def test_database_error_is_not_reported_as_a_bad_token(monkeypatch):
    import auth
    from firebase_admin import auth as fb_auth

    monkeypatch.setattr(auth, "_firebase_initialized", True)
    monkeypatch.setattr(fb_auth, "verify_id_token",
                        lambda t: {"uid": "u1", "email": "u1@example.com", "email_verified": True})

    def explode(*a, **k):
        raise RuntimeError("SELECT * FROM user -- secret")

    monkeypatch.setattr(auth, "_provision_user", explode)
    safe_client = TestClient(app, raise_server_exceptions=False)
    res = safe_client.get("/auth/me", headers={"Authorization": "Bearer realish"})
    assert res.status_code == 500
    assert res.json() == {"detail": "Something went wrong"}


def test_bad_token_message_is_generic(monkeypatch):
    import auth
    from firebase_admin import auth as fb_auth

    monkeypatch.setattr(auth, "_firebase_initialized", True)

    def bad(token):
        raise ValueError("Token has wrong audience dept-settle-SECRET")

    monkeypatch.setattr(fb_auth, "verify_id_token", bad)
    res = client.get("/auth/me", headers={"Authorization": "Bearer nope"})
    assert res.status_code == 401
    assert res.json()["detail"] == "Invalid or expired sign-in"


def test_parallel_first_login_returns_the_same_user(monkeypatch):
    """Simulates two first-login requests racing: the loser must reuse the winner's user."""
    import auth

    with Session(test_engine) as s:
        winner = User(firebase_uid="race_uid", email="race@example.com", username="race", username_confirmed=False)
        s.add(winner)
        s.commit()
        s.refresh(winner)
        winner_id = winner.id

    real_find = auth._find_existing_user
    calls = {"n": 0}

    def find_misses_first_time(session, uid, email):
        calls["n"] += 1
        return None if calls["n"] == 1 else real_find(session, uid, email)

    monkeypatch.setattr(auth, "_find_existing_user", find_misses_first_time)
    with Session(test_engine) as s:
        user = auth._provision_user(s, "race_uid", "race@example.com")
        assert user.id == winner_id
    with Session(test_engine) as s:
        assert len(s.exec(select(User).where(User.firebase_uid == "race_uid")).all()) == 1


def test_joining_twice_creates_one_membership():
    alice, bob = _dev_user("alice"), _dev_user("bob")
    gid = client.post("/groups", json={"name": "J"}, headers=alice).json()["id"]
    token = client.post(f"/groups/{gid}/invite", json={"method": "join_link"}, headers=alice).json()["join_token"]

    first = client.post(f"/groups/join/{token}", headers=bob).json()
    second = client.post(f"/groups/join/{token}", headers=bob).json()
    assert first["status"] == "joined" and second["status"] == "already_member"
    assert first["member_id"] == second["member_id"]

    # The database itself must also refuse a duplicate membership.
    from sqlalchemy.exc import IntegrityError
    with Session(test_engine) as s:
        existing = s.exec(select(GroupMember).where(GroupMember.group_id == gid)).first()
        s.add(GroupMember(group_id=gid, user_id=existing.user_id))
        with pytest.raises(IntegrityError):
            s.commit()


def test_invites_are_idempotent():
    alice = _dev_user("alice")
    gid = client.post("/groups", json={"name": "I"}, headers=alice).json()["id"]
    a = client.post(f"/groups/{gid}/invite", json={"method": "email", "email": "Zed@Example.com"}, headers=alice).json()
    b = client.post(f"/groups/{gid}/invite", json={"method": "email", "email": "zed@example.com"}, headers=alice).json()
    assert a["invite_id"] == b["invite_id"]
    l1 = client.post(f"/groups/{gid}/invite", json={"method": "join_link"}, headers=alice).json()
    l2 = client.post(f"/groups/{gid}/invite", json={"method": "join_link"}, headers=alice).json()
    assert l1["join_token"] == l2["join_token"]


def test_username_claim_race_returns_409(monkeypatch):
    alice = _dev_user("alice")
    _dev_user("bob")
    # Make alice an unconfirmed (auto-provisioned style) user.
    with Session(test_engine) as s:
        u = s.exec(select(User).where(User.username == "alice")).first()
        u.username_confirmed = False
        s.add(u)
        s.commit()

    from sqlalchemy.exc import IntegrityError

    def commit_loses_race(self):
        raise IntegrityError("UPDATE user", {}, Exception("UNIQUE constraint failed: user.username"))

    monkeypatch.setattr(Session, "commit", commit_loses_race)
    res = client.patch("/auth/me/username", json={"username": "fresh_name"}, headers=alice)
    assert res.status_code == 409
    assert res.json()["detail"] == "Username is already taken"


def test_group_detail_reports_admin_flag_and_expense_count():
    alice, bob = _dev_user("alice"), _dev_user("bob")
    gid = client.post("/groups", json={"name": "D"}, headers=alice).json()["id"]
    client.post(f"/groups/{gid}/invite", json={"method": "username", "username": "bob"}, headers=alice)

    a = client.get(f"/groups/{gid}", headers=alice).json()
    b = client.get(f"/groups/{gid}", headers=bob).json()
    assert a["is_admin"] is True and b["is_admin"] is False
    assert a["expenses_count"] == 0

    ids = {m["name"]: m["id"] for m in a["members"]}
    client.post(f"/groups/{gid}/expenses/equal",
                json={"description": "x", "total_amount": 10, "paid_by": ids["alice"],
                      "split_among": [ids["alice"], ids["bob"]]}, headers=alice)
    assert client.get(f"/groups/{gid}", headers=alice).json()["expenses_count"] == 1
