from __future__ import annotations

from fastapi import APIRouter, Depends, Header
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.ledger.retry import run_in_transaction
from app.models.transfer import TransferRequest, TransferResponse
from app.services.transfer_service import execute_transfer

router = APIRouter(prefix="/v1/transfers", tags=["transfers"])


@router.post("", response_model=TransferResponse, status_code=201)
async def create_transfer(
    body: TransferRequest,
    idempotency_key: str = Header(..., alias="Idempotency-Key"),
    db: AsyncSession = Depends(get_db),
):
    async def work():
        return await execute_transfer(
            session=db,
            request=body,
            idempotency_key=idempotency_key,
            request_body=body.model_dump(mode="json"),
        )

    return await run_in_transaction(db, work)
