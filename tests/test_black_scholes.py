"""Unit tests for the Black-Scholes pricer (README promises tests/ — these back it).

Run:  python -m pytest tests/test_black_scholes.py -v
  or: python tests/test_black_scholes.py
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from black_scholes import bs_price_and_greeks  # noqa: E402


def test_known_call_value():
    # Textbook case: S=K=100, T=1, r=5%, sigma=20% -> call = 10.45058357
    out = bs_price_and_greeks(100, 100, 1, 0.05, 0.20, 1)
    assert abs(out["price"] - 10.45058357) < 1e-6


def test_known_put_value():
    # Same inputs -> put = 5.57352602
    out = bs_price_and_greeks(100, 100, 1, 0.05, 0.20, 0)
    assert abs(out["price"] - 5.57352602) < 1e-6


def test_put_call_parity():
    # C - P = S - K*exp(-rT)
    S, K, T, r, sigma = 85000, 83000, 0.25, 0.045, 0.65
    call = bs_price_and_greeks(S, K, T, r, sigma, 1)["price"]
    put = bs_price_and_greeks(S, K, T, r, sigma, 0)["price"]
    import math
    parity = S - K * math.exp(-r * T)
    assert abs((call - put) - parity) < 1e-8


def test_delta_bounds_and_parity():
    c = bs_price_and_greeks(100, 100, 0.5, 0.03, 0.4, 1)
    p = bs_price_and_greeks(100, 100, 0.5, 0.03, 0.4, 0)
    # call delta in (0,1), put delta in (-1,0), and delta_call - delta_put = 1
    assert 0 < c["greeks"]["delta"] < 1
    assert -1 < p["greeks"]["delta"] < 0
    assert abs((c["greeks"]["delta"] - p["greeks"]["delta"]) - 1.0) < 1e-9


def test_non_negative_prices_and_greeks_present():
    out = bs_price_and_greeks(50000, 90000, 0.02, 0.04, 1.2, 1)
    assert out["price"] >= 0
    for g in ("delta", "gamma", "vega", "theta", "rho"):
        assert g in out["greeks"]
        assert isinstance(out["greeks"][g], float)


def test_degenerate_inputs_do_not_crash():
    # Near-zero maturity / vol must not divide by zero
    out = bs_price_and_greeks(100, 100, 0, 0.05, 0, 1)
    assert out["price"] >= 0


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for fn in fns:
        fn()
        print(f"PASS {fn.__name__}")
    print(f"\n{len(fns)} tests passed")
