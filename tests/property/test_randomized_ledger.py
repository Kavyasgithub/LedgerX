"""Randomized sequence of valid operations; invariants must hold after every step.

Covers SC-5: global sum stays zero, cached == derived, no non-negative account
goes below zero, refunds never exceed the original, and idempotent replays never
move money. Runs many randomized steps within the single session event loop.
"""
import random
import uuid


def ikey() -> dict:
    return {"Idempotency-Key": str(uuid.uuid4())}


async def _assert_reconciles(client):
    rec = (await client.post("/v1/admin/reconcile")).json()
    assert rec["ok"] is True, rec


async def test_randomized_operations_preserve_invariants(client):
    rng = random.Random(1234)
    wallets = ["customer:c1:wallet", "customer:c2:wallet"]
    payments: list[tuple[str, str, int]] = []  # (txn_id, wallet, amount)
    reversed_ids: set[str] = set()

    for _ in range(60):
        op = rng.choice(["topup", "topup", "payment", "refund", "reverse"])

        if op == "topup":
            wallet = rng.choice(wallets)
            amount = rng.randrange(1000, 100000)
            r = await client.post(
                "/v1/transfers",
                headers=ikey(),
                json={
                    "transaction_type": "topup",
                    "currency": "INR",
                    "postings": [
                        {"account_reference": "bank:settlement", "amount": amount},
                        {"account_reference": wallet, "amount": -amount},
                    ],
                },
            )
            assert r.status_code == 201

        elif op == "payment":
            wallet = rng.choice(wallets)
            avail = (await client.get(f"/v1/accounts/{wallet}")).json()["available_balance"]
            if avail < 100:
                continue
            gross = rng.randrange(100, avail + 1)
            fee = gross // 50  # 2% fee
            key = ikey()
            body = {
                "transaction_type": "payment",
                "currency": "INR",
                "postings": [
                    {"account_reference": wallet, "amount": gross},
                    {"account_reference": "merchant:m1:balance", "amount": -(gross - fee)},
                    {"account_reference": "platform:fee_revenue", "amount": -fee},
                ],
            }
            r = await client.post("/v1/transfers", headers=key, json=body)
            assert r.status_code == 201, r.text
            payment_id = r.json()["transaction_id"]
            payments.append((payment_id, wallet, gross))

            # Idempotency invariant: replay changes nothing.
            before = (await client.get(f"/v1/accounts/{wallet}")).json()["current_balance"]
            replay = await client.post("/v1/transfers", headers=key, json=body)
            assert replay.json()["transaction_id"] == payment_id
            after = (await client.get(f"/v1/accounts/{wallet}")).json()["current_balance"]
            assert before == after

        elif op == "refund" and payments:
            payment_id, wallet, gross = rng.choice(payments)
            r = await client.post(
                f"/v1/payments/{payment_id}/refund",
                headers=ikey(),
                json={"amount": rng.randrange(1, gross + 1)},
            )
            # Either succeeds or is a clean domain rejection (cumulative cap).
            assert r.status_code in (201, 422), r.text
            if r.status_code == 422:
                assert r.json()["error"]["code"] in (
                    "REFUND_EXCEEDS_ORIGINAL",
                    "INSUFFICIENT_FUNDS",
                )

        elif op == "reverse" and payments:
            payment_id, _, _ = rng.choice(payments)
            if payment_id in reversed_ids:
                continue
            r = await client.post(f"/v1/transactions/{payment_id}/reverse", headers=ikey())
            assert r.status_code in (201, 409, 422), r.text
            if r.status_code == 201:
                reversed_ids.add(payment_id)

        await _assert_reconciles(client)
