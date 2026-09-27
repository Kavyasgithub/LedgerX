"""Unit tests for the sign convention (natural balance / natural delta)."""
from app.domain import natural_balance, natural_delta


def test_credit_normal_holds_value_as_negative_cached():
    # A wallet holding INR 500 has cached_balance -50000 but natural +50000.
    assert natural_balance(-50000, "credit") == 50000
    assert natural_balance(0, "credit") == 0


def test_debit_normal_holds_value_as_positive_cached():
    # bank:settlement (asset) holds value as a positive cached balance.
    assert natural_balance(50000, "debit") == 50000


def test_natural_delta_signs():
    # Spending from a wallet (+ posting on credit-normal) reduces natural balance.
    assert natural_delta(10000, "credit") == -10000
    # A debit posting on an asset increases its natural balance.
    assert natural_delta(10000, "debit") == 10000


def test_summed_deltas_equal_natural_of_summed_cached():
    postings = [-50000, 10000, -4000]  # topup, spend, refund-credit
    cached = sum(postings)
    from_deltas = sum(natural_delta(p, "credit") for p in postings)
    assert from_deltas == natural_balance(cached, "credit")
