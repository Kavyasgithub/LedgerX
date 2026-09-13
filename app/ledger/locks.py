from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def lock_accounts(session: AsyncSession, account_ids: list[str]) -> list[dict]:
    sorted_ids = sorted(set(account_ids))
    result = await session.execute(
        text("""
            SELECT id, reference, account_type, currency, allows_negative, cached_balance
            FROM accounts
            WHERE id = ANY(:ids)
            ORDER BY id
            FOR UPDATE
        """),
        {"ids": sorted_ids},
    )
    return [dict(row._mapping) for row in result.fetchall()]
