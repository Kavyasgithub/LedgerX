from __future__ import annotations

from fastapi import APIRouter, Depends, Header
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.ledger.retry import run_in_transaction
from app.models.refund import RefundRequest
from app.models.transfer import TransferResponse
from app.services.refund_service import refund_payment

router = APIRouter(prefix="/v1/payments", tags=["payments"])


@router.post("/{payment_id}/refund", response_model=TransferResponse, status_code=201)
async def refund(
    payment_id: str,
    body: RefundRequest,
    idempotency_key: str = Header(..., alias="Idempotency-Key"),
    db: AsyncSession = Depends(get_db),
):
    async def work():
        return await refund_payment(
            db, payment_id, body, idempotency_key, body.model_dump(mode="json")
        )

    return await run_in_transaction(db, work)
