import hashlib
import json
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.ledger.locks import lock_accounts
from app.ledger.balance import update_cached_balance, get_active_holds_total
from app.models.transfer import TransferResponse, PostingOut


class LedgerError(Exception):
    def __init__(self, code: str, message: str, status: int = 422, details: dict = None):
        self.code = code
        self.message = message
        self.status = status
        self.details = details or {}


def _fingerprint(body: dict) -> str:
    canonical = json.dumps(body, sort_keys=True)
    return hashlib.sha256(canonical.encode()).hexdigest()


async def write_transaction(
    session: AsyncSession,
    transaction_type: str,
    currency: str,
    postings: list[dict],  # [{"account_id": str, "account_reference": str, "amount": int}]
    idempotency_key: str,
    endpoint: str,
    request_body: dict,
    reference_id: str | None = None,
    metadata: dict = {},
) -> TransferResponse:

    fingerprint = _fingerprint(request_body)

    # Step 1 — try to claim the idempotency key
    existing = await session.execute(
        text("SELECT status, request_fingerprint, response_body FROM idempotency_keys WHERE key = :key"),
        {"key": idempotency_key},
    )
    existing_row = existing.fetchone()

    if existing_row:
        if existing_row.request_fingerprint != fingerprint:
            raise LedgerError(
                code="IDEMPOTENCY_KEY_REUSED",
                message="This idempotency key was used with a different request payload.",
                status=422,
            )
        if existing_row.status == "completed":
            return TransferResponse(**existing_row.response_body)
        if existing_row.status == "in_progress":
            raise LedgerError(
                code="REQUEST_IN_PROGRESS",
                message="A request with this idempotency key is already being processed.",
                status=409,
            )

    await session.execute(
        text("""
            INSERT INTO idempotency_keys (key, request_fingerprint, endpoint, status)
            VALUES (:key, :fingerprint, :endpoint, 'in_progress')
        """),
        {"key": idempotency_key, "fingerprint": fingerprint, "endpoint": endpoint},
    )

    # Step 2 — validate postings sum to zero
    total = sum(p["amount"] for p in postings)
    if total != 0:
        raise LedgerError(
            code="UNBALANCED_TRANSACTION",
            message=f"Postings sum to {total}, must be zero.",
            status=422,
        )

    # Step 3 — lock accounts in sorted UUID order
    account_ids = [p["account_id"] for p in postings]
    locked_accounts = await lock_accounts(session, account_ids)
    locked_map = {str(a["id"]): a for a in locked_accounts}

    # Step 4 — check currency and balance
    for posting in postings:
        account = locked_map.get(posting["account_id"])
        if not account:
            raise LedgerError(
                code="ACCOUNT_NOT_FOUND",
                message=f"Account not found: {posting['account_reference']}",
                status=404,
            )
        if account["currency"] != currency:
            raise LedgerError(
                code="CURRENCY_MISMATCH",
                message=f"Account {posting['account_reference']} currency {account['currency']} does not match {currency}.",
                status=422,
            )

    # Step 5 — check available balance for accounts that cannot go negative
    for posting in postings:
        account = locked_map[posting["account_id"]]
        if not account["allows_negative"] and posting["amount"] > 0:
            holds_total = await get_active_holds_total(session, posting["account_id"])
            available = account["cached_balance"] - holds_total
            if available - posting["amount"] < 0:
                raise LedgerError(
                    code="INSUFFICIENT_FUNDS",
                    message=f"Account {posting['account_reference']} has available balance {available}, required {posting['amount']}.",
                    status=422,
                    details={
                        "account_reference": posting["account_reference"],
                        "available_balance": available,
                        "required": posting["amount"],
                    },
                )

    # Step 6 — insert transaction
    txn_result = await session.execute(
        text("""
            INSERT INTO transactions (transaction_type, reference_id, idempotency_key, metadata)
            VALUES (:type, :ref, :idem, :meta)
            RETURNING id, created_at
        """),
        {
            "type": transaction_type,
            "ref": reference_id,
            "idem": idempotency_key,
            "meta": json.dumps(metadata),
        },
    )
    txn_row = txn_result.fetchone()
    transaction_id = str(txn_row.id)
    created_at = txn_row.created_at

    # Step 7 — insert postings and update cached balances
    posting_outs = []
    for posting in postings:
        p_result = await session.execute(
            text("""
                INSERT INTO postings (transaction_id, account_id, amount, currency)
                VALUES (:txn_id, :acct_id, :amount, :currency)
                RETURNING id
            """),
            {
                "txn_id": transaction_id,
                "acct_id": posting["account_id"],
                "amount": posting["amount"],
                "currency": currency,
            },
        )
        posting_id = p_result.scalar()
        new_balance = await update_cached_balance(session, posting["account_id"], posting["amount"])
        posting_outs.append(
            PostingOut(
                id=posting_id,
                account_reference=posting["account_reference"],
                amount=posting["amount"],
                resulting_balance=new_balance,
            )
        )

    # Step 8 — build response
    response = TransferResponse(
        transaction_id=transaction_id,
        transaction_type=transaction_type,
        reference_id=reference_id,
        currency=currency,
        created_at=created_at,
        postings=posting_outs,
    )

    # Step 9 — mark idempotency key completed with stored response
    await session.execute(
        text("""
            UPDATE idempotency_keys
            SET status = 'completed',
                transaction_id = :txn_id,
                response_status = 201,
                response_body = :body,
                completed_at = now()
            WHERE key = :key
        """),
        {
            "txn_id": transaction_id,
            "body": json.dumps(response.model_dump(mode="json")),
            "key": idempotency_key,
        },
    )

    return response
