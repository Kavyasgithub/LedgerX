"""Domain metadata: account types, normal sides, and balance math.

Sign convention (strict double-entry):
  * ``cached_balance`` is the raw signed sum of an account's postings.
  * Debit-normal accounts (assets, expenses) hold value as a POSITIVE cached
    balance. Their natural balance == cached_balance.
  * Credit-normal accounts (liabilities, income) hold value as a NEGATIVE
    cached balance. Their natural balance == -cached_balance.

The "natural balance" is what a human expects to see (a wallet holding INR 500
shows +50000), and is what the non-negative policy (FR-5) is enforced against.
"""
from __future__ import annotations

DEBIT = "debit"
CREDIT = "credit"

# Canonical account types -> (normal_side, default allows_negative).
ACCOUNT_TYPES: dict[str, dict] = {
    "customer_wallet": {"normal_side": CREDIT, "allows_negative": False},
    "merchant_balance": {"normal_side": CREDIT, "allows_negative": False},
    "income": {"normal_side": CREDIT, "allows_negative": True},
    "liability": {"normal_side": CREDIT, "allows_negative": True},
    "asset": {"normal_side": DEBIT, "allows_negative": True},
    "expense": {"normal_side": DEBIT, "allows_negative": True},
}


def defaults_for_type(account_type: str) -> dict:
    """Return sensible defaults for a known account type (credit-normal fallback)."""
    return ACCOUNT_TYPES.get(
        account_type, {"normal_side": CREDIT, "allows_negative": False}
    )


def natural_balance(cached_balance: int, normal_side: str) -> int:
    """Convert a signed cached balance into its human-facing natural balance."""
    return cached_balance if normal_side == DEBIT else -cached_balance


def natural_delta(amount: int, normal_side: str) -> int:
    """How a posting of ``amount`` changes the account's natural balance."""
    return amount if normal_side == DEBIT else -amount
