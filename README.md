# Debt-Settle
Group Expense Splitter with Minimum-Transaction Settlement & UPI Deep-Links

## 1. Problem Statement

When a group of people share expenses over time — a hostel mess, a trip, a shared flat — money doesn't flow cleanly. Different people pay for different things at different times: one person pays for lunch, another for travel, another fronts cash for a small errand that gets partially spent. By the end of a period (a trip, a month of mess bills), nobody actually remembers who owes what, and if everyone tries to settle up individually — "you owe me for lunch, I owe you for travel, he owes you for the room" — you end up with far more transactions than necessary, several of which cancel each other out.

The core problem Debt-Settle solves:

> Given a group's shared expenses (who paid, how much, who it was for) and any informal person-to-person debts, calculate each member's net balance, and then determine the minimum number of payments needed to settle everyone up completely — with a one-tap UPI payment link generated for each payment.

This is not just a bookkeeping tool. The interesting part — and the part worth building well — is the settlement algorithm: turning a tangled web of who-owes-whom into the smallest possible set of actual transactions.

---

## 2. Detailed Documentation References

For in-depth architectural diagrams, design decisions, and test specifications, refer to:

- 📄 **[claude_Debt-Settle-Architecture-Detailed.md](claude_Debt-Settle-Architecture-Detailed.md)**: Full technical system architecture, database ERD, identity model, 2-step confirmation lifecycle, cancel rules, group chat auto-lock, and frontend UI/UX breakdown.
- 📄 **[Debt-Settle-Project-Spec.md](Debt-Settle-Project-Spec.md)**: Product specification, algorithm benchmarks, and test guarantees.

---

## 3. Core Features Built

- **Hybrid Settlement Engine**:
  - Automatically dispatches between an **Exact Backtracking Solver** (branch-and-bound DFS, guaranteed true minimum for $\le 12$ balances) and a **Greedy Heap Solver** ($O(n \log n)$ for $> 12$ balances).
- **One-Tap UPI Deep Links**: Generates native `upi://pay?pa=...&pn=...&am=...&cu=INR&tn=Settlement` URLs for instant payment via Google Pay, PhonePe, Paytm, and BHIM.
- **Identity & Dev Auth Bypass**: Server-derived identity with optional Firebase token verification and `DEV_MODE=true` header bypass (`X-Dev-Username`).
- **Profile Consent & Deletion**: Users can record consent versions and delete their account with protected handling for unsettled groups and payments.
- **Per-Group UPI IDs**: Members can update or clear their own UPI ID; settlement responses always include a UPI URI, using `upi://pay` when no payee ID is set.
- **Rate Limiting**: SlowAPI limits authentication, user search, and group invite/join requests. `RATE_LIMIT_ENABLED` defaults to `true`; set it to `false` only where rate limiting should be disabled.
- **Flexible Expense Splits**:
  - Single-payer equal splits (`/expenses/equal`)
  - Multi-payer expenses (multiple people contributing to one cost)
  - Unequal splits: `exact` amounts, `percentage` (validates 100%), and `shares` (parts ratio) with penny-rounding drift correction.
- **Two-Step Confirmation Flow**:
  - Payer marks as paid $\rightarrow$ Status: `paid_pending_confirmation`.
  - Only the recipient can confirm or deny receipt $\rightarrow$ Status: `confirmed`.
  - Group is marked `fully_settled_at` once all transactions are confirmed.
- **Permanent Group Freeze & Safe Cancellation**:
  - Group is frozen from adding new expenses/debts as soon as a settlement plan is generated.
  - Admin can cancel settlement **only** if all transactions are still pending.
- **Group Chat with Auto-Lock**: REST-based shared group chat that automatically becomes read-only when the group is fully settled.
- **7-Day Retention Cleanup**: Cascade-deletes groups and all associated records 7 days after full settlement.

---

## 4. Run It

### Setup and Start API

```bash
# Install dependencies
pip install -r requirements.txt

# Start the server
uvicorn main:app --reload
```

Interactive API documentation (Swagger UI) is available at:
👉 **http://127.0.0.1:8000/docs**

Set `RATE_LIMIT_ENABLED=false` in the environment to disable API rate limiting; it is enabled by default.

### Run Test Suite

```bash
python -m pytest -v
```

---

## 5. API Endpoints Overview

| Method | Endpoint | Description | Auth / Role |
| :--- | :--- | :--- | :--- |
| `POST` | `/auth/signup` | Register username and auto-claim pending email invites | Public |
| `GET` | `/auth/me` | Current user profile and active group count | Authenticated |
| `POST` | `/auth/me/consent` | Record the current consent version and timestamp | Authenticated |
| `DELETE` | `/auth/me` | Delete and anonymize the current account when group/payment constraints allow | Authenticated |
| `PATCH` | `/auth/me/username` | Confirm a newly provisioned username | Authenticated |
| `GET` | `/users/search` | Search users by username prefix | Authenticated |
| `POST` | `/groups` | Create group (creator becomes admin) | Authenticated |
| `GET` | `/groups` | List groups the user belongs to | Authenticated |
| `GET` | `/groups/{id}` | Group details, members, and settlement status | Member |
| `PATCH` | `/groups/{id}/members/me` | Update or clear the caller's UPI ID for this group | Member |
| `POST` | `/groups/{id}/invite` | Invite by `email`, `join_link`, or `username` | Member |
| `POST` | `/groups/join/{join_token}` | Join group via shareable link | Authenticated |
| `POST` | `/groups/{id}/expenses/equal` | Add single-payer equal split expense | Member |
| `POST` | `/groups/{id}/expenses` | Add multi-payer & unequal split expense (`exact`, `percentage`, `shares`) | Member |
| `GET` | `/groups/{id}/expenses` | List all group expenses | Member |
| `POST` | `/groups/{id}/debts` | Record direct 1-to-1 IOU | Member |
| `GET` | `/groups/{id}/balances` | Calculate live net balances | Member |
| `POST` | `/groups/{id}/settle` | Generate optimized settlement plan + UPI links | Admin Only |
| `GET` | `/groups/{id}/settlements` | View settlement transactions and UPI payment links | Member |
| `POST` | `/settlements/{id}/mark-paid` | Payer marks transaction as paid | Payer Only |
| `POST` | `/settlements/{id}/confirm` | Receiver confirms payment receipt | Receiver Only |
| `POST` | `/settlements/{id}/deny` | Receiver denies payment receipt (resets to pending) | Receiver Only |
| `POST` | `/groups/{id}/cancel-settlement` | Cancel settlement plan (only if all pending) | Admin Only |
| `POST` | `/groups/{id}/chat` | Post a message to group chat (active groups only) | Member |
| `GET` | `/groups/{id}/chat` | Get chat history and read-only status | Member |
| `POST` | `/admin/retention/cleanup` | Trigger cleanup of groups settled $> 7$ days ago | System / Admin |
