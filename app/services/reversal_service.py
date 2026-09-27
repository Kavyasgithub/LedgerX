from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import LedgerError
from app.ledger.writer import write_transaction
from app.models.transfer import TransferResponse


async def reverse_transaction(
    session: AsyncSession,
    transaction_id: str,
    idempotency_key: str,
    request_body: dict,
) -> TransferResponse:
    original = (
        await session.execute(
            text("SELECT id, reference_id FROM transactions WHERE id = :id"),
            {"id": transaction_id},
        )
    ).fetchone()
    if original is None:
        raise LedgerError(
            "TRANSACTION_NOT_FOUND", f"Transaction {transaction_id} not found.", status=404
        )

    # A transaction may be reversed at most once (also enforced by a UNIQUE constraint).
    existing = (
        await session.execute(
            text("SELECT id FROM transactions WHERE reverses_transaction_id = :id"),
            {"id": transaction_id},
        )
    ).fetchone()
    if existing is not None:
        raise LedgerError(
            "ALREADY_REVERSED",
            f"Transaction {transaction_id} has already been reversed.",
            status=409,
        )

    postings = (
        await session.execute(
            text(
                """
                SELECT a.id AS account_id, a.reference AS reference,
                       p.amount AS amount, p.currency AS currency
                FROM postings p JOIN accounts a ON a.id = p.account_id
                WHERE p.transaction_id = :id
                """
            ),
            {"id": transaction_id},
        )
    ).fetchall()
    if not postings:
        raise LedgerError(
            "VALIDATION_ERROR",
            f"Transaction {transaction_id} has no postings to reverse.",
            status=422,
        )

    currency = postings[0].currency
    reversed_postings = [
        {
            "account_id": str(p.account_id),
            "account_reference": p.reference,
            "amount": -p.amount,  # exact negation
        }
        for p in postings
    ]

    return await write_transaction(
        session=session,
        transaction_type="reversal",
        currency=currency,
        postings=reversed_postings,
        idempotency_key=idempotency_key,
        endpoint=f"/v1/transactions/{transaction_id}/reverse",
        request_body=request_body,
        reference_id=original.reference_id,
        metadata={"reverses": transaction_id},
        reverses_transaction_id=transaction_id,
    )
