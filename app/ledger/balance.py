"""Balance reads and the non-negative funds check (natural-balance aware)."""
from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain import natural_balance, natural_delta
from app.errors import LedgerError


async def get_active_holds_total(
    session: AsyncSession, account_id: str, exclude_hold_id: str | None = None
) -> int:
    """Sum of active holds (natural units) on an account, optionally excluding one
    hold that is being consumed in the same transaction (capture)."""
    result = await session.execute(
        text(
            """
            SELECT COALESCE(SUM(amount), 0) AS total
            FROM holds
            WHERE account_id = :account_id
              AND status = 'active'
              AND (CAST(:exclude AS uuid) IS NULL OR id <> CAST(:exclude AS uuid))
            """
        ),
        {"account_id": account_id, "exclude": exclude_hold_id},
    )
    return int(result.scalar() or 0)


async def update_cached_balance(session: AsyncSession, account_id: str, delta: int) -> int:
    result = await session.execute(
        text(
            """
            UPDATE accounts
            SET cached_balance = cached_balance + :delta,
                version = version + 1
            WHERE id = :account_id
            RETURNING cached_balance
            """
        ),
        {"delta": delta, "account_id": account_id},
    )
    return int(result.scalar())


async def assert_sufficient_funds(
    session: AsyncSession,
    account: dict,
    amount: int,
    exclude_hold_id: str | None = None,
) -> None:
    """Enforce FR-5 against the account's AVAILABLE natural balance.

    An account with ``allows_negative=False`` may never let its available
    natural balance (natural balance minus active holds) drop below zero.
    """
    if account["allows_negative"]:
        return

    normal_side = account["normal_side"]
    delta = natural_delta(amount, normal_side)
    if delta >= 0:
        return  # this posting increases the natural balance; never a shortfall

    holds_total = await get_active_holds_total(
        session, str(account["id"]), exclude_hold_id
    )
    available = natural_balance(account["cached_balance"], normal_side) - holds_total
    if available + delta < 0:
        raise LedgerError(
            code="INSUFFICIENT_FUNDS",
            message=(
                f"Account {account['reference']} has available balance {available}, "
                f"required {-delta}."
            ),
            status=422,
            details={
                "account_reference": account["reference"],
                "available_balance": available,
                "required": -delta,
            },
        )
