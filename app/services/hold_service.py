from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain import natural_balance
from app.errors import LedgerError
from app.ledger import idempotency
from app.ledger.balance import get_active_holds_total
from app.ledger.writer import write_transaction
from app.models.hold import HoldCaptureRequest, HoldCreate, HoldResponse
from app.models.transfer import TransferResponse
from app.services.common import resolve_accounts, resolve_postings


def _hold_response(row) -> HoldResponse:
    return HoldResponse(
        id=str(row.id),
        account_reference=row.reference,
        amount=row.amount,
        currency=row.currency,
        status=row.status,
        transaction_id=str(row.transaction_id) if row.transaction_id else None,
        expires_at=row.expires_at,
        created_at=row.created_at,
    )


async def place_hold(
    session: AsyncSession, request: HoldCreate, idempotency_key: str, request_body: dict
) -> HoldResponse:
    stored = await idempotency.claim(session, idempotency_key, request_body, "/v1/holds")
    if stored is not None:
        return HoldResponse(**stored)

    by_ref = await resolve_accounts(session, [request.account_reference])
    account = by_ref[request.account_reference]

    # Lock the account so the availability check races cleanly with transfers.
    locked = (
        await session.execute(
            text(
                "SELECT id, cached_balance, allows_negative, normal_side, currency "
                "FROM accounts WHERE id = :id FOR UPDATE"
            ),
            {"id": str(account["id"])},
        )
    ).fetchone()

    if locked.currency != request.currency:
        raise LedgerError(
            "CURRENCY_MISMATCH",
            f"Account currency {locked.currency} does not match {request.currency}.",
        )

    if not locked.allows_negative:
        holds_total = await get_active_holds_total(session, str(account["id"]))
        available = natural_balance(locked.cached_balance, locked.normal_side) - holds_total
        if available < request.amount:
            raise LedgerError(
                "INSUFFICIENT_FUNDS",
                f"Account {request.account_reference} has available balance {available}, "
                f"cannot hold {request.amount}.",
                details={
                    "account_reference": request.account_reference,
                    "available_balance": available,
                    "required": request.amount,
                },
            )

    row = (
        await session.execute(
            text(
                """
                INSERT INTO holds (account_id, amount, currency, status, expires_at)
                VALUES (:acct, :amount, :currency, 'active',
                        now() + make_interval(secs => :ttl))
                RETURNING id, amount, currency, status, transaction_id,
                          expires_at, created_at
                """
            ),
            {
                "acct": str(account["id"]),
                "amount": request.amount,
                "currency": request.currency,
                "ttl": request.expires_in_seconds,
            },
        )
    ).fetchone()

    resp = HoldResponse(
        id=str(row.id),
        account_reference=request.account_reference,
        amount=row.amount,
        currency=row.currency,
        status=row.status,
        transaction_id=None,
        expires_at=row.expires_at,
        created_at=row.created_at,
    )
    await idempotency.complete(
        session, idempotency_key, resp.model_dump(mode="json"), response_status=201
    )
    return resp


async def capture_hold(
    session: AsyncSession,
    hold_id: str,
    request: HoldCaptureRequest,
    idempotency_key: str,
    request_body: dict,
) -> TransferResponse:
    # write_transaction owns idempotency + hold validation/consumption atomically.
    by_ref = await resolve_accounts(session, [p.account_reference for p in request.postings])
    resolved = resolve_postings(request.postings, by_ref)
    return await write_transaction(
        session=session,
        transaction_type=request.transaction_type,
        currency=request.currency,
        postings=resolved,
        idempotency_key=idempotency_key,
        endpoint=f"/v1/holds/{hold_id}/capture",
        request_body=request_body,
        reference_id=request.reference_id,
        metadata={**request.metadata, "hold_id": hold_id},
        consume_hold_id=hold_id,
    )


async def release_hold(
    session: AsyncSession, hold_id: str, idempotency_key: str, request_body: dict
) -> HoldResponse:
    stored = await idempotency.claim(
        session, idempotency_key, request_body, f"/v1/holds/{hold_id}/release"
    )
    if stored is not None:
        return HoldResponse(**stored)

    locked = (
        await session.execute(
            text("SELECT id, status FROM holds WHERE id = :id FOR UPDATE"),
            {"id": hold_id},
        )
    ).fetchone()
    if locked is None:
        raise LedgerError("HOLD_NOT_ACTIVE", f"Hold {hold_id} not found.", status=404)
    if locked.status != "active":
        raise LedgerError(
            "HOLD_NOT_ACTIVE", f"Hold {hold_id} is {locked.status}, cannot release."
        )

    row = (
        await session.execute(
            text(
                """
                UPDATE holds SET status = 'released' WHERE id = :id
                RETURNING id, account_id, amount, currency, status, transaction_id,
                          expires_at, created_at
                """
            ),
            {"id": hold_id},
        )
    ).fetchone()
    ref = (
        await session.execute(
            text("SELECT reference FROM accounts WHERE id = :id"),
            {"id": str(row.account_id)},
        )
    ).scalar()

    resp = HoldResponse(
        id=str(row.id),
        account_reference=ref,
        amount=row.amount,
        currency=row.currency,
        status=row.status,
        transaction_id=str(row.transaction_id) if row.transaction_id else None,
        expires_at=row.expires_at,
        created_at=row.created_at,
    )
    await idempotency.complete(
        session, idempotency_key, resp.model_dump(mode="json"), response_status=200
    )
    return resp
