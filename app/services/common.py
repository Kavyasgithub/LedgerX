"""Helpers shared across services (account reference resolution)."""
from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import LedgerError


async def resolve_accounts(session: AsyncSession, references: list[str]) -> dict[str, dict]:
    """Map account references to their rows, raising ACCOUNT_NOT_FOUND if any miss."""
    result = await session.execute(
        text(
            """
            SELECT id, reference, account_type, currency, allows_negative,
                   normal_side, cached_balance
            FROM accounts WHERE reference = ANY(:refs)
            """
        ),
        {"refs": list(set(references))},
    )
    by_ref = {row.reference: dict(row._mapping) for row in result.fetchall()}
    for ref in references:
        if ref not in by_ref:
            raise LedgerError("ACCOUNT_NOT_FOUND", f"Account not found: {ref}", status=404)
    return by_ref


def resolve_postings(postings: list, by_ref: dict[str, dict]) -> list[dict]:
    """Turn request postings (with account_reference) into writer postings (with ids)."""
    return [
        {
            "account_id": str(by_ref[p.account_reference]["id"]),
            "account_reference": p.account_reference,
            "amount": p.amount,
        }
        for p in postings
    ]
