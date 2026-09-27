"""The ONLY place in the codebase that inserts transactions + postings.

Everything else routes through ``write_transaction``. This guarantees a single
choke point for the invariants: zero-sum, currency match, non-negative funds,
idempotency, hold consumption, and atomic cached-balance updates.
"""
from __future__ import annotations

import json

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain import natural_balance, natural_delta
from app.errors import LedgerError  # re-exported for backward-compatible imports
from app.ledger import idempotency
from app.ledger.balance import assert_sufficient_funds, update_cached_balance
from app.ledger.locks import lock_accounts
from app.models.transfer import PostingOut, TransferResponse

__all__ = ["LedgerError", "write_transaction"]


async def _load_hold_for_update(session: AsyncSession, hold_id: str) -> dict:
    row = (
        await session.execute(
            text(
                """
                SELECT id, account_id, amount, currency, status, expires_at,
                       expires_at < now() AS is_expired
                FROM holds WHERE id = :id FOR UPDATE
                """
            ),
            {"id": hold_id},
        )
    ).fetchone()
    if row is None:
        raise LedgerError("HOLD_NOT_ACTIVE", f"Hold {hold_id} not found.", status=404)
    if row.status != "active" or row.is_expired:
        raise LedgerError(
            "HOLD_NOT_ACTIVE",
            f"Hold {hold_id} is {row.status}{' (expired)' if row.is_expired else ''}.",
            status=422,
        )
    return dict(row._mapping)


async def write_transaction(
    session: AsyncSession,
    transaction_type: str,
    currency: str,
    postings: list[dict],  # [{"account_id", "account_reference", "amount"}]
    idempotency_key: str,
    endpoint: str,
    request_body: dict,
    reference_id: str | None = None,
    metadata: dict | None = None,
    reverses_transaction_id: str | None = None,
    consume_hold_id: str | None = None,
) -> TransferResponse:
    metadata = metadata or {}

    # Step 1 — claim the idempotency key (atomic). Replay returns stored response.
    stored = await idempotency.claim(session, idempotency_key, request_body, endpoint)
    if stored is not None:
        return TransferResponse(**stored)

    # Step 2 — validate the zero-sum invariant in app code (DB trigger is backstop).
    total = sum(p["amount"] for p in postings)
    if total != 0:
        raise LedgerError(
            code="UNBALANCED_TRANSACTION",
            message=f"Postings sum to {total}, must be zero.",
            status=422,
        )

    # Step 3 — lock every touched account in ascending UUID order.
    account_ids = [p["account_id"] for p in postings]
    locked = {str(a["id"]): a for a in await lock_accounts(session, account_ids)}

    # Step 3b — if consuming a hold, lock + validate it (kept inside the writer so
    # idempotent replays never re-run these checks against an already-consumed hold).
    hold = None
    if consume_hold_id is not None:
        hold = await _load_hold_for_update(session, consume_hold_id)
        if hold["currency"] != currency:
            raise LedgerError(
                "CURRENCY_MISMATCH",
                f"Hold currency {hold['currency']} does not match {currency}.",
            )
        held_acct = str(hold["account_id"])
        spend = -sum(
            natural_delta(p["amount"], locked[p["account_id"]]["normal_side"])
            for p in postings
            if p["account_id"] == held_acct and p["account_id"] in locked
        )
        if spend <= 0:
            raise LedgerError(
                "VALIDATION_ERROR",
                "Capture postings must debit the held account.",
                status=400,
            )
        if spend > hold["amount"]:
            raise LedgerError(
                "VALIDATION_ERROR",
                f"Capture amount {spend} exceeds hold amount {hold['amount']}.",
                status=422,
            )

    # Step 4 — currency agreement + existence.
    for p in postings:
        account = locked.get(p["account_id"])
        if account is None:
            raise LedgerError(
                code="ACCOUNT_NOT_FOUND",
                message=f"Account not found: {p['account_reference']}",
                status=404,
            )
        if account["currency"] != currency:
            raise LedgerError(
                code="CURRENCY_MISMATCH",
                message=(
                    f"Account {p['account_reference']} currency {account['currency']} "
                    f"does not match transaction currency {currency}."
                ),
                status=422,
            )

    # Step 5 — non-negative funds check on the available natural balance.
    for p in postings:
        await assert_sufficient_funds(
            session, locked[p["account_id"]], p["amount"], exclude_hold_id=consume_hold_id
        )

    # Step 6 — insert the transaction row.
    txn_row = (
        await session.execute(
            text(
                """
                INSERT INTO transactions
                    (transaction_type, reference_id, idempotency_key,
                     reverses_transaction_id, metadata)
                VALUES (:type, :ref, :idem, :reverses, :meta)
                RETURNING id, created_at
                """
            ),
            {
                "type": transaction_type,
                "ref": reference_id,
                "idem": idempotency_key,
                "reverses": reverses_transaction_id,
                "meta": json.dumps(metadata),
            },
        )
    ).fetchone()
    transaction_id = str(txn_row.id)

    # Step 7 — insert postings + update cached balances (natural resulting balance).
    posting_outs: list[PostingOut] = []
    for p in postings:
        posting_id = (
            await session.execute(
                text(
                    """
                    INSERT INTO postings (transaction_id, account_id, amount, currency)
                    VALUES (:txn_id, :acct_id, :amount, :currency)
                    RETURNING id
                    """
                ),
                {
                    "txn_id": transaction_id,
                    "acct_id": p["account_id"],
                    "amount": p["amount"],
                    "currency": currency,
                },
            )
        ).scalar()
        new_cached = await update_cached_balance(session, p["account_id"], p["amount"])
        account = locked[p["account_id"]]
        posting_outs.append(
            PostingOut(
                id=posting_id,
                account_reference=p["account_reference"],
                amount=p["amount"],
                resulting_balance=natural_balance(new_cached, account["normal_side"]),
            )
        )

    # Step 7b — consume the hold, linking it to this transaction.
    if hold is not None:
        await session.execute(
            text(
                "UPDATE holds SET status = 'consumed', transaction_id = :txn WHERE id = :id"
            ),
            {"txn": transaction_id, "id": consume_hold_id},
        )

    response = TransferResponse(
        transaction_id=transaction_id,
        transaction_type=transaction_type,
        reference_id=reference_id,
        currency=currency,
        created_at=txn_row.created_at,
        postings=posting_outs,
    )

    # Step 8 — persist the replayable response under the idempotency key.
    await idempotency.complete(
        session,
        idempotency_key,
        response.model_dump(mode="json"),
        transaction_id=transaction_id,
        response_status=201,
    )
    return response
