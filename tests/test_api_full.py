import os
os.environ["DEV_MODE"] = "true"
os.environ["RATE_LIMIT_ENABLED"] = "false"
import pytest
from datetime import datetime, timezone, timedelta
from fastapi.testclient import TestClient
from sqlmodel import Session, select, create_engine, SQLModel
from sqlmodel.pool import StaticPool

from main import app
from db import get_session, normalize_database_url, sqlalchemy_database_url
from db_models import (
    User, Group, GroupMember, Invite, ExpenseDB, ExpensePayerDB,
    ExpenseSplitDB, PersonalDebtDB, SettlementTransactionDB, ChatMessageDB
)
from retention import cleanup_expired_groups

TEST_DATABASE_URL = normalize_database_url(os.getenv("TEST_DATABASE_URL", "sqlite:///:memory:"))
test_engine_kwargs = {}
if TEST_DATABASE_URL.startswith("sqlite"):
    test_engine_kwargs["connect_args"] = {"check_same_thread": False}
    if TEST_DATABASE_URL.endswith(":memory:"):
        test_engine_kwargs["poolclass"] = StaticPool
test_engine = create_engine(sqlalchemy_database_url(TEST_DATABASE_URL), **test_engine_kwargs)


def override_get_session():
    with Session(test_engine) as session:
        yield session


app.dependency_overrides[get_session] = override_get_session


@pytest.fixture(autouse=True)
def setup_database():
    SQLModel.metadata.drop_all(test_engine)
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
    assert me_res.json()["consented_at"] is None
    assert me_res.json()["consent_version"] is None


def test_health_endpoint_is_public():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_consent_records_version_and_timestamp():
    client.post("/auth/signup", json={"username": "consenting_user", "email": "consent@example.com"})

    consent = client.post(
        "/auth/me/consent",
        json={"version": "2026-10"},
        headers={"X-Dev-Username": "consenting_user"}
    )
    assert consent.status_code == 200
    assert consent.json()["consent_version"] == "2026-10"
    assert consent.json()["consented_at"] is not None

    profile = client.get("/auth/me", headers={"X-Dev-Username": "consenting_user"})
    assert profile.status_code == 200
    assert profile.json()["consent_version"] == "2026-10"
    assert profile.json()["consented_at"] == consent.json()["consented_at"]


def test_account_deletion_refuses_unconfirmed_settlement():
    client.post("/auth/signup", json={"username": "settlement_user", "email": "settlement_user@example.com"})
    client.post("/auth/signup", json={"username": "settlement_admin", "email": "settlement_admin@example.com"})
    group = client.post(
        "/groups",
        json={"name": "Unconfirmed Group"},
        headers={"X-Dev-Username": "settlement_admin"}
    ).json()
    group_id = group["id"]
    client.post(
        f"/groups/{group_id}/invite",
        json={"method": "username", "username": "settlement_user"},
        headers={"X-Dev-Username": "settlement_admin"}
    )
    members = client.get(
        f"/groups/{group_id}", headers={"X-Dev-Username": "settlement_admin"}
    ).json()["members"]
    member_ids = {member["name"]: member["id"] for member in members}
    with Session(test_engine) as session:
        session.add(SettlementTransactionDB(
            group_id=group_id,
            from_member_id=member_ids["settlement_user"],
            to_member_id=member_ids["settlement_admin"],
            amount=10,
            status="paid_pending_confirmation"
        ))
        session.commit()

    response = client.delete("/auth/me", headers={"X-Dev-Username": "settlement_user"})
    assert response.status_code == 400
    assert "unconfirmed" in response.json()["detail"].lower()


def test_account_deletion_refuses_admin_of_unsettled_group():
    client.post("/auth/signup", json={"username": "group_admin", "email": "group_admin@example.com"})
    client.post("/auth/signup", json={"username": "group_member", "email": "group_member@example.com"})
    group = client.post(
        "/groups",
        json={"name": "Admin Group"},
        headers={"X-Dev-Username": "group_admin"}
    ).json()
    client.post(
        f"/groups/{group['id']}/invite",
        json={"method": "username", "username": "group_member"},
        headers={"X-Dev-Username": "group_admin"}
    )

    response = client.delete("/auth/me", headers={"X-Dev-Username": "group_admin"})
    assert response.status_code == 400
    assert "administer" in response.json()["detail"].lower()


def test_account_deletion_firebase_failure_is_retryable_then_anonymizes(monkeypatch):
    import main

    client.post("/auth/signup", json={"username": "delete_user", "email": "delete@example.com"})
    group = client.post(
        "/groups",
        json={"name": "Delete Group", "admin_upi_id": "delete@upi"},
        headers={"X-Dev-Username": "delete_user"}
    ).json()
    client.post(
        f"/groups/{group['id']}/expenses/equal",
        json={
            "description": "Retained expense",
            "total_amount": 25,
            "paid_by": group["admin_member_id"],
            "split_among": [group["admin_member_id"]]
        },
        headers={"X-Dev-Username": "delete_user"}
    )
    client.post(
        f"/groups/{group['id']}/chat",
        json={"body": "Retained message"},
        headers={"X-Dev-Username": "delete_user"}
    )
    with Session(test_engine) as session:
        user = session.exec(select(User).where(User.username == "delete_user")).one()
        user.firebase_uid = "firebase-delete-uid"
        session.add(user)
        session.add(Invite(
            group_id=group["id"],
            method="email",
            invited_email="delete@example.com",
            status="pending"
        ))
        session.commit()
        user_id = user.id

    monkeypatch.setattr(main, "DEV_MODE", False)
    from firebase_admin import auth as fb_auth
    deleted_uids = []

    def fail_firebase_delete(uid):
        deleted_uids.append(uid)
        raise RuntimeError("Firebase unavailable")

    monkeypatch.setattr(fb_auth, "delete_user", fail_firebase_delete)
    failed = client.delete("/auth/me", headers={"X-Dev-Username": "delete_user"})
    assert failed.status_code == 502
    assert "no account data was changed" in failed.json()["detail"].lower()
    with Session(test_engine) as session:
        user = session.get(User, user_id)
        assert user.username == "delete_user"
        assert user.email == "delete@example.com"
        assert user.firebase_uid == "firebase-delete-uid"
        assert session.exec(select(Invite).where(Invite.invited_email == "delete@example.com")).first()
    assert deleted_uids == ["firebase-delete-uid"]

    monkeypatch.setattr(fb_auth, "delete_user", lambda uid: deleted_uids.append(uid))
    deleted = client.delete("/auth/me", headers={"X-Dev-Username": "delete_user"})
    assert deleted.status_code == 200
    assert deleted.json()["status"] == "deleted"
    assert deleted_uids == ["firebase-delete-uid", "firebase-delete-uid"]

    with Session(test_engine) as session:
        user = session.get(User, user_id)
        assert user.username == f"deleted_{user_id}"
        assert user.email == f"deleted_{user_id}@invalid.local"
        assert user.firebase_uid == f"deleted_{user_id}"
        membership = session.exec(
            select(GroupMember).where(GroupMember.user_id == user_id)
        ).one()
        assert membership.upi_id is None
        assert session.exec(select(Invite).where(Invite.invited_email == "delete@example.com")).first() is None
        assert session.get(Group, group["id"]) is not None
        assert session.exec(select(ExpenseDB).where(ExpenseDB.group_id == group["id"])).first() is not None
        assert session.exec(select(ChatMessageDB).where(ChatMessageDB.group_id == group["id"])).first() is not None


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


def test_member_upi_patch_is_self_scoped_and_validated():
    client.post("/auth/signup", json={"username": "upi_admin", "email": "upi_admin@example.com"})
    client.post("/auth/signup", json={"username": "upi_member", "email": "upi_member@example.com"})
    group = client.post(
        "/groups",
        json={"name": "UPI Group", "admin_upi_id": "admin@upi"},
        headers={"X-Dev-Username": "upi_admin"}
    ).json()
    group_id = group["id"]
    client.post(
        f"/groups/{group_id}/invite",
        json={"method": "username", "username": "upi_member"},
        headers={"X-Dev-Username": "upi_admin"}
    )

    valid = client.patch(
        f"/groups/{group_id}/members/me",
        json={"upi_id": "member.test-1@okAxis2"},
        headers={"X-Dev-Username": "upi_member"}
    )
    assert valid.status_code == 200
    assert valid.json()["upi_id"] == "member.test-1@okAxis2"

    invalid = client.patch(
        f"/groups/{group_id}/members/me",
        json={"upi_id": "bad@1"},
        headers={"X-Dev-Username": "upi_member"}
    )
    assert invalid.status_code == 422
    members = client.get(
        f"/groups/{group_id}", headers={"X-Dev-Username": "upi_admin"}
    ).json()["members"]
    assert next(member for member in members if member["name"] == "upi_admin")["upi_id"] == "admin@upi"

    cleared = client.patch(
        f"/groups/{group_id}/members/me",
        json={"upi_id": ""},
        headers={"X-Dev-Username": "upi_member"}
    )
    assert cleared.status_code == 200
    assert cleared.json()["upi_id"] is None

    client.patch(
        f"/groups/{group_id}/members/me",
        json={"upi_id": "member@upi"},
        headers={"X-Dev-Username": "upi_member"}
    )
    cleared_with_null = client.patch(
        f"/groups/{group_id}/members/me",
        json={"upi_id": None},
        headers={"X-Dev-Username": "upi_member"}
    )
    assert cleared_with_null.status_code == 200
    assert cleared_with_null.json()["upi_id"] is None

    not_a_member = client.patch(
        f"/groups/{group_id}/members/me",
        json={"upi_id": "outsider@upi"},
        headers={"X-Dev-Username": "upi_outsider"}
    )
    assert not_a_member.status_code == 403


def test_member_upi_patch_accepts_mobile_number_and_rejects_invalid_numbers():
    client.post("/auth/signup", json={"username": "mobile_admin", "email": "mobile_admin@example.com"})
    group = client.post(
        "/groups",
        json={"name": "Mobile UPI Group"},
        headers={"X-Dev-Username": "mobile_admin"}
    ).json()
    group_id = group["id"]
    valid = client.patch(
        f"/groups/{group_id}/members/me",
        json={"upi_id": "9876543210"},
        headers={"X-Dev-Username": "mobile_admin"}
    )
    assert valid.status_code == 200
    assert valid.json()["upi_id"] == "9876543210"

    for invalid_number in ("987654321", "98765432109", "5876543210", "abc1234567"):
        response = client.patch(
            f"/groups/{group_id}/members/me",
            json={"upi_id": invalid_number},
            headers={"X-Dev-Username": "mobile_admin"}
        )
        assert response.status_code == 422
        assert response.json()["detail"] == (
            "Enter a valid UPI ID (like name@bank) or a 10-digit mobile number"
        )

    normal_upi = client.patch(
        f"/groups/{group_id}/members/me",
        json={"upi_id": "mobile_admin@okaxis"},
        headers={"X-Dev-Username": "mobile_admin"}
    )
    assert normal_upi.status_code == 200
    assert normal_upi.json()["upi_id"] == "mobile_admin@okaxis"


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
    assert tx["to_upi_id"] == "alice@upi"
    assert tx["upi_link"].startswith("upi://pay?pa=alice%40upi&")
    assert "am=250.00" in tx["upi_link"]
    assert "cu=INR" in tx["upi_link"]

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


def test_pending_payment_confirmation_counts_in_group_and_list():
    usernames = ("badge_owner", "badge_payer1", "badge_payer2")
    for username in usernames:
        assert client.post(
            "/auth/signup",
            json={"username": username, "email": f"{username}@example.com"}
        ).status_code == 200

    receiver_headers = {"X-Dev-Username": "badge_owner"}
    group = client.post(
        "/groups",
        json={"name": "Payment Badge"},
        headers=receiver_headers
    ).json()
    group_id = group["id"]
    for payer in usernames[1:]:
        assert client.post(
            f"/groups/{group_id}/invite",
            json={"method": "username", "username": payer},
            headers=receiver_headers
        ).status_code == 200

    group_data = client.get(f"/groups/{group_id}", headers=receiver_headers).json()
    member_ids = {member["name"]: member["id"] for member in group_data["members"]}
    expense = client.post(
        f"/groups/{group_id}/expenses/equal",
        json={
            "description": "Shared expense",
            "total_amount": 100,
            "paid_by": member_ids["badge_owner"],
            "split_among": list(member_ids.values())
        },
        headers=receiver_headers
    )
    assert expense.status_code == 200

    settlements = client.post(
        f"/groups/{group_id}/settle",
        headers=receiver_headers
    ).json()["settlements"]
    assert len(settlements) == 2
    assert all(tx["to_member_id"] == member_ids["badge_owner"] for tx in settlements)

    payer_headers_by_member = {
        member_ids[username]: {"X-Dev-Username": username}
        for username in usernames[1:]
    }
    assert client.post(
        f"/settlements/{settlements[0]['id']}/mark-paid",
        headers=payer_headers_by_member[settlements[0]["from_member_id"]]
    ).status_code == 200

    detail = client.get(f"/groups/{group_id}", headers=receiver_headers).json()
    listed = next(
        group for group in client.get("/groups", headers=receiver_headers).json()
        if group["id"] == group_id
    )
    assert detail["pending_confirmation_count"] == 1
    assert listed["pending_confirmation_count"] == 1
    assert listed["unread_total_count"] == (
        listed["unread_chat_count"]
        + listed["unread_expense_count"]
        + listed["unread_member_count"]
        + 1
    )

    first_payer = settlements[0]["from_member_id"]
    assert client.get(
        f"/groups/{group_id}",
        headers=payer_headers_by_member[first_payer]
    ).json()["pending_confirmation_count"] == 0

    assert client.post(
        f"/settlements/{settlements[1]['id']}/mark-paid",
        headers=payer_headers_by_member[settlements[1]["from_member_id"]]
    ).status_code == 200
    assert client.get(f"/groups/{group_id}", headers=receiver_headers).json()[
        "pending_confirmation_count"
    ] == 2

    assert client.post(
        f"/settlements/{settlements[0]['id']}/confirm",
        headers=receiver_headers
    ).status_code == 200
    assert client.get(f"/groups/{group_id}", headers=receiver_headers).json()[
        "pending_confirmation_count"
    ] == 1
    assert client.post(
        f"/settlements/{settlements[1]['id']}/confirm",
        headers=receiver_headers
    ).status_code == 200
    assert client.get(f"/groups/{group_id}", headers=receiver_headers).json()[
        "pending_confirmation_count"
    ] == 0


def test_settlement_payload_uses_bare_link_without_receiver_upi():
    client.post("/auth/signup", json={"username": "bare_admin", "email": "bare_admin@example.com"})
    client.post("/auth/signup", json={"username": "bare_member", "email": "bare_member@example.com"})
    group = client.post(
        "/groups",
        json={"name": "Bare UPI Group"},
        headers={"X-Dev-Username": "bare_admin"}
    ).json()
    group_id = group["id"]
    client.post(
        f"/groups/{group_id}/invite",
        json={"method": "username", "username": "bare_member"},
        headers={"X-Dev-Username": "bare_admin"}
    )
    members = client.get(
        f"/groups/{group_id}", headers={"X-Dev-Username": "bare_admin"}
    ).json()["members"]
    member_ids = {member["name"]: member["id"] for member in members}

    expense = client.post(
        f"/groups/{group_id}/expenses/equal",
        json={
            "description": "Meal",
            "total_amount": 100,
            "paid_by": member_ids["bare_admin"],
            "split_among": [member_ids["bare_admin"], member_ids["bare_member"]]
        },
        headers={"X-Dev-Username": "bare_admin"}
    )
    assert expense.status_code == 200
    settlements = client.post(
        f"/groups/{group_id}/settle",
        headers={"X-Dev-Username": "bare_admin"}
    ).json()["settlements"]
    assert len(settlements) == 1
    assert settlements[0]["to_upi_id"] is None
    assert settlements[0]["upi_link"] == "upi://pay"
    assert settlements[0]["to_upi_is_number"] is False


def test_settlement_payload_for_mobile_receiver_has_no_upi_link():
    group_id, admin_headers, _ = _create_unread_chat_group("mobile_settle")
    group = client.get(f"/groups/{group_id}", headers=admin_headers).json()
    member_ids = {member["name"]: member["id"] for member in group["members"]}
    receiver_upi = client.patch(
        f"/groups/{group_id}/members/me",
        json={"upi_id": "9876543210"},
        headers=admin_headers
    )
    assert receiver_upi.status_code == 200
    expense = client.post(
        f"/groups/{group_id}/expenses/equal",
        json={
            "description": "Mobile settlement expense",
            "total_amount": 100,
            "paid_by": member_ids["mobile_settle_admin"],
            "split_among": list(member_ids.values())
        },
        headers=admin_headers
    )
    assert expense.status_code == 200

    settlements = client.post(f"/groups/{group_id}/settle", headers=admin_headers).json()["settlements"]
    assert len(settlements) == 1
    assert settlements[0]["to_upi_id"] == "9876543210"
    assert settlements[0]["upi_link"] is None
    assert settlements[0]["to_upi_is_number"] is True


def test_settlement_payload_for_upi_id_keeps_link():
    group_id, admin_headers, _ = _create_unread_chat_group("upi_settle")
    group = client.get(f"/groups/{group_id}", headers=admin_headers).json()
    member_ids = {member["name"]: member["id"] for member in group["members"]}
    receiver_upi = client.patch(
        f"/groups/{group_id}/members/me",
        json={"upi_id": "upi_settle@okaxis"},
        headers=admin_headers
    )
    assert receiver_upi.status_code == 200
    expense = client.post(
        f"/groups/{group_id}/expenses/equal",
        json={
            "description": "UPI settlement expense",
            "total_amount": 100,
            "paid_by": member_ids["upi_settle_admin"],
            "split_among": list(member_ids.values())
        },
        headers=admin_headers
    )
    assert expense.status_code == 200

    settlements = client.post(f"/groups/{group_id}/settle", headers=admin_headers).json()["settlements"]
    assert len(settlements) == 1
    assert settlements[0]["to_upi_id"] == "upi_settle@okaxis"
    assert settlements[0]["upi_link"].startswith("upi://pay?pa=upi_settle%40okaxis&")
    assert settlements[0]["to_upi_is_number"] is False


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


def test_chat_rejects_messages_over_2000_characters():
    group_id, admin_headers, _ = _create_unread_chat_group("chat_length")
    response = client.post(
        f"/groups/{group_id}/chat",
        json={"body": "x" * 2001},
        headers=admin_headers
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "Message is too long (max 2000 characters)"


def test_chat_replies_are_embedded_and_original_text_is_truncated():
    group_id, admin_headers, member_headers = _create_unread_chat_group("chat_reply")
    original = client.post(
        f"/groups/{group_id}/chat",
        json={"body": "original " * 20},
        headers=member_headers
    ).json()
    plain = client.post(
        f"/groups/{group_id}/chat",
        json={"body": "plain message"},
        headers=admin_headers
    ).json()
    reply = client.post(
        f"/groups/{group_id}/chat",
        json={"body": "reply", "reply_to_id": original["id"]},
        headers=admin_headers
    )

    assert reply.status_code == 200
    assert reply.json()["reply_to_id"] == original["id"]
    assert reply.json()["reply_to"] == {
        "id": original["id"],
        "sender_username": "chat_reply_member",
        "body": original["body"][:120] + "..."
    }

    history = client.get(f"/groups/{group_id}/chat", headers=admin_headers).json()["messages"]
    assert history[1]["reply_to_id"] is None
    assert history[1]["reply_to"] is None
    assert history[2]["reply_to_id"] == original["id"]
    assert history[2]["reply_to"]["sender_username"] == "chat_reply_member"
    assert len(history[2]["reply_to"]["body"]) <= 123
    assert history[2]["reply_to"]["body"].endswith("...")
    assert plain["id"] == history[1]["id"]


def test_chat_replies_reject_missing_or_other_group_messages():
    group_id, admin_headers, _ = _create_unread_chat_group("replyscope")
    other_group = client.post(
        "/groups",
        json={"name": "Other Chat Group"},
        headers=admin_headers
    ).json()
    other_message = client.post(
        f"/groups/{other_group['id']}/chat",
        json={"body": "private to another group"},
        headers=admin_headers
    ).json()

    for reply_to_id in (other_message["id"], 999999):
        response = client.post(
            f"/groups/{group_id}/chat",
            json={"body": "invalid reply", "reply_to_id": reply_to_id},
            headers=admin_headers
        )
        assert response.status_code == 400
        assert response.json()["detail"] == "Cannot reply to that message"


def _create_unread_chat_group(group_name):
    admin_name = f"{group_name}_admin"
    member_name = f"{group_name}_member"
    assert client.post(
        "/auth/signup",
        json={"username": admin_name, "email": f"{admin_name}@example.com"}
    ).status_code == 200
    assert client.post(
        "/auth/signup",
        json={"username": member_name, "email": f"{member_name}@example.com"}
    ).status_code == 200
    admin_headers = {"X-Dev-Username": admin_name}
    member_headers = {"X-Dev-Username": member_name}
    group = client.post("/groups", json={"name": group_name}, headers=admin_headers).json()
    assert client.post(
        f"/groups/{group['id']}/invite",
        json={"method": "username", "username": member_name},
        headers=admin_headers
    ).status_code == 200
    return group["id"], admin_headers, member_headers


def test_unread_chat_count_excludes_sender():
    group_id, admin_headers, member_headers = _create_unread_chat_group("unread_count")
    assert client.get(f"/groups/{group_id}", headers=admin_headers).json()["unread_chat_count"] == 0
    assert client.get(f"/groups/{group_id}", headers=member_headers).json()["unread_chat_count"] == 0

    sent = client.post(
        f"/groups/{group_id}/chat",
        json={"body": "Unread test"},
        headers=admin_headers
    )
    assert sent.status_code == 200
    assert client.get(f"/groups/{group_id}", headers=admin_headers).json()["unread_chat_count"] == 0
    assert client.get(f"/groups/{group_id}", headers=member_headers).json()["unread_chat_count"] == 1


def test_marking_chat_read_clears_only_member_count():
    group_id, admin_headers, member_headers = _create_unread_chat_group("mark_read")
    assert client.get(f"/groups/{group_id}", headers=admin_headers).json()["unread_chat_count"] == 0
    assert client.get(f"/groups/{group_id}", headers=member_headers).json()["unread_chat_count"] == 0
    sent = client.post(
        f"/groups/{group_id}/chat",
        json={"body": "Mark-read test"},
        headers=admin_headers
    )
    assert sent.status_code == 200
    assert client.get(f"/groups/{group_id}", headers=member_headers).json()["unread_chat_count"] == 1

    marked = client.post(f"/groups/{group_id}/chat/read", headers=member_headers)
    assert marked.status_code == 200
    assert marked.json() == {"unread_chat_count": 0}
    assert client.get(f"/groups/{group_id}", headers=member_headers).json()["unread_chat_count"] == 0
    assert client.get(f"/groups/{group_id}", headers=admin_headers).json()["unread_chat_count"] == 0


def test_non_member_cannot_mark_group_chat_read():
    group_id, _, _ = _create_unread_chat_group("nonmember")
    client.post("/auth/signup", json={"username": "unread_outsider", "email": "unread_outsider@example.com"})

    response = client.post(
        f"/groups/{group_id}/chat/read",
        headers={"X-Dev-Username": "unread_outsider"}
    )
    assert response.status_code == 403


def test_new_member_starts_with_no_unread_old_messages():
    group_id, admin_headers, _ = _create_unread_chat_group("newchat")
    assert client.get(f"/groups/{group_id}", headers=admin_headers).status_code == 200
    sent = client.post(
        f"/groups/{group_id}/chat",
        json={"body": "Old message"},
        headers=admin_headers
    )
    assert sent.status_code == 200
    client.post("/auth/signup", json={"username": "unread_later", "email": "unread_later@example.com"})
    joined = client.post(
        f"/groups/{group_id}/invite",
        json={"method": "username", "username": "unread_later"},
        headers=admin_headers
    )
    assert joined.status_code == 200

    response = client.get(
        f"/groups/{group_id}",
        headers={"X-Dev-Username": "unread_later"}
    )
    assert response.status_code == 200
    assert response.json()["unread_chat_count"] == 0


def test_chat_read_endpoint_works_for_fully_settled_group():
    group_id, admin_headers, member_headers = _create_unread_chat_group("settled_chat")
    client.get(f"/groups/{group_id}", headers=member_headers)
    sent = client.post(
        f"/groups/{group_id}/chat",
        json={"body": "Read-only chat message"},
        headers=admin_headers
    )
    assert sent.status_code == 200
    with Session(test_engine) as session:
        group = session.get(Group, group_id)
        group.fully_settled_at = datetime.now(timezone.utc)
        session.add(group)
        session.commit()

    response = client.post(f"/groups/{group_id}/chat/read", headers=member_headers)
    assert response.status_code == 200, response.text
    assert response.json() == {"unread_chat_count": 0}
    assert client.get(f"/groups/{group_id}", headers=member_headers).json()["unread_chat_count"] == 0


def test_group_list_includes_unread_chat_count():
    group_id, admin_headers, member_headers = _create_unread_chat_group("unread_list")
    assert client.get("/groups", headers=member_headers).json()[0]["unread_chat_count"] == 0
    sent = client.post(
        f"/groups/{group_id}/chat",
        json={"body": "List unread message"},
        headers=admin_headers
    )
    assert sent.status_code == 200

    groups = client.get("/groups", headers=member_headers)
    assert groups.status_code == 200
    assert groups.json()[0]["unread_chat_count"] == 1


def test_retention_deletes_group_settled_eight_days_ago():
    with Session(test_engine) as session:
        group = Group(
            name="Eight Day Old Group",
            fully_settled_at=datetime.now(timezone.utc) - timedelta(days=8)
        )
        session.add(group)
        session.commit()
        session.refresh(group)
        group_id = group.id

        deleted = cleanup_expired_groups(session, retention_days=7)

        assert group_id in deleted
        assert session.get(Group, group_id) is None


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


def test_rate_limit_returns_429_on_request_burst(monkeypatch):
    import main

    monkeypatch.setattr(main.limiter, "enabled", True)
    responses = [
        client.post(
            "/auth/signup",
            json={"username": f"burst_{index}", "email": f"burst_{index}@example.com"}
        )
        for index in range(21)
    ]
    assert all(response.status_code == 200 for response in responses[:20])
    assert responses[20].status_code == 429


def test_rate_limit_per_person_and_isolation(monkeypatch):
    """
    Prompt 2A-1b:
    - Two different users from the same IP don't share a limit.
    - One user exceeding 60 searches gets 429 while another user doesn't.
    - One admin can send 25 invites within a minute (limit is 60/min).
    """
    import main

    monkeypatch.setattr(main.limiter, "enabled", True)

    user_a = {"X-Dev-Username": "rate_user_a"}
    user_b = {"X-Dev-Username": "rate_user_b"}

    # 1 & 2: User A does 60 searches and hits 429 on the 61st, while User B is unaffected
    for _ in range(60):
        res = client.get("/users/search?q=test", headers=user_a)
        assert res.status_code == 200

    res_a_61 = client.get("/users/search?q=test", headers=user_a)
    assert res_a_61.status_code == 429

    # User B from the same client IP has separate rate limit and succeeds
    res_b = client.get("/users/search?q=test", headers=user_b)
    assert res_b.status_code == 200

    # 3: Admin sending 25 invites within a minute succeeds without 429
    admin = {"X-Dev-Username": "rate_admin"}
    group = client.post("/groups", json={"name": "Rate Limit Test Group"}, headers=admin).json()
    gid = group["id"]

    for i in range(25):
        inv_res = client.post(
            f"/groups/{gid}/invite",
            json={"method": "email", "email": f"rl_invite_{i}@example.com"},
            headers=admin
        )
        assert inv_res.status_code == 200


def test_account_deletion_refuses_non_zero_balance_and_allows_at_zero():
    """
    Prompt 2A-1b:
    Deletion is refused for a user with a non-zero balance and allowed at zero.
    """
    admin = {"X-Dev-Username": "del_admin"}
    debtor = {"X-Dev-Username": "del_debtor"}

    group = client.post("/groups", json={"name": "Bal Group"}, headers=admin).json()
    gid = group["id"]
    admin_mid = group["admin_member_id"]

    # Create debtor user first
    client.post("/auth/signup", json={"username": "del_debtor", "email": "del_debtor@example.com"})

    # Add debtor
    inv = client.post(f"/groups/{gid}/invite", json={"method": "username", "username": "del_debtor"}, headers=admin).json()
    debtor_mid = inv["member_id"]

    # Expense: admin paid 100, split between admin and debtor
    client.post(
        f"/groups/{gid}/expenses/equal",
        json={
            "description": "Lunch",
            "total_amount": 100,
            "paid_by": admin_mid,
            "split_among": [admin_mid, debtor_mid]
        },
        headers=admin
    )

    # Debtor has non-zero balance (-50.0) -> deletion refused with 400
    res = client.delete("/auth/me", headers=debtor)
    assert res.status_code == 400
    assert "Settle up before deleting your account" in res.json()["detail"]

    # Debtor balances the account: debtor pays 50 for admin's share
    client.post(
        f"/groups/{gid}/expenses/equal",
        json={
            "description": "Settling lunch",
            "total_amount": 50,
            "paid_by": debtor_mid,
            "split_among": [admin_mid]
        },
        headers=debtor
    )

    # Now debtor has 0.0 net balance -> deletion allowed
    res_ok = client.delete("/auth/me", headers=debtor)
    assert res_ok.status_code == 200
    assert res_ok.json()["status"] == "deleted"



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


def test_expense_unread_counts_for_equal_and_general_endpoints():
    group_id, admin_headers, member_headers = _create_unread_chat_group("exp_track")
    group = client.get(f"/groups/{group_id}", headers=admin_headers).json()
    client.get(f"/groups/{group_id}", headers=member_headers)
    admin_member_id = next(member["id"] for member in group["members"] if member["name"] == "exp_track_admin")
    member_id = next(member["id"] for member in group["members"] if member["name"] == "exp_track_member")

    equal = client.post(
        f"/groups/{group_id}/expenses/equal",
        json={
            "description": "Equal expense",
            "total_amount": 20,
            "paid_by": admin_member_id,
            "split_among": [admin_member_id, member_id]
        },
        headers=admin_headers
    )
    assert equal.status_code == 200
    admin_counts = client.get(f"/groups/{group_id}", headers=admin_headers).json()
    member_counts = client.get(f"/groups/{group_id}", headers=member_headers).json()
    assert admin_counts["unread_expense_count"] == 0
    assert member_counts["unread_expense_count"] == 1

    cleared = client.post(
        f"/groups/{group_id}/seen",
        json={"section": "expenses"},
        headers=member_headers
    )
    assert cleared.status_code == 200
    assert client.get(f"/groups/{group_id}", headers=member_headers).json()["unread_expense_count"] == 0

    general = client.post(
        f"/groups/{group_id}/expenses",
        json={
            "description": "General expense",
            "total_amount": 30,
            "split_type": "equal",
            "paid_by": [{"member_id": admin_member_id, "amount_paid": 30}],
            "split_among": [{"member_id": admin_member_id}, {"member_id": member_id}]
        },
        headers=admin_headers
    )
    assert general.status_code == 200
    admin_counts = client.get(f"/groups/{group_id}", headers=admin_headers).json()
    member_counts = client.get(f"/groups/{group_id}", headers=member_headers).json()
    assert admin_counts["unread_expense_count"] == 0
    assert member_counts["unread_expense_count"] == 1


def test_new_member_unread_count_and_seen_clears_members():
    group_id, admin_headers, member_headers = _create_unread_chat_group("member_track")
    client.get(f"/groups/{group_id}", headers=admin_headers)
    client.get(f"/groups/{group_id}", headers=member_headers)
    client.post("/auth/signup", json={"username": "member_c", "email": "member_c@example.com"})
    joined = client.post(
        f"/groups/{group_id}/invite",
        json={"method": "username", "username": "member_c"},
        headers=admin_headers
    )
    assert joined.status_code == 200

    admin_data = client.get(f"/groups/{group_id}", headers=admin_headers).json()
    member_data = client.get(f"/groups/{group_id}", headers=member_headers).json()
    new_member_data = client.get(
        f"/groups/{group_id}",
        headers={"X-Dev-Username": "member_c"}
    ).json()
    assert admin_data["unread_member_count"] == 1
    assert member_data["unread_member_count"] == 1
    assert new_member_data["unread_member_count"] == 0

    cleared = client.post(
        f"/groups/{group_id}/seen",
        json={"section": "members"},
        headers=admin_headers
    )
    assert cleared.status_code == 200
    assert client.get(f"/groups/{group_id}", headers=admin_headers).json()["unread_member_count"] == 0
    assert client.get(f"/groups/{group_id}", headers=member_headers).json()["unread_member_count"] == 1


def test_new_member_starts_with_zero_unread_counts_after_old_data():
    group_id, admin_headers, member_headers = _create_unread_chat_group("old_data")
    group = client.get(f"/groups/{group_id}", headers=admin_headers).json()
    client.get(f"/groups/{group_id}", headers=member_headers)
    admin_member_id = next(member["id"] for member in group["members"] if member["name"] == "old_data_admin")
    member_id = next(member["id"] for member in group["members"] if member["name"] == "old_data_member")

    client.post(
        f"/groups/{group_id}/expenses/equal",
        json={
            "description": "Old expense",
            "total_amount": 20,
            "paid_by": admin_member_id,
            "split_among": [admin_member_id, member_id]
        },
        headers=admin_headers
    )
    client.post(f"/groups/{group_id}/chat", json={"body": "Old chat"}, headers=admin_headers)
    client.post("/auth/signup", json={"username": "old_data_c", "email": "old_data_c@example.com"})
    joined = client.post(
        f"/groups/{group_id}/invite",
        json={"method": "username", "username": "old_data_c"},
        headers=admin_headers
    )
    assert joined.status_code == 200

    response = client.get(
        f"/groups/{group_id}",
        headers={"X-Dev-Username": "old_data_c"}
    )
    assert response.status_code == 200
    assert response.json()["unread_chat_count"] == 0
    assert response.json()["unread_expense_count"] == 0
    assert response.json()["unread_member_count"] == 0


def test_seen_requires_membership_and_rejects_invalid_section():
    group_id, admin_headers, _ = _create_unread_chat_group("seen_auth")
    client.post("/auth/signup", json={"username": "seen_outsider", "email": "seen_outsider@example.com"})

    non_member = client.post(
        f"/groups/{group_id}/seen",
        json={"section": "expenses"},
        headers={"X-Dev-Username": "seen_outsider"}
    )
    assert non_member.status_code == 403

    invalid_section = client.post(
        f"/groups/{group_id}/seen",
        json={"section": "chat"},
        headers=admin_headers
    )
    assert invalid_section.status_code == 422


def test_group_list_includes_total_unread_count():
    group_id, admin_headers, member_headers = _create_unread_chat_group("total")
    group = client.get(f"/groups/{group_id}", headers=admin_headers).json()
    client.get(f"/groups/{group_id}", headers=member_headers)
    admin_member_id = next(member["id"] for member in group["members"] if member["name"] == "total_admin")
    member_id = next(member["id"] for member in group["members"] if member["name"] == "total_member")

    assert client.post(
        f"/groups/{group_id}/chat",
        json={"body": "Unread chat"},
        headers=admin_headers
    ).status_code == 200
    assert client.post(
        f"/groups/{group_id}/expenses/equal",
        json={
            "description": "Unread expense",
            "total_amount": 20,
            "paid_by": admin_member_id,
            "split_among": [admin_member_id, member_id]
        },
        headers=admin_headers
    ).status_code == 200
    client.post("/auth/signup", json={"username": "total_c", "email": "total_c@example.com"})
    joined = client.post(
        f"/groups/{group_id}/invite",
        json={"method": "username", "username": "total_c"},
        headers=admin_headers
    )
    assert joined.status_code == 200

    groups = client.get("/groups", headers=member_headers)
    assert groups.status_code == 200
    item = next(group for group in groups.json() if group["id"] == group_id)
    assert item["unread_chat_count"] == 1
    assert item["unread_expense_count"] == 1
    assert item["unread_member_count"] == 1
    assert item["unread_total_count"] == (
        item["unread_chat_count"] + item["unread_expense_count"] + item["unread_member_count"]
    )


def test_group_rename_is_admin_only_and_updates_group_lists():
    admin_headers = _dev_user("rename_admin")
    member_headers = _dev_user("rename_member")
    outsider_headers = _dev_user("rename_outsider")
    group_id = client.post(
        "/groups", json={"name": "Before"}, headers=admin_headers
    ).json()["id"]
    client.post(
        f"/groups/{group_id}/invite",
        json={"method": "username", "username": "rename_member"},
        headers=admin_headers
    )

    renamed = client.patch(
        f"/groups/{group_id}",
        json={"name": "  After  "},
        headers=admin_headers
    )
    assert renamed.status_code == 200
    assert renamed.json() == {"id": group_id, "name": "After"}
    assert next(
        group for group in client.get("/groups", headers=admin_headers).json()
        if group["id"] == group_id
    )["name"] == "After"
    assert client.get(
        f"/groups/{group_id}", headers=member_headers
    ).json()["name"] == "After"

    assert client.patch(
        f"/groups/{group_id}", json={"name": "Member name"}, headers=member_headers
    ).status_code == 403
    assert client.patch(
        f"/groups/{group_id}", json={"name": "Outsider name"}, headers=outsider_headers
    ).status_code == 403

    for invalid_name in ("", "   ", "x" * 51):
        response = client.patch(
            f"/groups/{group_id}", json={"name": invalid_name}, headers=admin_headers
        )
        assert response.status_code == 400
        assert response.json()["detail"] == "Group name must be 1 to 50 characters"


def test_expense_list_includes_creator_usernames_and_stable_order():
    admin_headers = _dev_user("creator_admin")
    member_headers = _dev_user("creator_member")
    group_id = client.post(
        "/groups", json={"name": "Creator test"}, headers=admin_headers
    ).json()["id"]
    client.post(
        f"/groups/{group_id}/invite",
        json={"method": "username", "username": "creator_member"},
        headers=admin_headers
    )
    members = client.get(f"/groups/{group_id}", headers=admin_headers).json()["members"]
    member_ids = {member["name"]: member["id"] for member in members}

    equal_expense = client.post(
        f"/groups/{group_id}/expenses/equal",
        json={
            "description": "Equal expense",
            "total_amount": 20,
            "paid_by": member_ids["creator_admin"],
            "split_among": list(member_ids.values())
        },
        headers=admin_headers
    )
    assert equal_expense.status_code == 200

    general_expense = client.post(
        f"/groups/{group_id}/expenses",
        json={
            "description": "General expense",
            "total_amount": 30,
            "split_type": "equal",
            "paid_by": [{"member_id": member_ids["creator_member"], "amount_paid": 30}],
            "split_among": [
                {"member_id": member_id} for member_id in member_ids.values()
            ]
        },
        headers=member_headers
    )
    assert general_expense.status_code == 200

    shared_time = datetime(2024, 1, 2, tzinfo=timezone.utc)
    with Session(test_engine) as session:
        equal_row = session.exec(
            select(ExpenseDB).where(ExpenseDB.description == "Equal expense")
        ).one()
        general_row = session.exec(
            select(ExpenseDB).where(ExpenseDB.description == "General expense")
        ).one()
        equal_row.created_at = shared_time
        general_row.created_at = shared_time
        legacy_row = ExpenseDB(
            group_id=group_id,
            description="Legacy expense",
            total_amount=5,
            created_at=datetime(2024, 1, 1, tzinfo=timezone.utc)
        )
        session.add(legacy_row)
        session.commit()
        session.refresh(legacy_row)
        expected_order = [
            legacy_row.id,
            *sorted([equal_row.id, general_row.id])
        ]
        session.commit()

    expenses = client.get(
        f"/groups/{group_id}/expenses", headers=admin_headers
    ).json()
    assert [expense["id"] for expense in expenses] == expected_order
    expenses_by_description = {
        expense["description"]: expense for expense in expenses
    }
    assert expenses_by_description["Equal expense"]["created_by_username"] == "creator_admin"
    assert expenses_by_description["General expense"]["created_by_username"] == "creator_member"
    assert expenses_by_description["Legacy expense"]["created_by_member_id"] is None
    assert expenses_by_description["Legacy expense"]["created_by_username"] is None
