"""Keyset-paginated account statement with correct absolute running balances.

Never uses OFFSET pagination: financial rows shift as new postings arrive, which
would duplicate or skip entries mid-scroll. The cursor encodes (created_at, id)
of the last (oldest) row returned so the next page reads strictly older rows.
"""
from __future__ import annotations

import base64
import json
from datetime import datetime

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain import natural_balance
from app.errors import LedgerError
from app.models.transaction import StatementEntry, StatementResponse


def _encode_cursor(created_at: datetime, posting_id: int) -> str:
    raw = json.dumps({"t": created_at.isoformat(), "id": posting_id})
    return base64.urlsafe_b64encode(raw.encode()).decode()


def _decode_cursor(cursor: str) -> tuple[str, int]:
    try:
        data = json.loads(base64.urlsafe_b64decode(cursor.encode()).decode())
        return data["t"], int(data["id"])
    except Exception:
        raise LedgerError("VALIDATION_ERROR", "Invalid statement cursor.", status=400)


async def get_statement(
    session: AsyncSession,
    reference: str,
    limit: int = 50,
    cursor: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
) -> StatementResponse:
    limit = max(1, min(limit, 200))

    account = (
        await session.execute(
            text("SELECT id, normal_side FROM accounts WHERE reference = :ref"),
            {"ref": reference},
        )
    ).fetchone()
    if account is None:
        raise LedgerError("ACCOUNT_NOT_FOUND", f"Account not found: {reference}", status=404)
    account_id = str(account.id)
    normal_side = account.normal_side

    params: dict = {"acct": account_id, "limit": limit + 1}
    where = ["p.account_id = :acct"]
    if cursor:
        c_time, c_id = _decode_cursor(cursor)
        where.append("(p.created_at, p.id) < (:c_time, :c_id)")
        params["c_time"] = c_time
        params["c_id"] = c_id
    if date_from:
        where.append("p.created_at >= :date_from")
        params["date_from"] = date_from
    if date_to:
        where.append("p.created_at <= :date_to")
        params["date_to"] = date_to

    rows = (
        await session.execute(
            text(
                f"""
                SELECT p.id, p.transaction_id, t.transaction_type, p.amount, p.created_at
                FROM postings p JOIN transactions t ON t.id = p.transaction_id
                WHERE {' AND '.join(where)}
                ORDER BY p.created_at DESC, p.id DESC
                LIMIT :limit
                """
            ),
            params,
        )
    ).fetchall()

    has_more = len(rows) > limit
    page = rows[:limit]

    next_cursor = None
    if page and has_more:
        last = page[-1]
        next_cursor = _encode_cursor(last.created_at, last.id)

    # Absolute running balance: sum of all postings strictly older than the oldest
    # row on this page forms the base; accumulate upward from there.
    entries: list[StatementEntry] = []
    if page:
        oldest = page[-1]
        base_cached = int(
            (
                await session.execute(
                    text(
                        """
                        SELECT COALESCE(SUM(amount), 0) FROM postings
                        WHERE account_id = :acct
                          AND (created_at, id) < (:t, :id)
                        """
                    ),
                    {"acct": account_id, "t": oldest.created_at, "id": oldest.id},
                )
            ).scalar()
            or 0
        )
        running = base_cached
        # Walk oldest -> newest so running balances accumulate correctly.
        for row in reversed(page):
            running += row.amount
            entries.append(
                StatementEntry(
                    posting_id=row.id,
                    transaction_id=str(row.transaction_id),
                    transaction_type=row.transaction_type,
                    amount=row.amount,
                    running_balance=natural_balance(running, normal_side),
                    created_at=row.created_at,
                )
            )
        entries.reverse()  # present newest-first

    return StatementResponse(
        account_reference=reference, entries=entries, next_cursor=next_cursor
    )
