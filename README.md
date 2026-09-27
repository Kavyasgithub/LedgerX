# Ledger — Double-Entry Accounting Service

The financial backbone of a payment platform: the single source of truth for
where every rupee is at every moment. Every money movement is an immutable,
auditable **transaction** made of **postings** that always sum to exactly zero —
enforced in the database, not just application code.

> **The one rule:** money is never created or destroyed, it only moves between
> accounts. Every transaction's postings sum to zero.

---

## Architecture

```
api/  (HTTP only)  →  services/  (what postings to build)  →  ledger/writer.py  →  PostgreSQL
```

* **`app/ledger/writer.py`** is the *only* code that inserts postings. It owns the
  invariants: zero-sum, currency match, non-negative funds, idempotency, hold
  consumption, and atomic cached-balance updates.
* **Money is always signed 64-bit integers in minor units (paise).** No floats,
  anywhere.
* **Strict double-entry sign convention** (see `app/domain.py`): `cached_balance`
  is the raw signed sum of postings. Credit-normal accounts (wallets, merchant
  balances, income) hold value as a *negative* cached balance; debit-normal
  accounts (assets, expenses) as *positive*. The API/UI present the **natural
  balance** (sign-flipped for credit-normal), and the non-negative policy (FR-5)
  is enforced on the *available* natural balance (natural minus active holds).

### Safety properties & how they're guaranteed

| Property | Mechanism |
|---|---|
| Transactions sum to zero | Deferred `CONSTRAINT TRIGGER` at commit + app pre-check |
| Postings/transactions immutable | `BEFORE UPDATE OR DELETE` triggers that always raise |
| Posting currency == account currency | `BEFORE INSERT` trigger |
| A transaction is reversed at most once | `UNIQUE (reverses_transaction_id)` + pre-check |
| No deadlocks | Accounts always locked `FOR UPDATE` in ascending UUID order |
| Transient conflicts recover | Retry on SQLSTATE `40001`/`40P01` with backoff+jitter (`ledger/retry.py`) |
| Exactly-once writes | Idempotency key claimed atomically via `INSERT ... ON CONFLICT DO NOTHING` |
| Non-negative accounts never overdraw | Available-balance check inside the locked transaction |

---

## Running it

Prerequisites: Docker Desktop, Python 3.12 venv (deps in `requirements.txt`), Node 18+.

```powershell
# 1. Start Postgres
docker compose up -d db

# 2. Migrate + seed the chart of accounts
python -m alembic upgrade head
python -m app.seed

# 3. Run the API  (http://localhost:8000, docs at /docs)
python -m uvicorn app.main:app --reload

# 4. Run the UI   (http://localhost:5173, proxies /v1 to the API)
cd ui
npm install
npm run dev
```

A one-shot in-process end-to-end check (exercises every scenario against real
Postgres) lives at `scripts/smoke.py`:

```powershell
python -m scripts.smoke
```

---

## Money scenarios (exact postings, all in paise)

| Scenario | Postings |
|---|---|
| Top-up ₹500 | `bank:settlement +50000`, `customer:c1:wallet -50000` |
| Payment ₹100 + 2% fee | `customer +10000`, `merchant -9800`, `fee -200` |
| Full refund | `merchant +9800`, `fee +200`, `customer -10000` |
| Partial refund ₹40 | `merchant +3920`, `fee +80`, `customer -4000` (banker's rounding on fee) |
| Authorize | insert `holds` row, no postings (available balance drops) |
| Capture | mark hold consumed + write payment postings atomically |
| Release | mark hold released, no postings ever |
| Payout | `merchant +9800`, `bank:settlement -9800` |
| Reversal | new transaction with every posting negated, linked to the original |

Failed payments write **zero** postings — a failure is the absence of a movement.

---

## API

All under `/v1`; all amounts are integers in minor units; all write endpoints
require an `Idempotency-Key` header.

| Method | Path | Purpose |
|---|---|---|
| POST | `/v1/accounts` | Create account |
| GET | `/v1/accounts/{ref}` | Balances (natural, held, available) |
| GET | `/v1/accounts/{ref}/statement` | Keyset-paginated posting history + running balance |
| POST | `/v1/transfers` | Record a balanced money movement |
| GET | `/v1/transactions/{id}` | Fetch by UUID **or** idempotency key |
| POST | `/v1/transactions/{id}/reverse` | Reverse a transaction |
| POST | `/v1/payments/{id}/refund` | Full or partial refund (proportional fee) |
| POST | `/v1/holds` · `/{id}/capture` · `/{id}/release` | Hold lifecycle |
| POST | `/v1/admin/reconcile` | Run all reconciliation checks |
| GET | `/v1/admin/accounts` · `/v1/admin/ledger` | Dashboard + live ledger feeds |

Errors use one envelope: `{ "error": { code, message, details, request_id } }`.

---

## Testing

```powershell
python -m pytest -q
```

Uses an isolated `ledger_test` database (the dev DB is never touched). Coverage:

* **unit** — refund/banker's-rounding math, sign-convention invariants.
* **integration** — DB rejects unbalanced insert at commit; postings/transactions
  immutable; currency mismatch rejected; full top-up→capture→refund→reverse lifecycle.
* **concurrency** — transfer storm (global sum stays 0), idempotency race (100
  concurrent, exactly 1 transaction), hot-account capacity, deadlock-free cross transfers.
* **property** — Hypothesis math invariants + a randomized operation sequence that
  reconciles after every step.

---

## Security notes

* Backend touches money only through parameterized SQL (no string interpolation of
  values); all user input flows through Pydantic validation.
* The uniform error handler never leaks internals; unexpected errors return a
  generic `INTERNAL_ERROR` with a `request_id`.
* Frontend dependencies audit clean (`npm audit` → 0 vulnerabilities).
* **Out of scope by design** (per spec): authentication/sessions, FX/multi-currency
  conversion, real gateway/bank integration, tax computation. Add an auth layer
  before exposing this publicly.
