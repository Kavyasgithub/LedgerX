from fastapi import APIRouter, Depends, Header, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.models.transfer import TransferRequest, TransferResponse
from app.services.transfer_service import execute_transfer
from app.ledger.writer import LedgerError
from fastapi.responses import JSONResponse

router = APIRouter(prefix="/v1/transfers", tags=["transfers"])


@router.post("", response_model=TransferResponse, status_code=201)
async def create_transfer(
    request: Request,
    body: TransferRequest,
    idempotency_key: str = Header(..., alias="Idempotency-Key"),
    db: AsyncSession = Depends(get_db),
):
    try:
        async with db.begin():
            response = await execute_transfer(
                session=db,
                request=body,
                idempotency_key=idempotency_key,
                request_body=body.model_dump(mode="json"),
            )
        return response
    except LedgerError as e:
        return JSONResponse(
            status_code=e.status,
            content={
                "error": {
                    "code": e.code,
                    "message": e.message,
                    "details": e.details,
                }
            },
        )
