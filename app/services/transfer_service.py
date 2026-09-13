from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.ledger.writer import write_transaction, LedgerError
from app.models.transfer import TransferRequest, TransferResponse


async def execute_transfer(
    session: AsyncSession,
    request: TransferRequest,
    idempotency_key: str,
    request_body: dict,
) -> TransferResponse:

    # Resolve account references to IDs
    references = [p.account_reference for p in request.postings]
    result = await session.execute(
        text("SELECT id, reference, currency, allows_negative FROM accounts WHERE reference = ANY(:refs)"),
        {"refs": references},
    )
    rows = result.fetchall()
    account_map = {row.reference: row for row in rows}

    # Validate all accounts exist
    for ref in references:
        if ref not in account_map:
            raise LedgerError(
                code="ACCOUNT_NOT_FOUND",
                message=f"Account not found: {ref}",
                status=404,
            )

    # Build resolved postings with account IDs
    resolved_postings = [
        {
            "account_id": str(account_map[p.account_reference].id),
            "account_reference": p.account_reference,
            "amount": p.amount,
        }
        for p in request.postings
    ]

    return await write_transaction(
        session=session,
        transaction_type=request.transaction_type,
        currency=request.currency,
        postings=resolved_postings,
        idempotency_key=idempotency_key,
        endpoint="/v1/transfers",
        request_body=request_body,
        reference_id=request.reference_id,
        metadata=request.metadata,
    )
