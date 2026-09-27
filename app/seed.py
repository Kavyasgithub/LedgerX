"""Seed the standard chart of accounts. Idempotent: run it as many times as you like.

    python -m app.seed
"""
from __future__ import annotations

import asyncio

from sqlalchemy import text

from app.db.session import engine
from app.domain import ACCOUNT_TYPES

# (reference, account_type). normal_side + allows_negative come from ACCOUNT_TYPES.
CHART = [
    ("customer:c1:wallet", "customer_wallet"),
    ("customer:c2:wallet", "customer_wallet"),
    ("merchant:m1:balance", "merchant_balance"),
    ("merchant:m2:balance", "merchant_balance"),
    ("platform:fee_revenue", "income"),
    ("platform:gateway_expense", "expense"),
    ("platform:chargeback_loss", "expense"),
    ("bank:settlement", "asset"),
    ("bank:suspense", "asset"),
    ("tax:payable", "liability"),
]


async def seed() -> None:
    async with engine.begin() as conn:
        for reference, account_type in CHART:
            meta = ACCOUNT_TYPES[account_type]
            await conn.execute(
                text(
                    """
                    INSERT INTO accounts
                        (reference, account_type, currency, allows_negative, normal_side)
                    VALUES (:reference, :account_type, 'INR', :allows_negative, :normal_side)
                    ON CONFLICT (reference) DO NOTHING
                    """
                ),
                {
                    "reference": reference,
                    "account_type": account_type,
                    "allows_negative": meta["allows_negative"],
                    "normal_side": meta["normal_side"],
                },
            )
    await engine.dispose()
    print(f"Seeded {len(CHART)} accounts (existing ones left untouched).")


if __name__ == "__main__":
    asyncio.run(seed())
