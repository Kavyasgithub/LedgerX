from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Header
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.errors import LedgerError
from app.ledger.retry import run_in_transaction
from app.models.transaction import PostingDetail, TransactionDetail
from app.models.transfer import TransferResponse
from app.services.reversal_service import reverse_transaction

router = APIRouter(prefix="/v1/transactions", tags=["transactions"])


@router.get("/{identifier}", response_model=TransactionDetail)
async def get_transaction(identifier: str, db: AsyncSession = Depends(get_db)):
    """Fetch a transaction by UUID or by idempotency key (FR-13)."""
    try:
        uuid.UUID(identifier)
        clause = "id = :val"
    except ValueError:
        clause = "idempotency_key = :val"

    async with db.begin():
        txn = (
            await db.execute(
                text(
                    f"""
                    SELECT id, transaction_type, reference_id, idempotency_key,
                           reverses_transaction_id, metadata, created_at
                    FROM transactions WHERE {clause}
                    """
                ),
                {"val": identifier},
            )
        ).fetchone()
        if txn is None:
            raise LedgerError(
                "TRANSACTION_NOT_FOUND", f"Transaction not found: {identifier}", status=404
            )
        postings = (
            await db.execute(
                text(
                    """
                    SELECT p.id, a.reference, p.amount, p.currency
                    FROM postings p JOIN accounts a ON a.id = p.account_id
                    WHERE p.transaction_id = :id
                    ORDER BY p.id
                    """
                ),
                {"id": str(txn.id)},
            )
        ).fetchall()

    return TransactionDetail(
        id=str(txn.id),
        transaction_type=txn.transaction_type,
        reference_id=txn.reference_id,
        idempotency_key=txn.idempotency_key,
        reverses_transaction_id=str(txn.reverses_transaction_id)
        if txn.reverses_transaction_id
        else None,
        metadata=txn.metadata or {},
        created_at=txn.created_at,
        postings=[
            PostingDetail(id=p.id, account_reference=p.reference, amount=p.amount, currency=p.currency)
            for p in postings
        ],
    )


@router.post("/{transaction_id}/reverse", response_model=TransferResponse, status_code=201)
async def reverse(
    transaction_id: str,
    idempotency_key: str = Header(..., alias="Idempotency-Key"),
    db: AsyncSession = Depends(get_db),
):
    async def work():
        return await reverse_transaction(
            session=db,
            transaction_id=transaction_id,
            idempotency_key=idempotency_key,
            request_body={"transaction_id": transaction_id},
        )

    try:
        return await run_in_transaction(db, work)
    except IntegrityError:
        # Concurrent double-reversal lost the race on the UNIQUE constraint.
        raise LedgerError(
            "ALREADY_REVERSED",
            f"Transaction {transaction_id} has already been reversed.",
            status=409,
        )
