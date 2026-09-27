"""Integration tests: the database enforces the core invariants with ZERO
application code involved (raw SQL against real Postgres triggers)."""
import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError


async def _account_id(conn, reference: str) -> str:
    return str(
        await conn.scalar(text("SELECT id FROM accounts WHERE reference = :r"), {"r": reference})
    )


async def test_unbalanced_transaction_rejected_at_commit(db_engine):
    with pytest.raises(DBAPIError):
        async with db_engine.begin() as conn:
            txn_id = await conn.scalar(
                text(
                    "INSERT INTO transactions (transaction_type) VALUES ('x') RETURNING id"
                )
            )
            acct = await _account_id(conn, "customer:c1:wallet")
            # A single non-zero posting => group sums to 100, not zero.
            await conn.execute(
                text(
                    "INSERT INTO postings (transaction_id, account_id, amount, currency) "
                    "VALUES (:t, :a, 100, 'INR')"
                ),
                {"t": txn_id, "a": acct},
            )
        # deferred constraint trigger fires here at COMMIT


async def test_postings_are_immutable(db_engine):
    async with db_engine.begin() as conn:
        txn_id = await conn.scalar(
            text("INSERT INTO transactions (transaction_type) VALUES ('x') RETURNING id")
        )
        a1 = await _account_id(conn, "customer:c1:wallet")
        a2 = await _account_id(conn, "bank:settlement")
        await conn.execute(
            text(
                "INSERT INTO postings (transaction_id, account_id, amount, currency) "
                "VALUES (:t, :a, -100, 'INR'), (:t, :b, 100, 'INR')"
            ),
            {"t": txn_id, "a": a1, "b": a2},
        )

    with pytest.raises(DBAPIError):
        async with db_engine.begin() as conn:
            await conn.execute(
                text("UPDATE postings SET amount = 5 WHERE transaction_id = :t"),
                {"t": txn_id},
            )

    with pytest.raises(DBAPIError):
        async with db_engine.begin() as conn:
            await conn.execute(
                text("DELETE FROM postings WHERE transaction_id = :t"), {"t": txn_id}
            )


async def test_transactions_are_immutable(db_engine):
    async with db_engine.begin() as conn:
        txn_id = await conn.scalar(
            text("INSERT INTO transactions (transaction_type) VALUES ('x') RETURNING id")
        )

    with pytest.raises(DBAPIError):
        async with db_engine.begin() as conn:
            await conn.execute(
                text("UPDATE transactions SET transaction_type = 'y' WHERE id = :t"),
                {"t": txn_id},
            )


async def test_currency_mismatch_rejected_at_insert(db_engine):
    with pytest.raises(DBAPIError):
        async with db_engine.begin() as conn:
            txn_id = await conn.scalar(
                text("INSERT INTO transactions (transaction_type) VALUES ('x') RETURNING id")
            )
            acct = await _account_id(conn, "customer:c1:wallet")  # INR account
            await conn.execute(
                text(
                    "INSERT INTO postings (transaction_id, account_id, amount, currency) "
                    "VALUES (:t, :a, -100, 'USD')"  # wrong currency
                ),
                {"t": txn_id, "a": acct},
            )
