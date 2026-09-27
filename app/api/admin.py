from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.domain import natural_balance
from app.models.reconciliation import ReconciliationReport
from app.services.reconciliation_service import run_reconciliation

router = APIRouter(prefix="/v1/admin", tags=["admin"])


@router.post("/reconcile", response_model=ReconciliationReport)
async def reconcile(db: AsyncSession = Depends(get_db)):
    async with db.begin():
        return await run_reconciliation(db)


@router.get("/accounts")
async def list_accounts(db: AsyncSession = Depends(get_db)):
    """Convenience endpoint powering the dashboard: all accounts + natural balances."""
    async with db.begin():
        rows = (
            await db.execute(
                text(
                    """
                    SELECT a.reference, a.account_type, a.currency, a.normal_side,
                           a.allows_negative, a.cached_balance,
                           COALESCE(h.held, 0) AS held
                    FROM accounts a
                    LEFT JOIN (
                        SELECT account_id, SUM(amount) AS held
                        FROM holds WHERE status = 'active' GROUP BY account_id
                    ) h ON h.account_id = a.id
                    ORDER BY a.reference
                    """
                )
            )
        ).fetchall()
        global_sum = int(
            (await db.execute(text("SELECT COALESCE(SUM(amount), 0) FROM postings"))).scalar()
            or 0
        )

    accounts = []
    for r in rows:
        natural = natural_balance(r.cached_balance, r.normal_side)
        held = int(r.held or 0)
        accounts.append(
            {
                "reference": r.reference,
                "account_type": r.account_type,
                "currency": r.currency,
                "normal_side": r.normal_side,
                "allows_negative": r.allows_negative,
                "cached_balance": int(r.cached_balance),  # raw signed (dr +, cr -)
                "current_balance": natural,
                "held_amount": held,
                "available_balance": natural - held,
            }
        )
    return {"accounts": accounts, "global_sum": global_sum}


@router.get("/journal")
async def journal(limit: int = 50, db: AsyncSession = Depends(get_db)):
    """Recent transactions, each with its postings — the append-only journal."""
    async with db.begin():
        txns = (
            await db.execute(
                text(
                    """
                    SELECT t.id, t.transaction_type, t.reference_id, t.idempotency_key,
                           t.reverses_transaction_id, t.created_at, rev.id AS reversed_by
                    FROM transactions t
                    LEFT JOIN transactions rev ON rev.reverses_transaction_id = t.id
                    ORDER BY t.created_at DESC, t.id DESC
                    LIMIT :limit
                    """
                ),
                {"limit": max(1, min(limit, 200))},
            )
        ).fetchall()
        ids = [str(t.id) for t in txns]
        postings_by_txn: dict[str, list] = {i: [] for i in ids}
        if ids:
            prows = (
                await db.execute(
                    text(
                        """
                        SELECT p.transaction_id, a.reference, p.amount
                        FROM postings p JOIN accounts a ON a.id = p.account_id
                        WHERE p.transaction_id = ANY(:ids)
                        ORDER BY p.id
                        """
                    ),
                    {"ids": ids},
                )
            ).fetchall()
            for pr in prows:
                postings_by_txn[str(pr.transaction_id)].append(
                    {"account_reference": pr.reference, "amount": int(pr.amount)}
                )

    return {
        "transactions": [
            {
                "id": str(t.id),
                "type": t.transaction_type,
                "reference_id": t.reference_id,
                "idempotency_key": t.idempotency_key,
                "reverses_transaction_id": str(t.reverses_transaction_id)
                if t.reverses_transaction_id
                else None,
                "reversed_by": str(t.reversed_by) if t.reversed_by else None,
                "created_at": t.created_at.isoformat(),
                "postings": postings_by_txn[str(t.id)],
            }
            for t in txns
        ]
    }


@router.get("/holds")
async def list_holds(status: str = "active", db: AsyncSession = Depends(get_db)):
    async with db.begin():
        rows = (
            await db.execute(
                text(
                    """
                    SELECT h.id, a.reference, h.amount, h.currency, h.status, h.expires_at
                    FROM holds h JOIN accounts a ON a.id = h.account_id
                    WHERE h.status = :status
                    ORDER BY h.created_at DESC
                    """
                ),
                {"status": status},
            )
        ).fetchall()
    return {
        "holds": [
            {
                "id": str(r.id),
                "account_reference": r.reference,
                "amount": int(r.amount),
                "currency": r.currency,
                "status": r.status,
                "expires_at": r.expires_at.isoformat(),
            }
            for r in rows
        ]
    }


@router.get("/ledger")
async def global_ledger(
    limit: int = 100, account: str | None = None, db: AsyncSession = Depends(get_db)
):
    """Recent postings across all accounts (newest first) with per-account running
    natural balance. Powers the live Ledger View."""
    where = ""
    params: dict = {"limit": max(1, min(limit, 500))}
    if account:
        where = "WHERE a.reference = :account"
        params["account"] = account

    async with db.begin():
        rows = (
            await db.execute(
                text(
                    f"""
                    SELECT id, created_at, transaction_type, reference, normal_side, amount,
                           running_cached
                    FROM (
                        SELECT p.id, p.created_at, t.transaction_type, a.reference,
                               a.normal_side, p.amount,
                               SUM(p.amount) OVER (
                                   PARTITION BY p.account_id
                                   ORDER BY p.created_at, p.id
                               ) AS running_cached
                        FROM postings p
                        JOIN transactions t ON t.id = p.transaction_id
                        JOIN accounts a ON a.id = p.account_id
                        {where}
                    ) sub
                    ORDER BY created_at DESC, id DESC
                    LIMIT :limit
                    """
                ),
                params,
            )
        ).fetchall()

    return {
        "postings": [
            {
                "id": r.id,
                "created_at": r.created_at.isoformat(),
                "transaction_type": r.transaction_type,
                "account_reference": r.reference,
                "amount": r.amount,
                "running_balance": natural_balance(r.running_cached, r.normal_side),
            }
            for r in rows
        ]
    }
