# training/generate_dataset.py
# Hybrid real (Deribit/yfinance snapshots) + synthetic (Black-Scholes) dataset builder.
import numpy as np
import pandas as pd
import glob
import os
from scipy.stats import norm


def bs_price(S, K, T, r, sigma, is_call):
    """Vectorized Black-Scholes for arrays. Returns array of prices."""
    T = np.clip(T, 1e-6, None)
    sigma = np.clip(sigma, 1e-6, None)

    d1 = (np.log(S / K) + (r + 0.5 * sigma**2) * T) / (sigma * np.sqrt(T))
    d2 = d1 - sigma * np.sqrt(T)

    call = S * norm.cdf(d1) - K * np.exp(-r * T) * norm.cdf(d2)
    put = K * np.exp(-r * T) * norm.cdf(-d2) - S * norm.cdf(-d1)
    return np.where(is_call == 1, call, put)


def generate_synthetic(n=400_000, seed=42, param_ranges=None):
    """Generate n synthetic samples using Black-Scholes."""
    rng = np.random.default_rng(seed)

    if param_ranges is None:
        # Defaults: realistic for BTC options
        param_ranges = {
            "S":     (20_000, 80_000),
            "K":     (15_000, 90_000),
            "T":     (1 / 365, 1.5),
            "r":     (0.02, 0.06),
            "sigma": (0.20, 1.50),
        }

    S = rng.uniform(*param_ranges["S"], n)
    K = rng.uniform(*param_ranges["K"], n)
    T = rng.uniform(*param_ranges["T"], n)
    r = rng.uniform(*param_ranges["r"], n)
    sigma = rng.uniform(*param_ranges["sigma"], n)
    is_call = rng.integers(0, 2, n)

    price = bs_price(S, K, T, r, sigma, is_call)

    df = pd.DataFrame({
        "S": S, "K": K, "T": T, "r": r, "sigma": sigma,
        "is_call": is_call, "mid_price": price, "source": "synthetic",
    })
    # Remove negative/zero prices (can occur for extreme parameters)
    return df[df["mid_price"] > 0]


def load_real_snapshots(snapshot_dir="data/snapshots"):
    files = glob.glob(f"{snapshot_dir}/*.parquet")
    if not files:
        print("No real snapshots found — using synthetic only.")
        return pd.DataFrame()
    dfs = [pd.read_parquet(f) for f in files]
    df = pd.concat(dfs, ignore_index=True)
    df["source"] = "real"
    print(f"Loaded {len(df):,} real rows from {len(files)} snapshots.")
    return df


def build_dataset(
    snapshot_dir="data/snapshots",
    n_synthetic=400_000,
    output_path="data/processed/dataset.parquet",
):
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    real_df = load_real_snapshots(snapshot_dir)

    # Build param ranges from real data if available (matches real market space)
    param_ranges = None
    if not real_df.empty:
        param_ranges = {
            "S":     (real_df["S"].quantile(0.01),     real_df["S"].quantile(0.99)),
            "K":     (real_df["K"].quantile(0.01),     real_df["K"].quantile(0.99)),
            "T":     (real_df["T"].quantile(0.01),     real_df["T"].quantile(0.99)),
            "r":     (real_df["r"].min(),              real_df["r"].max()),
            "sigma": (real_df["sigma"].quantile(0.01), real_df["sigma"].quantile(0.99)),
        }

    synth_df = generate_synthetic(n_synthetic, param_ranges=param_ranges)
    cols = ["S", "K", "T", "r", "sigma", "is_call", "mid_price", "source"]

    if not real_df.empty:
        for c in cols:
            if c not in real_df.columns:
                real_df[c] = np.nan
        combined = pd.concat([real_df[cols], synth_df[cols]], ignore_index=True)
    else:
        combined = synth_df[cols]

    # Feature engineering
    combined["moneyness"] = combined["S"] / combined["K"]
    combined["log_moneyness"] = np.log(combined["moneyness"])
    combined["sqrt_T"] = np.sqrt(combined["T"])

    # Final quality filters
    combined = combined.dropna()
    combined = combined[combined["mid_price"] > 0]
    combined = combined[np.isfinite(combined["log_moneyness"])]

    combined.to_parquet(output_path, index=False)
    print(f"\nDataset saved: {output_path}")
    print(f"Total rows: {len(combined):,}")
    print(combined[["S", "K", "T", "sigma", "is_call", "mid_price"]].describe().round(2))
    return combined


if __name__ == "__main__":
    build_dataset()
