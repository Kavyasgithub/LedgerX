"""Reset the dev ledger to a clean, seeded state.

    python -m scripts.reset_db
"""
import asyncio

from sqlalchemy import text

from app.db.session import engine
from app.domain import ACCOUNT_TYPES
from app.seed import CHART


async def main() -> None:
    async with engine.begin() as conn:
        await conn.execute(
            text(
                "TRUNCATE postings, transactions, holds, idempotency_keys, accounts "
                "RESTART IDENTITY CASCADE"
            )
        )
        for reference, account_type in CHART:
            meta = ACCOUNT_TYPES[account_type]
            await conn.execute(
                text(
                    """
                    INSERT INTO accounts
                        (reference, account_type, currency, allows_negative, normal_side)
                    VALUES (:r, :t, 'INR', :neg, :side)
                    """
                ),
                {
                    "r": reference,
                    "t": account_type,
                    "neg": meta["allows_negative"],
                    "side": meta["normal_side"],
                },
            )
    await engine.dispose()
    print(f"Ledger reset: truncated + seeded {len(CHART)} accounts.")


if __name__ == "__main__":
    asyncio.run(main())
