"""Property-based tests for the money math (pure, fast, no DB)."""
from hypothesis import given
from hypothesis import strategies as st

from app.domain import natural_balance, natural_delta
from app.services.refund_service import refund_split

amounts = st.integers(min_value=1, max_value=10_000_000)


@given(original=amounts, fee=st.integers(min_value=0, max_value=1_000_000), refund=amounts)
def test_refund_split_always_sums_to_refund(original, fee, refund):
    # Constrain to valid combinations.
    fee = min(fee, original)
    refund = min(refund, original)
    merchant_return, fee_to_return = refund_split(original, fee, refund)
    assert merchant_return + fee_to_return == refund
    assert 0 <= fee_to_return <= fee
    assert merchant_return >= 0


@given(cached=st.integers(min_value=-10**12, max_value=10**12))
def test_natural_balance_involution(cached):
    # Applying the credit-normal flip twice returns the original.
    assert natural_balance(natural_balance(cached, "credit"), "credit") == cached
    # Debit-normal is identity.
    assert natural_balance(cached, "debit") == cached


@given(postings=st.lists(st.integers(min_value=-10**9, max_value=10**9), min_size=1, max_size=50))
def test_summed_natural_deltas_match_natural_of_sum(postings):
    for side in ("debit", "credit"):
        summed = sum(natural_delta(p, side) for p in postings)
        assert summed == natural_balance(sum(postings), side)
