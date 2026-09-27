"""Test harness: a dedicated, migrated, freshly-seeded Postgres database.

Uses the Postgres from docker-compose but an isolated database (``ledger_test``)
so the dev data is never touched. Each test gets its own async engine bound to
the running event loop (avoiding cross-loop connection reuse), the schema is
migrated once per session, and every test starts from a clean chart of accounts.
"""
from __future__ import annotations

import asyncio
import os

import pytest

# Point the whole app at the isolated test database BEFORE app modules import.
TEST_DB = "ledger_test"
ADMIN_DSN = "postgresql://ledger:ledger@localhost:5432/postgres"
TEST_URL = f"postgresql+asyncpg://ledger:ledger@localhost:5432/{TEST_DB}"
os.environ["DATABASE_URL"] = TEST_URL

import asyncpg  # noqa: E402
import httpx  # noqa: E402
from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from sqlalchemy import text  # noqa: E402
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine  # noqa: E402

from app.domain import ACCOUNT_TYPES  # noqa: E402
from app.seed import CHART  # noqa: E402


async def _create_test_db() -> None:
    conn = await asyncpg.connect(ADMIN_DSN)
    try:
        exists = await conn.fetchval("SELECT 1 FROM pg_database WHERE datname = $1", TEST_DB)
        if not exists:
            await conn.execute(f'CREATE DATABASE "{TEST_DB}"')
    finally:
        await conn.close()


@pytest.fixture(scope="session", autouse=True)
def _prepare_database():
    # Runs in a sync context (no running loop), so alembic's asyncio.run is safe.
    asyncio.run(_create_test_db())
    command.upgrade(Config("alembic.ini"), "head")  # env.py reads DATABASE_URL -> test DB
    yield


@pytest.fixture
async def db_engine():
    """A fresh engine bound to the current test's event loop, cleaned + seeded."""
    engine = create_async_engine(TEST_URL, pool_size=30, max_overflow=70, pool_pre_ping=True)
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
    yield engine
    await engine.dispose()


@pytest.fixture
async def client(db_engine):
    from app.db.session import get_db
    from app.main import app

    TestSession = async_sessionmaker(db_engine, expire_on_commit=False)

    async def _override_get_db():
        async with TestSession() as session:
            yield session

    app.dependency_overrides[get_db] = _override_get_db
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()
