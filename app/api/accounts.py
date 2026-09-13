from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.models.account import AccountCreate, AccountResponse

router = APIRouter(prefix="/v1/accounts", tags=["accounts"])


@router.post("", response_model=AccountResponse, status_code=201)
async def create_account(body: AccountCreate, db: AsyncSession = Depends(get_db)):
    async with db.begin():
        result = await db.execute(
            text("""
                INSERT INTO accounts (reference, account_type, currency, allows_negative)
                VALUES (:reference, :account_type, :currency, :allows_negative)
                RETURNING id, reference, account_type, currency, allows_negative,
                          cached_balance, created_at
            """),
            body.model_dump(),
        )
        row = result.fetchone()
        if not row:
            raise HTTPException(status_code=500, detail="Failed to create account")

    return AccountResponse(
        id=str(row.id),
        reference=row.reference,
        account_type=row.account_type,
        currency=row.currency,
        allows_negative=row.allows_negative,
        current_balance=row.cached_balance,
        held_amount=0,
        available_balance=row.cached_balance,
        created_at=row.created_at,
    )


@router.get("/{reference:path}", response_model=AccountResponse)
async def get_account(reference: str, db: AsyncSession = Depends(get_db)):
    async with db.begin():
        result = await db.execute(
            text("""
                SELECT id, reference, account_type, currency, allows_negative,
                       cached_balance, created_at
                FROM accounts WHERE reference = :reference
            """),
            {"reference": reference},
        )
        row = result.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Account not found")

        holds_result = await db.execute(
            text("""
                SELECT COALESCE(SUM(amount), 0) as total
                FROM holds WHERE account_id = :id AND status = 'active'
            """),
            {"id": str(row.id)},
        )
        held_amount = holds_result.scalar() or 0

    return AccountResponse(
        id=str(row.id),
        reference=row.reference,
        account_type=row.account_type,
        currency=row.currency,
        allows_negative=row.allows_negative,
        current_balance=row.cached_balance,
        held_amount=held_amount,
        available_balance=row.cached_balance - held_amount,
        created_at=row.created_at,
    )
