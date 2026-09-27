from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.reconciliation import ReconciliationCheck, ReconciliationReport


async def run_reconciliation(session: AsyncSession) -> ReconciliationReport:
    checks: list[ReconciliationCheck] = []

    total_postings = int(
        (await session.execute(text("SELECT COUNT(*) FROM postings"))).scalar() or 0
    )

    # 1 — Global balance: every rupee accounted for.
    global_sum = int(
        (await session.execute(text("SELECT COALESCE(SUM(amount), 0) FROM postings"))).scalar()
        or 0
    )
    checks.append(
        ReconciliationCheck(
            name="global_balance",
            passed=global_sum == 0,
            detail=f"SUM(postings.amount) = {global_sum}",
        )
    )

    # 2 — Per-transaction balance.
    unbalanced = (
        await session.execute(
            text(
                """
                SELECT transaction_id, SUM(amount) AS total
                FROM postings GROUP BY transaction_id HAVING SUM(amount) <> 0
                """
            )
        )
    ).fetchall()
    checks.append(
        ReconciliationCheck(
            name="per_transaction_balance",
            passed=len(unbalanced) == 0,
            detail=f"{len(unbalanced)} unbalanced transaction group(s)",
            discrepancies=[
                {"transaction_id": str(r.transaction_id), "sum": int(r.total)}
                for r in unbalanced
            ],
        )
    )

    # 3 — Cached vs derived balance per account.
    drift = (
        await session.execute(
            text(
                """
                SELECT a.reference, a.cached_balance,
                       COALESCE(SUM(p.amount), 0) AS derived
                FROM accounts a
                LEFT JOIN postings p ON p.account_id = a.id
                GROUP BY a.id, a.reference, a.cached_balance
                HAVING a.cached_balance <> COALESCE(SUM(p.amount), 0)
                """
            )
        )
    ).fetchall()
    checks.append(
        ReconciliationCheck(
            name="cached_vs_derived",
            passed=len(drift) == 0,
            detail=f"{len(drift)} account(s) with cached/derived drift",
            discrepancies=[
                {
                    "reference": r.reference,
                    "cached": int(r.cached_balance),
                    "derived": int(r.derived),
                }
                for r in drift
            ],
        )
    )

    # 4 — Negative-balance policy on natural balance.
    negatives = (
        await session.execute(
            text(
                """
                SELECT reference, cached_balance, normal_side,
                       CASE WHEN normal_side = 'debit' THEN cached_balance
                            ELSE -cached_balance END AS natural_balance
                FROM accounts
                WHERE allows_negative = FALSE
                  AND (CASE WHEN normal_side = 'debit' THEN cached_balance
                            ELSE -cached_balance END) < 0
                """
            )
        )
    ).fetchall()
    checks.append(
        ReconciliationCheck(
            name="negative_balance_policy",
            passed=len(negatives) == 0,
            detail=f"{len(negatives)} non-negative account(s) below zero",
            discrepancies=[
                {"reference": r.reference, "natural_balance": int(r.natural_balance)}
                for r in negatives
            ],
        )
    )

    # 5 — Orphan postings (FKs make these impossible; verify anyway).
    orphans = int(
        (
            await session.execute(
                text(
                    """
                    SELECT COUNT(*) FROM postings p
                    LEFT JOIN transactions t ON t.id = p.transaction_id
                    LEFT JOIN accounts a ON a.id = p.account_id
                    WHERE t.id IS NULL OR a.id IS NULL
                    """
                )
            )
        ).scalar()
        or 0
    )
    checks.append(
        ReconciliationCheck(
            name="orphan_postings",
            passed=orphans == 0,
            detail=f"{orphans} orphan posting(s)",
        )
    )

    # 6 — Stale holds (active but past expiry).
    stale = (
        await session.execute(
            text(
                """
                SELECT h.id, a.reference
                FROM holds h JOIN accounts a ON a.id = h.account_id
                WHERE h.status = 'active' AND h.expires_at < now()
                """
            )
        )
    ).fetchall()
    checks.append(
        ReconciliationCheck(
            name="stale_holds",
            passed=len(stale) == 0,
            detail=f"{len(stale)} active hold(s) past expiry",
            discrepancies=[
                {"hold_id": str(r.id), "account_reference": r.reference} for r in stale
            ],
        )
    )

    # 7 — Suspense drift.
    suspense = int(
        (
            await session.execute(
                text(
                    """
                    SELECT COALESCE(SUM(p.amount), 0)
                    FROM postings p JOIN accounts a ON a.id = p.account_id
                    WHERE a.reference = 'bank:suspense'
                    """
                )
            )
        ).scalar()
        or 0
    )
    checks.append(
        ReconciliationCheck(
            name="suspense_drift",
            passed=suspense == 0,
            detail=f"bank:suspense balance = {suspense}",
        )
    )

    return ReconciliationReport(
        ok=all(c.passed for c in checks),
        ran_at=datetime.now(timezone.utc),
        postings_scanned=total_postings,
        checks=checks,
    )
