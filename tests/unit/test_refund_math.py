"""Unit tests for the proportional-refund math and banker's rounding."""
from app.services.refund_service import _bankers_round, refund_split


def test_scenario_4_partial_refund_split():
    # INR 40 refund of an INR 100 payment with a 200-paise fee (scenario 4).
    merchant_return, fee_to_return = refund_split(10000, 200, 4000)
    assert fee_to_return == 80
    assert merchant_return == 3920
    assert merchant_return + fee_to_return == 4000  # sums to the refund amount


def test_full_refund_returns_entire_fee():
    merchant_return, fee_to_return = refund_split(10000, 200, 10000)
    assert fee_to_return == 200
    assert merchant_return == 9800


def test_refund_split_always_sums_to_refund_amount():
    for refund in range(0, 10001, 137):
        merchant_return, fee_to_return = refund_split(10000, 200, refund)
        assert merchant_return + fee_to_return == refund


def test_no_fee_payment_returns_zero_fee():
    merchant_return, fee_to_return = refund_split(10000, 0, 4000)
    assert fee_to_return == 0
    assert merchant_return == 4000


def test_bankers_rounding_half_to_even():
    # 0.5 -> 0, 1.5 -> 2, 2.5 -> 2, 3.5 -> 4 (round half to even).
    assert _bankers_round(1, 2) == 0
    assert _bankers_round(3, 2) == 2
    assert _bankers_round(5, 2) == 2
    assert _bankers_round(7, 2) == 4
