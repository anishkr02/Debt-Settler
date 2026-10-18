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

Swagger UI is available at **http://127.0.0.1:8000/docs** for interactive API testing.

Rate limiting is enabled by default; if you need to disable it locally, set `RATE_LIMIT_ENABLED=false`.

### Run Test Suite

```bash
python -m pytest -v
```

To run the API integration tests against a PostgreSQL 16 database:

```bash
TEST_DATABASE_URL="postgresql+psycopg://postgres:password@localhost:5432/debt_settle_test" python -m pytest tests/test_api_full.py -v
```

## Deploy

Use Python **3.12.5** (pinned in `.python-version`). Configure the variables below in the deployment platform; do not commit credentials. For production, set a PostgreSQL `DATABASE_URL`, `DEV_MODE=false`, a Firebase service account, and the deployed frontend origins.

Run migrations before starting the API:

```bash
alembic upgrade head && uvicorn main:app --host 0.0.0.0 --port $PORT --proxy-headers --forwarded-allow-ips="*"
```

| Variable | Purpose | Default / guidance |
| :--- | :--- | :--- |
| `DATABASE_URL` | Database connection URL. `postgres://` is normalized to `postgresql://` and PostgreSQL URLs use psycopg 3. | `sqlite:///./debt_settle.db` for local use; use PostgreSQL in deployment. |
| `PORT` | HTTP port for Uvicorn. | Set by the hosting platform; use `8000` locally. |
| `DEV_MODE` | Enables development header authentication and signup. | `false`; never enable in production. |
| `CORS_ALLOWED_ORIGINS` | Comma-separated allowed browser origins. | `http://localhost:5173,http://127.0.0.1:5173`. |
| `FIREBASE_SERVICE_ACCOUNT_PATH` | Path to a Firebase service-account JSON file. | Optional when `FIREBASE_SERVICE_ACCOUNT_JSON` is supplied; required in production otherwise. |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Raw Firebase service-account JSON. | Optional when `FIREBASE_SERVICE_ACCOUNT_PATH` is supplied; takes precedence if both are set. Keep secret. |
| `RATE_LIMIT_ENABLED` | Enables SlowAPI limits on authentication, search, invites, and joins. | `true`. |
| `RETENTION_ADMIN_KEY` | Secret required by `POST /admin/retention/cleanup`. | Unset disables authorization for that endpoint. Set a strong secret if using it. |
| `SENTRY_DSN` | Enables Sentry error reporting. | Unset disables Sentry; default PII and request-body capture are disabled. |
| `TEST_DATABASE_URL` | Optional database URL for API integration tests. | `sqlite:///:memory:`; set to a disposable PostgreSQL database to run integration tests against PostgreSQL. |
| `VITE_API_URL` | Frontend API base URL. | `http://localhost:8000`. |
| `VITE_FIREBASE_API_KEY` | Frontend Firebase project API key. | Set during frontend build. |
| `VITE_FIREBASE_AUTH_DOMAIN` | Frontend Firebase auth domain. | Set during frontend build. |
| `VITE_FIREBASE_PROJECT_ID` | Frontend Firebase project ID. | Set during frontend build. |
| `VITE_FIREBASE_APP_ID` | Frontend Firebase application ID. | Set during frontend build. |

Copy `.env.example` for local configuration and fill values locally; it intentionally contains no configured values. Firebase credentials belong in the deployment secret store, never in source control. `/health` is an unauthenticated process health check.

To create a schema migration after changing the SQLModel models:

```bash
alembic revision --autogenerate -m "describe the schema change"
```

Review the generated migration before committing it, then validate it with `alembic upgrade head` against a fresh SQLite file and the deployment database.
For an existing database created by the pre-Alembic application, back it up and verify its schema first, then run `alembic stamp head` once to mark this baseline; do not run the initial create-schema migration against tables that already exist.

Aggregate operational counts (no personal data) are available with:

```bash
python scripts/stats.py
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
