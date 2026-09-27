"""Retry helper for transient Postgres conflicts (deadlock / serialization).

Wraps a unit of work that runs inside a single DB transaction and retries the
whole thing with capped exponential backoff + jitter on SQLSTATE 40P01
(deadlock) and 40001 (serialization failure). After the final attempt fails it
raises a LedgerError(TRANSIENT_CONFLICT, 503).
"""
from __future__ import annotations

import asyncio
import random
from typing import Awaitable, Callable, TypeVar

from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import LedgerError

T = TypeVar("T")

RETRYABLE_SQLSTATES = {"40001", "40P01"}
MAX_ATTEMPTS = 3
BASE_DELAY = 0.02  # seconds


def _sqlstate(exc: DBAPIError) -> str | None:
    orig = getattr(exc, "orig", None)
    return getattr(orig, "sqlstate", None) or getattr(orig, "pgcode", None)


async def run_in_transaction(
    db: AsyncSession, work: Callable[[], Awaitable[T]], max_attempts: int = MAX_ATTEMPTS
) -> T:
    """Run ``work`` inside ``db.begin()``, retrying on transient conflicts."""
    for attempt in range(max_attempts):
        try:
            async with db.begin():
                return await work()
        except DBAPIError as exc:
            if _sqlstate(exc) in RETRYABLE_SQLSTATES and attempt < max_attempts - 1:
                delay = BASE_DELAY * (2**attempt) + random.uniform(0, BASE_DELAY)
                await asyncio.sleep(delay)
                continue
            if _sqlstate(exc) in RETRYABLE_SQLSTATES:
                raise LedgerError(
                    code="TRANSIENT_CONFLICT",
                    message="The request conflicted with concurrent activity after retries. Retry with the same idempotency key.",
                    status=503,
                )
            raise
    # Unreachable, but keeps type-checkers happy.
    raise LedgerError(code="TRANSIENT_CONFLICT", message="Exhausted retries.", status=503)
