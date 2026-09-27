from __future__ import annotations

from decimal import ROUND_HALF_EVEN, Decimal

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import LedgerError
from app.ledger.writer import write_transaction
from app.models.refund import RefundRequest
from app.models.transfer import TransferResponse

FEE_ACCOUNT = "platform:fee_revenue"


def _bankers_round(numerator: int, denominator: int) -> int:
    """Banker's (round-half-to-even) division of two integers -> integer."""
    return int(
        (Decimal(numerator) / Decimal(denominator)).quantize(
            Decimal("1"), rounding=ROUND_HALF_EVEN
        )
    )


def refund_split(
    original_customer_amount: int, original_fee: int, refund_amount: int
) -> tuple[int, int]:
    """Pure proportional-refund math. Returns (merchant_return, fee_to_return).

    The residual paise always lands on the merchant leg so the three refund
    postings sum to exactly zero regardless of rounding.
    """
    fee_to_return = (
        _bankers_round(original_fee * refund_amount, original_customer_amount)
        if original_fee
        else 0
    )
    merchant_return = refund_amount - fee_to_return
    return merchant_return, fee_to_return


async def _load_payment(session: AsyncSession, payment_id: str) -> dict:
    txn = (
        await session.execute(
            text("SELECT id, reference_id FROM transactions WHERE id = :id"),
            {"id": payment_id},
        )
    ).fetchone()
    if txn is None:
        raise LedgerError(
            "TRANSACTION_NOT_FOUND", f"Payment {payment_id} not found.", status=404
        )
    postings = (
        await session.execute(
            text(
                """
                SELECT a.reference AS reference, p.amount AS amount
                FROM postings p JOIN accounts a ON a.id = p.account_id
                WHERE p.transaction_id = :id
                """
            ),
            {"id": payment_id},
        )
    ).fetchall()
    return {"reference_id": txn.reference_id, "postings": postings}


async def refund_payment(
    session: AsyncSession,
    payment_id: str,
    request: RefundRequest,
    idempotency_key: str,
    request_body: dict,
) -> TransferResponse:
    payment = await _load_payment(session, payment_id)

    customer_ref = merchant_ref = None
    original_customer_amount = 0
    original_fee = 0
    for p in payment["postings"]:
        if p.reference.startswith("customer:"):
            customer_ref = p.reference
            original_customer_amount = p.amount  # positive spend, e.g. +10000
        elif p.reference.startswith("merchant:"):
            merchant_ref = p.reference
        elif p.reference == FEE_ACCOUNT:
            original_fee = -p.amount  # fee posting is negative, e.g. -200 -> 200

    if customer_ref is None or original_customer_amount <= 0:
        raise LedgerError(
            "VALIDATION_ERROR",
            f"Transaction {payment_id} is not a refundable payment.",
            status=422,
        )

    refund_amount = request.amount if request.amount is not None else original_customer_amount

    # Cumulative refund guard (checked inside the locked write transaction below too,
    # but a fast pre-check gives a clean error).
    already = int(
        (
            await session.execute(
                text(
                    """
                    SELECT COALESCE(SUM((metadata->>'refund_amount')::bigint), 0) AS total
                    FROM transactions
                    WHERE transaction_type = 'refund'
                      AND metadata->>'refunds_of' = :pid
                    """
                ),
                {"pid": payment_id},
            )
        ).scalar()
        or 0
    )

    if already + refund_amount > original_customer_amount:
        raise LedgerError(
            "REFUND_EXCEEDS_ORIGINAL",
            f"Refund {refund_amount} plus prior {already} exceeds original {original_customer_amount}.",
            details={
                "original_amount": original_customer_amount,
                "already_refunded": already,
                "requested": refund_amount,
            },
        )

    merchant_return, fee_to_return = refund_split(
        original_customer_amount, original_fee, refund_amount
    )

    postings: list[dict] = []
    if merchant_ref and merchant_return != 0:
        postings.append({"account_reference": merchant_ref, "amount": merchant_return})
    if fee_to_return != 0:
        postings.append({"account_reference": FEE_ACCOUNT, "amount": fee_to_return})
    postings.append({"account_reference": customer_ref, "amount": -refund_amount})

    # Resolve to ids.
    from app.services.common import resolve_accounts

    by_ref = await resolve_accounts(session, [p["account_reference"] for p in postings])
    resolved = [
        {
            "account_id": str(by_ref[p["account_reference"]]["id"]),
            "account_reference": p["account_reference"],
            "amount": p["amount"],
        }
        for p in postings
    ]

    currency = by_ref[customer_ref]["currency"]
    return await write_transaction(
        session=session,
        transaction_type="refund",
        currency=currency,
        postings=resolved,
        idempotency_key=idempotency_key,
        endpoint=f"/v1/payments/{payment_id}/refund",
        request_body=request_body,
        reference_id=payment["reference_id"],
        metadata={
            "refunds_of": payment_id,
            "refund_amount": refund_amount,
            "reason": request.reason,
        },
    )
