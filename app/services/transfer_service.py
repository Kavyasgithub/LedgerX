from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.ledger.writer import write_transaction
from app.models.transfer import TransferRequest, TransferResponse
from app.services.common import resolve_accounts, resolve_postings


async def execute_transfer(
    session: AsyncSession,
    request: TransferRequest,
    idempotency_key: str,
    request_body: dict,
) -> TransferResponse:
    references = [p.account_reference for p in request.postings]
    by_ref = await resolve_accounts(session, references)
    resolved = resolve_postings(request.postings, by_ref)

    return await write_transaction(
        session=session,
        transaction_type=request.transaction_type,
        currency=request.currency,
        postings=resolved,
        idempotency_key=idempotency_key,
        endpoint="/v1/transfers",
        request_body=request_body,
        reference_id=request.reference_id,
        metadata=request.metadata,
    )
