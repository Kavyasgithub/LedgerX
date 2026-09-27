from __future__ import annotations

from fastapi import APIRouter, Depends, Header
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.ledger.retry import run_in_transaction
from app.models.hold import HoldCaptureRequest, HoldCreate, HoldResponse
from app.models.transfer import TransferResponse
from app.services.hold_service import capture_hold, place_hold, release_hold

router = APIRouter(prefix="/v1/holds", tags=["holds"])


@router.post("", response_model=HoldResponse, status_code=201)
async def create_hold(
    body: HoldCreate,
    idempotency_key: str = Header(..., alias="Idempotency-Key"),
    db: AsyncSession = Depends(get_db),
):
    async def work():
        return await place_hold(db, body, idempotency_key, body.model_dump(mode="json"))

    return await run_in_transaction(db, work)


@router.post("/{hold_id}/capture", response_model=TransferResponse, status_code=201)
async def capture(
    hold_id: str,
    body: HoldCaptureRequest,
    idempotency_key: str = Header(..., alias="Idempotency-Key"),
    db: AsyncSession = Depends(get_db),
):
    async def work():
        return await capture_hold(
            db, hold_id, body, idempotency_key, body.model_dump(mode="json")
        )

    return await run_in_transaction(db, work)


@router.post("/{hold_id}/release", response_model=HoldResponse, status_code=200)
async def release(
    hold_id: str,
    idempotency_key: str = Header(..., alias="Idempotency-Key"),
    db: AsyncSession = Depends(get_db),
):
    async def work():
        return await release_hold(db, hold_id, idempotency_key, {"hold_id": hold_id})

    return await run_in_transaction(db, work)
