from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.domain import defaults_for_type, natural_balance
from app.errors import LedgerError
from app.models.account import AccountCreate, AccountResponse
from app.models.transaction import StatementResponse
from app.services.statement_service import get_statement

router = APIRouter(prefix="/v1/accounts", tags=["accounts"])


@router.post("", response_model=AccountResponse, status_code=201)
async def create_account(body: AccountCreate, db: AsyncSession = Depends(get_db)):
    defaults = defaults_for_type(body.account_type)
    normal_side = body.normal_side or defaults["normal_side"]
    allows_negative = (
        body.allows_negative if body.allows_negative is not None else defaults["allows_negative"]
    )

    try:
        async with db.begin():
            row = (
                await db.execute(
                    text(
                        """
                        INSERT INTO accounts
                            (reference, account_type, currency, allows_negative, normal_side)
                        VALUES (:reference, :account_type, :currency, :allows_negative, :normal_side)
                        RETURNING id, reference, account_type, currency, allows_negative,
                                  normal_side, cached_balance, created_at
                        """
                    ),
                    {
                        "reference": body.reference,
                        "account_type": body.account_type,
                        "currency": body.currency,
                        "allows_negative": allows_negative,
                        "normal_side": normal_side,
                    },
                )
            ).fetchone()
    except IntegrityError:
        raise LedgerError(
            "VALIDATION_ERROR",
            f"Account with reference '{body.reference}' already exists.",
            status=409,
        )

    natural = natural_balance(row.cached_balance, row.normal_side)
    return AccountResponse(
        id=str(row.id),
        reference=row.reference,
        account_type=row.account_type,
        currency=row.currency,
        normal_side=row.normal_side,
        allows_negative=row.allows_negative,
        current_balance=natural,
        held_amount=0,
        available_balance=natural,
        created_at=row.created_at,
    )


@router.get("/{reference:path}/statement", response_model=StatementResponse)
async def account_statement(
    reference: str,
    limit: int = Query(50, ge=1, le=200),
    cursor: str | None = None,
    date_from: str | None = Query(None, alias="from"),
    date_to: str | None = Query(None, alias="to"),
    db: AsyncSession = Depends(get_db),
):
    async with db.begin():
        return await get_statement(db, reference, limit, cursor, date_from, date_to)


@router.get("/{reference:path}", response_model=AccountResponse)
async def get_account(reference: str, db: AsyncSession = Depends(get_db)):
    async with db.begin():
        row = (
            await db.execute(
                text(
                    """
                    SELECT id, reference, account_type, currency, allows_negative,
                           normal_side, cached_balance, created_at
                    FROM accounts WHERE reference = :reference
                    """
                ),
                {"reference": reference},
            )
        ).fetchone()
        if row is None:
            raise LedgerError("ACCOUNT_NOT_FOUND", f"Account not found: {reference}", status=404)

        held_amount = int(
            (
                await db.execute(
                    text(
                        "SELECT COALESCE(SUM(amount), 0) FROM holds "
                        "WHERE account_id = :id AND status = 'active'"
                    ),
                    {"id": str(row.id)},
                )
            ).scalar()
            or 0
        )

    natural = natural_balance(row.cached_balance, row.normal_side)
    return AccountResponse(
        id=str(row.id),
        reference=row.reference,
        account_type=row.account_type,
        currency=row.currency,
        normal_side=row.normal_side,
        allows_negative=row.allows_negative,
        current_balance=natural,
        held_amount=held_amount,
        available_balance=natural - held_amount,
        created_at=row.created_at,
    )
