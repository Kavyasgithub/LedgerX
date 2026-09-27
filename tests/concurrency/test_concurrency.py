"""Concurrency tests: the invariants must hold under parallel load."""
import asyncio
import uuid

from sqlalchemy import text


def ikey() -> dict:
    return {"Idempotency-Key": str(uuid.uuid4())}


async def _global_sum(db_engine) -> int:
    async with db_engine.begin() as conn:
        return int(
            await conn.scalar(text("SELECT COALESCE(SUM(amount), 0) FROM postings")) or 0
        )


async def test_transfer_storm_global_sum_zero(client, db_engine):
    """SC-1 (scaled): many parallel transfers among allow-negative accounts.
    The global posting sum must be exactly zero afterward."""
    accounts = ["bank:settlement", "bank:suspense", "platform:fee_revenue"]

    async def one_transfer(i: int):
        src = accounts[i % len(accounts)]
        dst = accounts[(i + 1) % len(accounts)]
        return await client.post(
            "/v1/transfers",
            headers=ikey(),
            json={
                "transaction_type": "transfer",
                "currency": "INR",
                "postings": [
                    {"account_reference": src, "amount": -100},
                    {"account_reference": dst, "amount": 100},
                ],
            },
        )

    results = await asyncio.gather(*(one_transfer(i) for i in range(200)))
    assert all(r.status_code == 201 for r in results)
    assert await _global_sum(db_engine) == 0


async def test_idempotency_race_creates_exactly_one_transaction(client, db_engine):
    """SC-2: the same idempotency key fired concurrently creates exactly ONE txn."""
    key = str(uuid.uuid4())
    body = {
        "transaction_type": "transfer",
        "currency": "INR",
        "postings": [
            {"account_reference": "bank:settlement", "amount": -500},
            {"account_reference": "bank:suspense", "amount": 500},
        ],
    }

    async def fire():
        return await client.post(
            "/v1/transfers", headers={"Idempotency-Key": key}, json=body
        )

    results = await asyncio.gather(*(fire() for _ in range(50)))
    txn_ids = {r.json().get("transaction_id") for r in results if r.status_code == 201}
    # Every success references the same single transaction.
    assert len(txn_ids) == 1

    async with db_engine.begin() as conn:
        count = await conn.scalar(
            text("SELECT COUNT(*) FROM transactions WHERE idempotency_key = :k"), {"k": key}
        )
    assert count == 1


async def test_hot_account_exactly_capacity_succeeds(client):
    """A wallet with room for exactly N unit-debits, hit by 2N concurrent debits,
    lets through exactly N and rejects the rest with INSUFFICIENT_FUNDS."""
    capacity = 60
    # Fund the wallet with `capacity` units (natural balance == capacity).
    await client.post(
        "/v1/transfers",
        headers=ikey(),
        json={
            "transaction_type": "topup",
            "currency": "INR",
            "postings": [
                {"account_reference": "bank:settlement", "amount": capacity},
                {"account_reference": "customer:c1:wallet", "amount": -capacity},
            ],
        },
    )

    async def debit():
        return await client.post(
            "/v1/transfers",
            headers=ikey(),
            json={
                "transaction_type": "payment",
                "currency": "INR",
                "postings": [
                    {"account_reference": "customer:c1:wallet", "amount": 1},
                    {"account_reference": "merchant:m1:balance", "amount": -1},
                ],
            },
        )

    results = await asyncio.gather(*(debit() for _ in range(2 * capacity)))
    ok = sum(1 for r in results if r.status_code == 201)
    rejected = sum(
        1
        for r in results
        if r.status_code == 422 and r.json()["error"]["code"] == "INSUFFICIENT_FUNDS"
    )
    assert ok == capacity, f"expected {capacity} successes, got {ok}"
    assert ok + rejected == 2 * capacity
    acct = (await client.get("/v1/accounts/customer:c1:wallet")).json()
    assert acct["current_balance"] == 0


async def test_deadlock_free_cross_transfers(client, db_engine):
    """Two directions of transfer between the same pair, in parallel, must not
    produce unrecovered deadlocks thanks to sorted lock ordering."""

    async def a_to_b():
        return await client.post(
            "/v1/transfers",
            headers=ikey(),
            json={
                "transaction_type": "transfer",
                "currency": "INR",
                "postings": [
                    {"account_reference": "bank:settlement", "amount": -10},
                    {"account_reference": "bank:suspense", "amount": 10},
                ],
            },
        )

    async def b_to_a():
        return await client.post(
            "/v1/transfers",
            headers=ikey(),
            json={
                "transaction_type": "transfer",
                "currency": "INR",
                "postings": [
                    {"account_reference": "bank:suspense", "amount": -10},
                    {"account_reference": "bank:settlement", "amount": 10},
                ],
            },
        )

    tasks = []
    for _ in range(50):
        tasks.append(a_to_b())
        tasks.append(b_to_a())
    results = await asyncio.gather(*tasks)
    assert all(r.status_code == 201 for r in results)
    assert await _global_sum(db_engine) == 0
