from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def get_active_holds_total(session: AsyncSession, account_id: str) -> int:
    result = await session.execute(
        text("""
            SELECT COALESCE(SUM(amount), 0) AS total
            FROM holds
            WHERE account_id = :account_id AND status = 'active'
        """),
        {"account_id": account_id},
    )
    return int(result.scalar())


async def update_cached_balance(
    session: AsyncSession, account_id: str, delta: int
) -> int:
    result = await session.execute(
        text("""
            UPDATE accounts
            SET cached_balance = cached_balance + :delta,
                version = version + 1
            WHERE id = :account_id
            RETURNING cached_balance
        """),
        {"delta": delta, "account_id": account_id},
    )
    return int(result.scalar())
