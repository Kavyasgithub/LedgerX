"""In-process end-to-end smoke test hitting the real ASGI app + real Postgres.

Run AFTER seeding a clean DB:   python -m scripts.smoke
Exercises every money scenario and asserts exact balances/invariants.
"""
from __future__ import annotations

import asyncio
import uuid

import httpx

from app.main import app

BASE = "http://test"


def key() -> dict:
    return {"Idempotency-Key": str(uuid.uuid4())}


async def main() -> None:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url=BASE) as c:
        assert (await c.get("/health")).json()["status"] == "ok"

        # --- Scenario 1: wallet top-up (INR 500) ---
        r = await c.post(
            "/v1/transfers",
            headers=key(),
            json={
                "transaction_type": "topup",
                "currency": "INR",
                "postings": [
                    {"account_reference": "bank:settlement", "amount": 50000},
                    {"account_reference": "customer:c1:wallet", "amount": -50000},
                ],
            },
        )
        assert r.status_code == 201, r.text
        acct = (await c.get("/v1/accounts/customer:c1:wallet")).json()
        assert acct["current_balance"] == 50000, acct
        print("Scenario 1 top-up OK  -> wallet natural balance", acct["current_balance"])

        # --- Scenario 2: payment with 2% fee (INR 100) ---
        pay_key = key()
        pay_body = {
            "transaction_type": "payment",
            "reference_id": "order_1",
            "currency": "INR",
            "postings": [
                {"account_reference": "customer:c1:wallet", "amount": 10000},
                {"account_reference": "merchant:m1:balance", "amount": -9800},
                {"account_reference": "platform:fee_revenue", "amount": -200},
            ],
        }
        r = await c.post("/v1/transfers", headers=pay_key, json=pay_body)
        assert r.status_code == 201, r.text
        payment_id = r.json()["transaction_id"]
        assert (await c.get("/v1/accounts/customer:c1:wallet")).json()["current_balance"] == 40000
        assert (await c.get("/v1/accounts/merchant:m1:balance")).json()["current_balance"] == 9800
        assert (await c.get("/v1/accounts/platform:fee_revenue")).json()["current_balance"] == 200
        print("Scenario 2 payment OK -> merchant 9800, fee 200")

        # --- Idempotency replay: same key + body returns same txn, no double-move ---
        r2 = await c.post("/v1/transfers", headers=pay_key, json=pay_body)
        assert r2.json()["transaction_id"] == payment_id, "idempotency replay changed txn"
        assert (await c.get("/v1/accounts/merchant:m1:balance")).json()["current_balance"] == 9800
        print("Idempotency replay OK -> same txn, balance unchanged")

        # --- Idempotency reuse with different body -> 422 ---
        bad = await c.post(
            "/v1/transfers", headers=pay_key, json={**pay_body, "reference_id": "different"}
        )
        assert bad.status_code == 422 and bad.json()["error"]["code"] == "IDEMPOTENCY_KEY_REUSED"
        print("Idempotency reuse guard OK -> 422")

        # --- Unbalanced transaction rejected ---
        ub = await c.post(
            "/v1/transfers",
            headers=key(),
            json={
                "transaction_type": "payment",
                "currency": "INR",
                "postings": [
                    {"account_reference": "customer:c1:wallet", "amount": 10000},
                    {"account_reference": "merchant:m1:balance", "amount": -9000},
                ],
            },
        )
        assert ub.status_code == 422 and ub.json()["error"]["code"] == "UNBALANCED_TRANSACTION"
        print("Unbalanced guard OK -> 422")

        # --- Insufficient funds (spend more than wallet holds) ---
        insf = await c.post(
            "/v1/transfers",
            headers=key(),
            json={
                "transaction_type": "payment",
                "currency": "INR",
                "postings": [
                    {"account_reference": "customer:c1:wallet", "amount": 999999},
                    {"account_reference": "merchant:m1:balance", "amount": -999999},
                ],
            },
        )
        assert insf.status_code == 422 and insf.json()["error"]["code"] == "INSUFFICIENT_FUNDS"
        print("Insufficient-funds guard OK -> 422")

        # --- Scenario 4: partial refund (INR 40 of INR 100) ---
        r = await c.post(f"/v1/payments/{payment_id}/refund", headers=key(), json={"amount": 4000})
        assert r.status_code == 201, r.text
        refund_postings = {p["account_reference"]: p["amount"] for p in r.json()["postings"]}
        assert refund_postings["merchant:m1:balance"] == 3920, refund_postings
        assert refund_postings["platform:fee_revenue"] == 80, refund_postings
        assert refund_postings["customer:c1:wallet"] == -4000, refund_postings
        print("Scenario 4 partial refund OK -> merchant +3920, fee +80, customer -4000")

        # --- Refund exceeding original rejected ---
        over = await c.post(
            f"/v1/payments/{payment_id}/refund", headers=key(), json={"amount": 999999}
        )
        assert over.status_code == 422 and over.json()["error"]["code"] == "REFUND_EXCEEDS_ORIGINAL"
        print("Refund-exceeds-original guard OK -> 422")

        # --- Scenario 9: reversal ---
        topup2 = await c.post(
            "/v1/transfers",
            headers=key(),
            json={
                "transaction_type": "topup",
                "currency": "INR",
                "postings": [
                    {"account_reference": "bank:settlement", "amount": 20000},
                    {"account_reference": "customer:c2:wallet", "amount": -20000},
                ],
            },
        )
        tid = topup2.json()["transaction_id"]
        rev = await c.post(f"/v1/transactions/{tid}/reverse", headers=key())
        assert rev.status_code == 201, rev.text
        again = await c.post(f"/v1/transactions/{tid}/reverse", headers=key())
        assert again.status_code == 409 and again.json()["error"]["code"] == "ALREADY_REVERSED"
        assert (await c.get("/v1/accounts/customer:c2:wallet")).json()["current_balance"] == 0
        print("Scenario 9 reversal OK -> balance restored, double-reverse blocked")

        # --- Scenario 6: hold -> capture ---
        h = await c.post(
            "/v1/holds",
            headers=key(),
            json={"account_reference": "customer:c1:wallet", "amount": 5000, "currency": "INR"},
        )
        assert h.status_code == 201, h.text
        hold_id = h.json()["id"]
        acct = (await c.get("/v1/accounts/customer:c1:wallet")).json()
        assert acct["held_amount"] == 5000 and acct["available_balance"] == acct["current_balance"] - 5000
        cap = await c.post(
            f"/v1/holds/{hold_id}/capture",
            headers=key(),
            json={
                "currency": "INR",
                "postings": [
                    {"account_reference": "customer:c1:wallet", "amount": 5000},
                    {"account_reference": "merchant:m1:balance", "amount": -5000},
                ],
            },
        )
        assert cap.status_code == 201, cap.text
        assert (await c.get("/v1/accounts/customer:c1:wallet")).json()["held_amount"] == 0
        print("Scenario 6 hold->capture OK")

        # --- hold -> release ---
        h2 = await c.post(
            "/v1/holds",
            headers=key(),
            json={"account_reference": "customer:c1:wallet", "amount": 3000, "currency": "INR"},
        )
        rel = await c.post(f"/v1/holds/{h2.json()['id']}/release", headers=key())
        assert rel.status_code == 200 and rel.json()["status"] == "released"
        assert (await c.get("/v1/accounts/customer:c1:wallet")).json()["held_amount"] == 0
        print("Hold->release OK")

        # --- Statement + transaction fetch ---
        stmt = (await c.get("/v1/accounts/customer:c1:wallet/statement?limit=5")).json()
        assert len(stmt["entries"]) > 0
        txn = (await c.get(f"/v1/transactions/{payment_id}")).json()
        assert len(txn["postings"]) == 3
        print(f"Statement OK ({len(stmt['entries'])} entries), transaction fetch OK")

        # --- Reconciliation: everything balances ---
        rec = (await c.post("/v1/admin/reconcile")).json()
        assert rec["ok"] is True, rec
        assert all(chk["passed"] for chk in rec["checks"]), rec
        print(f"Reconciliation OK -> global sum zero, {rec['postings_scanned']} postings scanned")

    print("\nALL SMOKE CHECKS PASSED")


if __name__ == "__main__":
    asyncio.run(main())
