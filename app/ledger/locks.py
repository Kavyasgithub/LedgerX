"""Pessimistic account locking with a total order to make deadlock impossible."""
from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def lock_accounts(session: AsyncSession, account_ids: list[str]) -> list[dict]:
    """Lock the given accounts FOR UPDATE, always in ascending UUID order.

    A single global lock order means no cycle can ever form, so deadlocks are
    structurally impossible regardless of which account is source or dest.
    """
    sorted_ids = sorted(set(account_ids))
    result = await session.execute(
        text(
            """
            SELECT id, reference, account_type, currency, allows_negative,
                   normal_side, cached_balance, version
            FROM accounts
            WHERE id = ANY(:ids)
            ORDER BY id
            FOR UPDATE
            """
        ),
        {"ids": sorted_ids},
    )
    return [dict(row._mapping) for row in result.fetchall()]
