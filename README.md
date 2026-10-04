# LedgerX — Double-Entry Financial Ledger

A working financial ledger with the hard parts done right. Every rupee that moves is recorded twice — once leaving, once arriving — and the two must cancel exactly. Balances, constraints, and concurrency are enforced at the database level, not in application code.

> **The one rule:** money is never created or destroyed, it only moves between accounts. Every transaction's postings must sum to zero.

---

## Why explore this?

- **Building a payments product** — wallets, escrow, merchant payouts, refunds. The hard parts (concurrent writes, hold mechanics, idempotency, reversals) are already solved here. Use it as a reference.
- **Learning double-entry accounting** — the dashboard walks through every operation with real numbers: top-up, payment with fee split, hold & capture, reversal.
- **Evaluating ledger architecture** — fire real API calls in the built-in explorer, watch the journal update live, and try to break the zero-sum rule. The guarantees are enforced by DB triggers — bypassing the API cannot corrupt the ledger.

---

## Stack

| Layer | Technology |
|---|---|
| API server | Node.js 18 + Express |
| Database | PostgreSQL (raw `pg` driver, no ORM) |
| Frontend | React 18 + Vite + Tailwind CSS |
| Data fetching | TanStack Query |
| Charts | Recharts |
| API docs | Swagger UI (served at `/api-docs`) |

---

## Architecture

```
React (Vite)  →  Express routes  →  services/  →  ledger/writer.js  →  PostgreSQL
```

- **`server/src/ledger/writer.js`** is the only code that inserts postings. It owns the invariants: zero-sum, currency match, non-negative funds, idempotency, hold consumption, and atomic cached-balance updates.
- **Money is always signed 64-bit integers in minor units (paise).** No floats, anywhere.
- **Strict double-entry sign convention:** `cached_balance` is the raw signed sum of postings. Credit-normal accounts (wallets, merchant balances, income) hold value as a *negative* cached balance; debit-normal accounts (assets, expenses) as *positive*. The API presents the **natural balance** (sign-flipped for credit-normal).
- **Workspaces** isolate data per named tenant — share a workspace name with teammates to collaborate on the same live ledger.

### Safety properties

| Property | Mechanism |
|---|---|
| Transactions sum to zero | Deferred `CONSTRAINT TRIGGER` at commit |
| Postings/transactions immutable | `BEFORE UPDATE OR DELETE` triggers that always raise |
| Posting currency matches account | `BEFORE INSERT` trigger |
| A transaction reversed at most once | `UNIQUE (reverses_transaction_id)` constraint |
| No deadlocks | Accounts locked `FOR UPDATE` in ascending UUID order |
| Exactly-once writes | Idempotency key claimed atomically via `INSERT ... ON CONFLICT DO NOTHING` |
| Non-negative accounts never overdraw | Available-balance check inside the locked transaction |

---

## Running locally

**Prerequisites:** PostgreSQL 14+, Node.js 18+

```bash
# 1. Configure the database
cp server/.env.example server/.env
# Edit DATABASE_URL in server/.env

# 2. Run migrations
cd server
npm install
npm run migrate

# 3. Start the API  (http://localhost:3000)
npm run dev

# 4. Start the UI   (http://localhost:5173)
cd ../client
npm install
npm run dev
```

API docs (Swagger UI) are served at **http://localhost:3000/api-docs**.

---

## Money scenarios (exact postings, all in paise)

| Scenario | Postings |
|---|---|
| Top-up ₹500 | `bank:settlement +50000`, `customer:c1:wallet −50000` |
| Payment ₹100 + 2% fee | `customer +10000`, `merchant −9800`, `fee −200` |
| Full refund | `merchant +9800`, `fee +200`, `customer −10000` |
| Partial refund ₹40 | `merchant +3920`, `fee +80`, `customer −4000` |
| Place hold | Insert `holds` row, no postings (available balance drops) |
| Capture hold | Mark hold consumed + write payment postings atomically |
| Release hold | Mark hold released, no postings written |
| Reversal | New transaction with every posting negated, linked to original |

Failed payments write **zero** postings — a failure is the absence of a movement.

---

## API

All routes under `/v1`. All amounts are integers in minor units (paise). All write endpoints require an `Idempotency-Key` header.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/v1/accounts` | Create an account |
| `GET` | `/v1/accounts/:ref` | Balances (natural, held, available) |
| `GET` | `/v1/accounts/:ref/statement` | Cursor-paginated posting history + running balance |
| `POST` | `/v1/transfers` | Record a balanced money movement |
| `GET` | `/v1/transactions/:id` | Fetch by UUID or idempotency key |
| `POST` | `/v1/transactions/:id/reverse` | Reverse a transaction |
| `POST` | `/v1/payments/:id/refund` | Full or partial refund (pro-rata fee) |
| `POST` | `/v1/holds` | Place a hold |
| `POST` | `/v1/holds/:id/capture` | Consume hold + write transaction atomically |
| `POST` | `/v1/holds/:id/release` | Release hold, free reserved funds |
| `GET` | `/v1/admin/accounts` | Dashboard — all accounts with balances and global sum |
| `GET` | `/v1/admin/journal` | Append-only transaction journal |
| `GET` | `/v1/admin/ledger` | Raw posting ledger with running balance |
| `POST` | `/v1/admin/reconcile` | Run 7-point reconciliation audit |

Errors use one envelope: `{ "error": { code, message, details, request_id } }`.

---

## Dashboard sections

| Section | What it shows |
|---|---|
| **Overview** | KPI strip, accounts table, live journal, operations panel (top-up, pay, hold, scenario) |
| **Journal** | Append-only log of every transaction, cursor-paginated, reversal entries highlighted |
| **API Explorer** | Full Swagger-style tester built into the dashboard — pre-filled examples, one-click idempotency key |
| **Analytics** | Fee revenue, net P&L, transaction volume chart, per-account balance trend |

---

## Database migrations

Migrations live in `server/migrations/` and run in order via `npm run migrate`.

| File | What it creates |
|---|---|
| `001` | `accounts` table |
| `002` | `transactions` table |
| `003` | `postings` table + zero-sum trigger |
| `004` | `idempotency_keys` table |
| `005` | `holds` table |
| `006` | `normal_side` column on accounts |
| `007` | 30-day retention policy for old records |
| `008–010` | Workspace multi-tenancy + unique ref constraints |

---

## Security notes

- All SQL uses parameterized queries — no string interpolation of user values.
- The uniform error handler never leaks stack traces, file paths, or raw DB errors to clients. Unexpected errors are logged server-side with `[request_id] METHOD /path` prefix for traceability, and the client receives only a generic `INTERNAL_ERROR` with the `request_id`.
- **Known build-time vulnerability:** `braces ≤ 3.0.3` (GHSA-vfj7-8cjw-p6xm, High) is pulled in transitively by `tailwindcss` v3. There is no patched braces v3 release — the fix requires migrating to tailwindcss v4, which is a breaking change. This vulnerability only affects the build process (`vite build`) and is never present in the running server or browser bundle. It cannot be triggered by end users. Migrate to tailwindcss v4 when ready.
- **Out of scope by design:** authentication/sessions, FX/multi-currency conversion, real gateway integration, tax computation. Add an auth layer before exposing this publicly.
