"""Idempotency-key handling shared by every write endpoint.

The key is claimed atomically with ``INSERT ... ON CONFLICT DO NOTHING`` so two
concurrent requests can never both proceed. A losing caller either:
  * blocks until the winner commits, then sees the stored response (completed),
  * finds a mismatching fingerprint  -> IDEMPOTENCY_KEY_REUSED,
  * or finds the winner still in progress -> REQUEST_IN_PROGRESS.

Because failed work rolls back (including the in_progress claim row), only
successful operations leave a persistent, replayable record.
"""
from __future__ import annotations

import hashlib
import json
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import LedgerError


def fingerprint(body: dict) -> str:
    canonical = json.dumps(body, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode()).hexdigest()


async def claim(
    session: AsyncSession, key: str, request_body: dict, endpoint: str
) -> dict | None:
    """Try to claim ``key``. Returns None if we won (caller proceeds), or the
    stored response dict if a completed identical request already exists."""
    fp = fingerprint(request_body)

    claimed = await session.execute(
        text(
            """
            INSERT INTO idempotency_keys (key, request_fingerprint, endpoint, status)
            VALUES (:key, :fp, :endpoint, 'in_progress')
            ON CONFLICT (key) DO NOTHING
            RETURNING key
            """
        ),
        {"key": key, "fp": fp, "endpoint": endpoint},
    )
    if claimed.fetchone() is not None:
        return None  # we own it; proceed with the work

    existing = await session.execute(
        text(
            "SELECT status, request_fingerprint, response_body FROM idempotency_keys WHERE key = :key"
        ),
        {"key": key},
    )
    row = existing.fetchone()
    if row is None:
        # Extremely rare race (winner rolled back between our insert and select).
        raise LedgerError(
            code="REQUEST_IN_PROGRESS",
            message="A concurrent request with this key is being processed. Retry shortly.",
            status=409,
        )
    if row.request_fingerprint != fp:
        raise LedgerError(
            code="IDEMPOTENCY_KEY_REUSED",
            message="This idempotency key was already used with a different request payload.",
            status=422,
        )
    if row.status == "completed":
        return row.response_body
    raise LedgerError(
        code="REQUEST_IN_PROGRESS",
        message="A request with this idempotency key is already being processed. Retry shortly.",
        status=409,
    )


async def complete(
    session: AsyncSession,
    key: str,
    response_body: dict,
    transaction_id: str | None = None,
    response_status: int = 201,
) -> None:
    await session.execute(
        text(
            """
            UPDATE idempotency_keys
            SET status = 'completed',
                transaction_id = :txn_id,
                response_status = :rs,
                response_body = :body,
                completed_at = now()
            WHERE key = :key
            """
        ),
        {
            "txn_id": transaction_id,
            "rs": response_status,
            "body": json.dumps(response_body),
            "key": key,
        },
    )
