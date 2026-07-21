import numpy as np
from scipy.stats import norm


def bs_price_and_greeks(S, K, T, r, sigma, is_call):
    """
    Compute Black-Scholes price and all five Greeks.
    S       : spot price
    K       : strike price
    T       : time to maturity in years
    r       : risk-free rate (decimal, e.g. 0.045)
    sigma   : implied volatility (decimal, e.g. 0.72)
    is_call : 1 for call, 0 for put
    Returns : dict with keys 'price' and 'greeks'
    """
    T     = max(float(T),     1e-8)
    sigma = max(float(sigma), 1e-8)
    S, K, r = float(S), float(K), float(r)

    d1 = (np.log(S / K) + (r + 0.5 * sigma ** 2) * T) / (sigma * np.sqrt(T))
    d2 = d1 - sigma * np.sqrt(T)

    if is_call == 1:
        price = S * norm.cdf(d1) - K * np.exp(-r * T) * norm.cdf(d2)
        delta = float(norm.cdf(d1))
        rho   = float(K * T * np.exp(-r * T) * norm.cdf(d2)  / 100)
        theta = float((-S * norm.pdf(d1) * sigma / (2 * np.sqrt(T))
                       - r * K * np.exp(-r * T) * norm.cdf(d2)) / 365)
    else:
        price = K * np.exp(-r * T) * norm.cdf(-d2) - S * norm.cdf(-d1)
        delta = float(norm.cdf(d1) - 1)
        rho   = float(-K * T * np.exp(-r * T) * norm.cdf(-d2) / 100)
        theta = float((-S * norm.pdf(d1) * sigma / (2 * np.sqrt(T))
                       + r * K * np.exp(-r * T) * norm.cdf(-d2)) / 365)

    gamma = float(norm.pdf(d1) / (S * sigma * np.sqrt(T)))
    vega  = float(S * norm.pdf(d1) * np.sqrt(T) / 100)

    return {
        "price": float(price),
        "greeks": {
            "delta": delta,
            "gamma": gamma,
            "vega":  vega,
            "theta": theta,
            "rho":   rho,
        }
    }