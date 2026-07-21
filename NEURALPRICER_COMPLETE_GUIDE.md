# NeuralPricer — Complete Build Guide
## From Scratch to a Production Web Dashboard

---

## PART 0 — Technology Stack Decision

You are building:
- **Backend:** Python (FastAPI) — serves the trained PyTorch model via REST API
- **Frontend:** React + Recharts + TailwindCSS — the actual dashboard website
- **Model:** PyTorch MLP trained on Google Colab T4
- **Data:** Deribit API (crypto options) + yfinance (US equity options)
- **Bridge:** The trained model is exported and loaded by FastAPI, React calls the API

```
┌────────────────────────────────────────────────────────────────┐
│                      ARCHITECTURE MAP                          │
│                                                                │
│  DERIBIT / YFINANCE API                                        │
│         │                                                      │
│         ▼                                                      │
│  [Data Collector] → parquet files → [Training Pipeline]        │
│                                            │                   │
│                                            ▼                   │
│                                    [PyTorch Model]             │
│                                            │                   │
│                                    model.pt + scalers          │
│                                            │                   │
│                                            ▼                   │
│                                   [FastAPI Backend]            │
│                                     /api/price                 │
│                                     /api/greeks                │
│                                     /api/live-chain            │
│                                            │                   │
│                                            ▼                   │
│                              [React Dashboard Frontend]        │
│                           Pricer | Greeks | Live Chain         │
└────────────────────────────────────────────────────────────────┘
```

---

## PART 1 — Environment Setup (Local Machine)

### Step 1.1 — Folder Structure

Create this exact structure on your machine:

```
neuralpricer/
├── backend/
│   ├── main.py                  # FastAPI app
│   ├── model_loader.py          # Load PyTorch model + scalers
│   ├── pricer.py                # Inference logic
│   ├── black_scholes.py         # BS analytical reference
│   ├── data_collector.py        # Live API pulling
│   └── requirements.txt
├── frontend/
│   ├── public/
│   ├── src/
│   │   ├── App.jsx
│   │   ├── pages/
│   │   │   ├── Pricer.jsx
│   │   │   ├── Greeks.jsx
│   │   │   ├── LiveChain.jsx
│   │   │   └── Benchmark.jsx
│   │   ├── components/
│   │   │   ├── Navbar.jsx
│   │   │   ├── PriceCard.jsx
│   │   │   ├── GreeksPanel.jsx
│   │   │   └── ChainTable.jsx
│   │   └── api/
│   │       └── neuralpricer.js
│   ├── package.json
│   └── tailwind.config.js
├── training/
│   ├── generate_dataset.py
│   ├── train.py
│   ├── model.py
│   ├── evaluate.py
│   └── requirements_colab.txt
├── models/
│   ├── best_model.pt
│   ├── scaler_X.pkl
│   └── scaler_y.pkl
└── data/
    ├── snapshots/
    └── processed/
```

### Step 1.2 — Python Environment

```bash
# In your terminal, from the neuralpricer/ root
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate

# Install backend dependencies
cd backend
pip install fastapi uvicorn torch numpy pandas scikit-learn \
            scipy yfinance requests pyarrow joblib python-multipart
```

### Step 1.3 — Node.js Environment (for React frontend)

```bash
# Make sure Node.js 18+ is installed: https://nodejs.org
node --version     # should print v18.x.x or higher

cd frontend
npx create-react-app .          # scaffolds React into frontend/
npm install recharts axios tailwindcss @headlessui/react lucide-react
npx tailwindcss init
```

---

## PART 2 — DATA COLLECTION (Step by Step)

### Step 2.1 — Understanding What Data You Need

Each row in your dataset represents one option contract at one point in time:

| Column | Description | Example |
|---|---|---|
| S | Spot price of underlying | 42000.0 (BTC) |
| K | Strike price | 43000.0 |
| T | Time to maturity (years) | 0.25 |
| r | Risk-free rate | 0.045 |
| sigma | Implied volatility (decimal) | 0.72 |
| is_call | 1 = call, 0 = put | 1 |
| mid_price | (bid + ask) / 2 — your label | 1850.20 |
| moneyness | S / K | 0.9767 |
| log_moneyness | log(S/K) | -0.0237 |
| sqrt_T | sqrt(T) | 0.5 |

### Step 2.2 — Deribit Data Collector

Save as `backend/data_collector.py`:

```python
# backend/data_collector.py
import requests
import pandas as pd
import numpy as np
from datetime import datetime
import time
import os

DERIBIT_BASE = "https://www.deribit.com/api/v2/public"

def get_spot_price(currency="BTC"):
    """Fetch the current index price for BTC or ETH."""
    resp = requests.get(
        f"{DERIBIT_BASE}/get_index_price",
        params={"index_name": f"{currency.lower()}_usd"},
        timeout=10
    )
    resp.raise_for_status()
    return resp.json()["result"]["index_price"]

def get_instruments(currency="BTC"):
    """Fetch all active option instruments."""
    resp = requests.get(
        f"{DERIBIT_BASE}/get_instruments",
        params={"currency": currency, "kind": "option", "expired": "false"},
        timeout=10
    )
    resp.raise_for_status()
    return resp.json()["result"]

def get_ticker(instrument_name):
    """Fetch live ticker data for one instrument."""
    resp = requests.get(
        f"{DERIBIT_BASE}/ticker",
        params={"instrument_name": instrument_name},
        timeout=5
    )
    if resp.status_code != 200:
        return None
    return resp.json()["result"]

def fetch_full_snapshot(currency="BTC", risk_free_rate=0.045):
    """
    Pull a complete snapshot of all active options for the given currency.
    Returns a cleaned DataFrame ready for feature engineering.
    """
    print(f"[{datetime.utcnow()}] Fetching {currency} spot price...")
    spot = get_spot_price(currency)
    print(f"  Spot: {spot:,.2f}")

    instruments = get_instruments(currency)
    print(f"  Found {len(instruments)} active option instruments")

    rows = []
    for i, instr in enumerate(instruments):
        name = instr["instrument_name"]
        ticker = get_ticker(name)
        if ticker is None:
            continue

        # Skip if no meaningful data
        if not ticker.get("mark_iv") or not ticker.get("mark_price"):
            continue
        if ticker.get("best_bid_price") is None or ticker.get("best_ask_price") is None:
            continue

        # Compute time to maturity in years
        expiry_ms = instr["expiration_timestamp"]
        expiry_dt = datetime.utcfromtimestamp(expiry_ms / 1000)
        T = (expiry_dt - datetime.utcnow()).total_seconds() / (365 * 24 * 3600)
        if T <= 0:
            continue

        bid = ticker["best_bid_price"]
        ask = ticker["best_ask_price"]
        mid_price = (bid + ask) / 2 * spot  # convert BTC units → USD

        rows.append({
            "instrument": name,
            "S": spot,
            "K": instr["strike"],
            "T": T,
            "r": risk_free_rate,
            "sigma": ticker["mark_iv"] / 100.0,   # Deribit gives IV in %
            "is_call": 1 if instr["option_type"] == "call" else 0,
            "mid_price": mid_price,
            "bid_usd": bid * spot,
            "ask_usd": ask * spot,
            "volume": ticker.get("stats", {}).get("volume", 0),
            "open_interest": ticker.get("open_interest", 0),
            "snapshot_time": datetime.utcnow().isoformat(),
            "currency": currency,
        })

        # Polite delay — Deribit rate limit is generous but respect it
        if i % 50 == 49:
            time.sleep(0.5)

    df = pd.DataFrame(rows)
    if df.empty:
        print("  WARNING: empty snapshot.")
        return df

    # Feature engineering
    df["moneyness"] = df["S"] / df["K"]
    df["log_moneyness"] = np.log(df["moneyness"])
    df["sqrt_T"] = np.sqrt(df["T"])

    # Data quality filters
    df = df[df["mid_price"] > 0]
    df = df[df["sigma"] > 0]
    df = df[df["T"] > 1/365]   # at least 1 day to expiry
    df = df[df["mid_price"] < df["S"]]  # price can't exceed spot

    print(f"  Clean rows: {len(df)}")
    return df

def run_snapshot_loop(
    n_snapshots=288,
    interval_seconds=300,
    currencies=["BTC", "ETH"],
    save_dir="data/snapshots"
):
    """
    Collect n_snapshots snapshots at fixed intervals.
    288 snapshots at 5-min intervals = 1 full day of data.
    Run this locally while Colab trains your model separately.
    """
    os.makedirs(save_dir, exist_ok=True)

    for i in range(n_snapshots):
        print(f"\n=== Snapshot {i+1}/{n_snapshots} ===")
        all_dfs = []
        for currency in currencies:
            try:
                df = fetch_full_snapshot(currency)
                if not df.empty:
                    all_dfs.append(df)
            except Exception as e:
                print(f"  ERROR fetching {currency}: {e}")

        if all_dfs:
            combined = pd.concat(all_dfs, ignore_index=True)
            fname = f"{save_dir}/snap_{int(time.time())}.parquet"
            combined.to_parquet(fname, index=False)
            print(f"  Saved: {fname} ({len(combined)} rows)")

        if i < n_snapshots - 1:
            print(f"  Sleeping {interval_seconds}s...")
            time.sleep(interval_seconds)

if __name__ == "__main__":
    # Quick test: single snapshot
    df = fetch_full_snapshot("BTC")
    print(df[["S","K","T","sigma","is_call","mid_price","moneyness"]].head(10))
    print(f"\nTotal rows in snapshot: {len(df)}")
```

Run the collector:
```bash
# Single test snapshot
python backend/data_collector.py

# Full day loop (run in a terminal and leave it going)
python -c "from data_collector import run_snapshot_loop; run_snapshot_loop(288, 300)"
```

### Step 2.3 — yfinance Collector (US Equity Options)

```python
# Add this to backend/data_collector.py

import yfinance as yf

def fetch_yfinance_snapshot(tickers=["AAPL","SPY","TSLA","NVDA"], risk_free_rate=0.045):
    """Fetch full option chains for a list of US equity tickers."""
    all_dfs = []

    for symbol in tickers:
        try:
            ticker = yf.Ticker(symbol)
            spot = ticker.history(period="1d")["Close"].iloc[-1]
            today = pd.Timestamp(datetime.now().date())

            for expiry in ticker.options:
                chain = ticker.option_chain(expiry)
                for opt_type, df in [("call", chain.calls), ("put", chain.puts)]:
                    df = df.copy()
                    expiry_date = pd.to_datetime(expiry)
                    T = (expiry_date - today).days / 365.0
                    if T <= 0:
                        continue

                    df["S"] = spot
                    df["K"] = df["strike"]
                    df["T"] = T
                    df["r"] = risk_free_rate
                    df["sigma"] = df["impliedVolatility"]
                    df["is_call"] = 1 if opt_type == "call" else 0
                    df["mid_price"] = (df["bid"] + df["ask"]) / 2
                    df["ticker"] = symbol
                    df["snapshot_time"] = datetime.utcnow().isoformat()

                    all_dfs.append(df[[
                        "S","K","T","r","sigma","is_call",
                        "mid_price","bid","ask","volume","openInterest",
                        "ticker","snapshot_time"
                    ]])

        except Exception as e:
            print(f"  ERROR for {symbol}: {e}")

    if not all_dfs:
        return pd.DataFrame()

    result = pd.concat(all_dfs, ignore_index=True)
    result = result.rename(columns={"openInterest": "open_interest"})

    # Feature engineering
    result["moneyness"] = result["S"] / result["K"]
    result["log_moneyness"] = np.log(result["moneyness"])
    result["sqrt_T"] = np.sqrt(result["T"])

    # Quality filters
    result = result[result["mid_price"] > 0]
    result = result[result["sigma"] > 0]
    result = result[result["T"] > 1/365]

    return result
```

---

## PART 3 — DATASET GENERATION (Training Pipeline)

### Step 3.1 — Combining Real + Synthetic Data

Save as `training/generate_dataset.py`:

```python
# training/generate_dataset.py
import numpy as np
import pandas as pd
import glob
import os
from scipy.stats import norm

# ─── Black-Scholes (vectorized, fast) ────────────────────────────────────────

def bs_price(S, K, T, r, sigma, is_call):
    """Vectorized Black-Scholes for arrays. Returns array of prices."""
    # Clip T to avoid division by zero for very short maturities
    T = np.clip(T, 1e-6, None)
    sigma = np.clip(sigma, 1e-6, None)

    d1 = (np.log(S / K) + (r + 0.5 * sigma**2) * T) / (sigma * np.sqrt(T))
    d2 = d1 - sigma * np.sqrt(T)

    call = S * norm.cdf(d1) - K * np.exp(-r * T) * norm.cdf(d2)
    put  = K * np.exp(-r * T) * norm.cdf(-d2) - S * norm.cdf(-d1)
    return np.where(is_call == 1, call, put)

# ─── Synthetic generation ─────────────────────────────────────────────────────

def generate_synthetic(n=400_000, seed=42, param_ranges=None):
    """
    Generate n synthetic samples using Black-Scholes.
    param_ranges lets you match the distribution to real data.
    """
    rng = np.random.default_rng(seed)

    if param_ranges is None:
        # Defaults: realistic for BTC options
        param_ranges = {
            "S":     (20_000, 80_000),
            "K":     (15_000, 90_000),
            "T":     (1/365, 1.5),
            "r":     (0.02, 0.06),
            "sigma": (0.20, 1.50),
        }

    S     = rng.uniform(*param_ranges["S"], n)
    K     = rng.uniform(*param_ranges["K"], n)
    T     = rng.uniform(*param_ranges["T"], n)
    r     = rng.uniform(*param_ranges["r"], n)
    sigma = rng.uniform(*param_ranges["sigma"], n)
    is_call = rng.integers(0, 2, n)

    price = bs_price(S, K, T, r, sigma, is_call)

    df = pd.DataFrame({
        "S": S, "K": K, "T": T, "r": r, "sigma": sigma,
        "is_call": is_call, "mid_price": price,
        "source": "synthetic"
    })
    # Remove negative/zero prices (can occur for extreme parameters)
    df = df[df["mid_price"] > 0]
    return df

# ─── Load real snapshots ──────────────────────────────────────────────────────

def load_real_snapshots(snapshot_dir="data/snapshots"):
    files = glob.glob(f"{snapshot_dir}/*.parquet")
    if not files:
        print("No real snapshots found. Using synthetic only.")
        return pd.DataFrame()

    dfs = []
    for f in files:
        dfs.append(pd.read_parquet(f))
    df = pd.concat(dfs, ignore_index=True)
    df["source"] = "real"
    print(f"Loaded {len(df)} real rows from {len(files)} snapshots")
    return df

# ─── Build final dataset ──────────────────────────────────────────────────────

def build_dataset(
    snapshot_dir="data/snapshots",
    n_synthetic=400_000,
    output_path="data/processed/dataset.parquet"
):
    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    # Load real data
    real_df = load_real_snapshots(snapshot_dir)

    # Build param ranges from real data if available
    if not real_df.empty:
        param_ranges = {
            "S":     (real_df["S"].quantile(0.01), real_df["S"].quantile(0.99)),
            "K":     (real_df["K"].quantile(0.01), real_df["K"].quantile(0.99)),
            "T":     (real_df["T"].quantile(0.01), real_df["T"].quantile(0.99)),
            "r":     (real_df["r"].min(), real_df["r"].max()),
            "sigma": (real_df["sigma"].quantile(0.01), real_df["sigma"].quantile(0.99)),
        }
    else:
        param_ranges = None

    synth_df = generate_synthetic(n_synthetic, param_ranges=param_ranges)

    # Columns to keep
    cols = ["S","K","T","r","sigma","is_call","mid_price","source"]

    if not real_df.empty:
        real_df = real_df[real_df.columns.intersection(cols + ["moneyness","log_moneyness","sqrt_T"])]
        # Align columns
        for c in cols:
            if c not in real_df.columns:
                real_df[c] = np.nan
        combined = pd.concat([real_df[cols], synth_df[cols]], ignore_index=True)
    else:
        combined = synth_df[cols]

    # Feature engineering
    combined["moneyness"]     = combined["S"] / combined["K"]
    combined["log_moneyness"] = np.log(combined["moneyness"])
    combined["sqrt_T"]        = np.sqrt(combined["T"])

    # Final quality filter
    combined = combined.dropna()
    combined = combined[combined["mid_price"] > 0]
    combined = combined[np.isfinite(combined["log_moneyness"])]

    combined.to_parquet(output_path, index=False)
    print(f"\nDataset saved: {output_path}")
    print(f"Total rows: {len(combined):,}")
    print(combined[["S","K","T","sigma","is_call","mid_price"]].describe())
    return combined

if __name__ == "__main__":
    df = build_dataset(
        snapshot_dir="data/snapshots",
        n_synthetic=400_000,
        output_path="data/processed/dataset.parquet"
    )
```

Run it:
```bash
python training/generate_dataset.py
```

---

## PART 4 — MODEL TRAINING (Google Colab T4 Step by Step)

### Step 4.1 — Upload Data to Google Drive

```bash
# On your local machine, zip and upload the processed data
zip -r dataset.zip data/processed/
# Then drag dataset.zip into your Google Drive folder: MyDrive/neuralpricer/
```

### Step 4.2 — Full Colab Training Notebook

Create a new notebook on Colab. Set runtime to GPU → T4. Run these cells in order:

```python
# ── CELL 1: Mount Drive ──────────────────────────────────────────────────────
from google.colab import drive
drive.mount('/content/drive')

BASE = "/content/drive/MyDrive/neuralpricer"
import os
os.makedirs(f"{BASE}/models", exist_ok=True)
```

```python
# ── CELL 2: Install packages ─────────────────────────────────────────────────
!pip install pyarrow scikit-learn -q
import torch
print(f"PyTorch: {torch.__version__}")
print(f"CUDA:    {torch.cuda.is_available()}")
print(f"GPU:     {torch.cuda.get_device_name(0)}")
```

```python
# ── CELL 3: Copy data from Drive to fast local SSD ───────────────────────────
# Colab's /content/ SSD is much faster than Drive for I/O during training
import shutil
shutil.copy(f"{BASE}/dataset.zip", "/content/dataset.zip")
!unzip -q /content/dataset.zip -d /content/
print("Data ready at /content/data/processed/")
```

```python
# ── CELL 4: Model definition ─────────────────────────────────────────────────
import torch
import torch.nn as nn

class OptionPricingNet(nn.Module):
    """
    Feedforward MLP for option pricing.
    Input: 8 features [S, K, T, r, sigma, is_call, moneyness, log_moneyness, sqrt_T]
    Output: 1 (option price, non-negative via Softplus)
    """
    def __init__(self, input_dim=9, hidden_dims=(256, 256, 128, 64), dropout=0.1):
        super().__init__()
        layers = []
        prev = input_dim
        for h in hidden_dims:
            layers += [
                nn.Linear(prev, h),
                nn.BatchNorm1d(h),
                nn.ELU(),
                nn.Dropout(dropout)
            ]
            prev = h
        layers.append(nn.Linear(prev, 1))
        self.net = nn.Sequential(*layers)

    def forward(self, x):
        return torch.nn.functional.softplus(self.net(x))
```

```python
# ── CELL 5: Dataset + DataLoaders ────────────────────────────────────────────
import pandas as pd
import numpy as np
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import train_test_split
from torch.utils.data import Dataset, DataLoader
import joblib

FEATURE_COLS = ["S","K","T","r","sigma","is_call","moneyness","log_moneyness","sqrt_T"]
TARGET_COL   = "mid_price"

class OptionDataset(Dataset):
    def __init__(self, X, y):
        self.X = torch.tensor(X, dtype=torch.float32)
        self.y = torch.tensor(y, dtype=torch.float32).unsqueeze(1)
    def __len__(self):
        return len(self.X)
    def __getitem__(self, idx):
        return self.X[idx], self.y[idx]

# Load data
df = pd.read_parquet("/content/data/processed/dataset.parquet")
print(f"Total rows: {len(df):,}")

X = df[FEATURE_COLS].values
y = df[TARGET_COL].values

# Train / val / test split (70 / 15 / 15)
X_train, X_temp, y_train, y_temp = train_test_split(X, y, test_size=0.30, random_state=42)
X_val, X_test, y_val, y_test     = train_test_split(X_temp, y_temp, test_size=0.50, random_state=42)

print(f"Train: {len(X_train):,}  Val: {len(X_val):,}  Test: {len(X_test):,}")

# Scale features
scaler_X = StandardScaler()
X_train_s = scaler_X.fit_transform(X_train)
X_val_s   = scaler_X.transform(X_val)
X_test_s  = scaler_X.transform(X_test)

# Scale target (important: prices can range from $0.01 to $10,000+)
scaler_y = StandardScaler()
y_train_s = scaler_y.fit_transform(y_train.reshape(-1,1)).flatten()
y_val_s   = scaler_y.transform(y_val.reshape(-1,1)).flatten()
y_test_s  = scaler_y.transform(y_test.reshape(-1,1)).flatten()

# Save scalers immediately
joblib.dump(scaler_X, f"{BASE}/models/scaler_X.pkl")
joblib.dump(scaler_y, f"{BASE}/models/scaler_y.pkl")
print("Scalers saved to Drive.")

BATCH = 4096
train_loader = DataLoader(OptionDataset(X_train_s, y_train_s), batch_size=BATCH, shuffle=True,  num_workers=2, pin_memory=True)
val_loader   = DataLoader(OptionDataset(X_val_s,   y_val_s),   batch_size=BATCH, shuffle=False, num_workers=2, pin_memory=True)
test_loader  = DataLoader(OptionDataset(X_test_s,  y_test_s),  batch_size=BATCH, shuffle=False, num_workers=2, pin_memory=True)
```

```python
# ── CELL 6: Training loop ────────────────────────────────────────────────────
from torch.cuda.amp import GradScaler, autocast   # mixed precision (faster on T4)

device = torch.device("cuda")
model  = OptionPricingNet(input_dim=9).to(device)

optimizer  = torch.optim.AdamW(model.parameters(), lr=1e-3, weight_decay=1e-5)
scheduler  = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=100, eta_min=1e-5)
criterion  = nn.HuberLoss(delta=1.0)   # more robust than MSE to outlier prices
amp_scaler = GradScaler()              # mixed precision gradient scaler

EPOCHS       = 100
best_val     = float("inf")
patience     = 15
no_improve   = 0
history      = {"train": [], "val": []}

for epoch in range(1, EPOCHS + 1):
    # ── Train ─────────────────────────────────────────────
    model.train()
    train_loss = 0.0
    for X_b, y_b in train_loader:
        X_b, y_b = X_b.to(device), y_b.to(device)
        optimizer.zero_grad()
        with autocast():
            pred = model(X_b)
            loss = criterion(pred, y_b)
        amp_scaler.scale(loss).backward()
        amp_scaler.step(optimizer)
        amp_scaler.update()
        train_loss += loss.item() * X_b.size(0)
    train_loss /= len(train_loader.dataset)

    # ── Validate ──────────────────────────────────────────
    model.eval()
    val_loss = 0.0
    with torch.no_grad():
        for X_b, y_b in val_loader:
            X_b, y_b = X_b.to(device), y_b.to(device)
            pred = model(X_b)
            val_loss += criterion(pred, y_b).item() * X_b.size(0)
    val_loss /= len(val_loader.dataset)

    scheduler.step()
    history["train"].append(train_loss)
    history["val"].append(val_loss)

    # ── Checkpoint ────────────────────────────────────────
    if val_loss < best_val:
        best_val = val_loss
        torch.save(model.state_dict(), f"{BASE}/models/best_model.pt")
        no_improve = 0
        flag = " ← best"
    else:
        no_improve += 1
        flag = ""

    if epoch % 5 == 0 or epoch == 1:
        print(f"Epoch {epoch:03d} | Train: {train_loss:.6f} | Val: {val_loss:.6f}{flag}")

    # ── Early stopping ─────────────────────────────────────
    if no_improve >= patience:
        print(f"Early stopping at epoch {epoch}")
        break

print(f"\nBest validation loss: {best_val:.6f}")
print(f"Model saved to {BASE}/models/best_model.pt")
```

```python
# ── CELL 7: Evaluation on test set ──────────────────────────────────────────
from sklearn.metrics import mean_squared_error, mean_absolute_error, r2_score
import matplotlib.pyplot as plt

model.load_state_dict(torch.load(f"{BASE}/models/best_model.pt"))
model.eval()

preds, actuals = [], []
with torch.no_grad():
    for X_b, y_b in test_loader:
        p = model(X_b.to(device)).cpu().numpy()
        preds.append(p)
        actuals.append(y_b.numpy())

preds   = scaler_y.inverse_transform(np.vstack(preds))
actuals = scaler_y.inverse_transform(np.vstack(actuals))

rmse = np.sqrt(mean_squared_error(actuals, preds))
mae  = mean_absolute_error(actuals, preds)
r2   = r2_score(actuals, preds)

print(f"Test RMSE : {rmse:.4f}")
print(f"Test MAE  : {mae:.4f}")
print(f"Test R²   : {r2:.6f}")

# Plot training curves
fig, axes = plt.subplots(1, 2, figsize=(14, 5))
axes[0].plot(history["train"], label="Train Loss")
axes[0].plot(history["val"],   label="Val Loss")
axes[0].set_title("Loss Curves")
axes[0].set_xlabel("Epoch")
axes[0].legend()

axes[1].scatter(actuals[:5000], preds[:5000], alpha=0.2, s=4)
mn, mx = actuals[:5000].min(), actuals[:5000].max()
axes[1].plot([mn,mx],[mn,mx],"r--")
axes[1].set_title("Predicted vs Actual")
axes[1].set_xlabel("Actual Price")
axes[1].set_ylabel("Predicted Price")

plt.tight_layout()
plt.savefig(f"{BASE}/models/eval_plot.png", dpi=150)
plt.show()
```

```python
# ── CELL 8: Export model for backend (TorchScript for production) ─────────────
model.eval()
# TorchScript makes the model loadable without the class definition in the backend
example_input = torch.randn(1, 9).to(device)
traced = torch.jit.trace(model, example_input)
traced.save(f"{BASE}/models/best_model_scripted.pt")
print("TorchScript model saved.")
```

---

## PART 5 — BACKEND (FastAPI)

Save as `backend/main.py`:

```python
# backend/main.py
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import numpy as np
import torch
import joblib
import os

from black_scholes import bs_price_and_greeks
from data_collector import fetch_full_snapshot, fetch_yfinance_snapshot

# ─── App setup ────────────────────────────────────────────────────────────────
app = FastAPI(title="NeuralPricer API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],   # your React dev server
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Load model + scalers once at startup ────────────────────────────────────
MODEL_DIR = os.getenv("MODEL_DIR", "../models")

model     = torch.jit.load(f"{MODEL_DIR}/best_model_scripted.pt", map_location="cpu")
model.eval()
scaler_X  = joblib.load(f"{MODEL_DIR}/scaler_X.pkl")
scaler_y  = joblib.load(f"{MODEL_DIR}/scaler_y.pkl")

FEATURE_COLS = ["S","K","T","r","sigma","is_call","moneyness","log_moneyness","sqrt_T"]

# ─── Request / response models ────────────────────────────────────────────────
class PriceRequest(BaseModel):
    S:       float = Field(..., description="Spot price",          example=42000)
    K:       float = Field(..., description="Strike price",         example=43000)
    T:       float = Field(..., description="Time to maturity (years)", example=0.25)
    r:       float = Field(..., description="Risk-free rate",       example=0.045)
    sigma:   float = Field(..., description="Implied volatility",   example=0.72)
    is_call: int   = Field(..., description="1=call, 0=put",        example=1)

class PriceResponse(BaseModel):
    nn_price:    float
    bs_price:    float
    abs_error:   float
    pct_error:   float
    greeks:      dict
    inputs_used: dict

# ─── Helper: build feature vector ─────────────────────────────────────────────
def build_features(req: PriceRequest) -> np.ndarray:
    moneyness     = req.S / req.K
    log_moneyness = float(np.log(moneyness))
    sqrt_T        = float(np.sqrt(req.T))
    return np.array([[
        req.S, req.K, req.T, req.r, req.sigma,
        req.is_call, moneyness, log_moneyness, sqrt_T
    ]])

# ─── Helper: run NN inference ─────────────────────────────────────────────────
def nn_infer(features: np.ndarray) -> float:
    X_s   = scaler_X.transform(features)
    t     = torch.tensor(X_s, dtype=torch.float32)
    with torch.no_grad():
        out = model(t)
    return float(scaler_y.inverse_transform(out.numpy())[0, 0])

# ─── Endpoints ────────────────────────────────────────────────────────────────

@app.get("/")
def root():
    return {"status": "NeuralPricer API running", "version": "1.0.0"}

@app.post("/api/price", response_model=PriceResponse)
def price_option(req: PriceRequest):
    """Price a single option using both NN and Black-Scholes."""
    try:
        features = build_features(req)
        nn_p     = nn_infer(features)
        bs_out   = bs_price_and_greeks(req.S, req.K, req.T, req.r, req.sigma, req.is_call)
        bs_p     = bs_out["price"]
        abs_err  = abs(nn_p - bs_p)
        pct_err  = (abs_err / bs_p * 100) if bs_p > 0 else 0

        return PriceResponse(
            nn_price=round(nn_p, 4),
            bs_price=round(bs_p, 4),
            abs_error=round(abs_err, 6),
            pct_error=round(pct_err, 4),
            greeks={k: round(v, 6) for k, v in bs_out["greeks"].items()},
            inputs_used=req.dict()
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/price/batch")
def price_batch(requests: list[PriceRequest]):
    """Price multiple options in one call (vectorized)."""
    results = []
    for req in requests:
        try:
            f    = build_features(req)
            nn_p = nn_infer(f)
            bs   = bs_price_and_greeks(req.S, req.K, req.T, req.r, req.sigma, req.is_call)
            results.append({"nn_price": nn_p, "bs_price": bs["price"], "greeks": bs["greeks"]})
        except Exception as e:
            results.append({"error": str(e)})
    return results

@app.get("/api/live-chain/{currency}")
def live_chain(currency: str = "BTC"):
    """Fetch a fresh live option chain snapshot."""
    try:
        df = fetch_full_snapshot(currency.upper())
        if df.empty:
            raise HTTPException(status_code=404, detail="No data returned")
        # Add NN prices for first 50 rows (keep API response fast)
        top = df.head(50).copy()
        nn_prices = []
        for _, row in top.iterrows():
            try:
                f    = np.array([[row.S, row.K, row.T, row.r, row.sigma,
                                   row.is_call, row.moneyness, row.log_moneyness, row.sqrt_T]])
                nn_prices.append(round(nn_infer(f), 2))
            except:
                nn_prices.append(None)
        top["nn_price"] = nn_prices
        return top.to_dict(orient="records")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/health")
def health():
    return {"status": "ok", "model_loaded": model is not None}
```

Save as `backend/black_scholes.py`:

```python
# backend/black_scholes.py
import numpy as np
from scipy.stats import norm

def bs_price_and_greeks(S, K, T, r, sigma, is_call):
    """Returns dict with price and all Greeks."""
    T     = max(T, 1e-8)
    sigma = max(sigma, 1e-8)

    d1 = (np.log(S / K) + (r + 0.5 * sigma**2) * T) / (sigma * np.sqrt(T))
    d2 = d1 - sigma * np.sqrt(T)

    if is_call == 1:
        price = S * norm.cdf(d1) - K * np.exp(-r * T) * norm.cdf(d2)
        delta = norm.cdf(d1)
        rho   = K * T * np.exp(-r * T) * norm.cdf(d2) / 100
        theta = (-S * norm.pdf(d1) * sigma / (2 * np.sqrt(T))
                 - r * K * np.exp(-r * T) * norm.cdf(d2)) / 365
    else:
        price = K * np.exp(-r * T) * norm.cdf(-d2) - S * norm.cdf(-d1)
        delta = norm.cdf(d1) - 1
        rho   = -K * T * np.exp(-r * T) * norm.cdf(-d2) / 100
        theta = (-S * norm.pdf(d1) * sigma / (2 * np.sqrt(T))
                 + r * K * np.exp(-r * T) * norm.cdf(-d2)) / 365

    gamma = norm.pdf(d1) / (S * sigma * np.sqrt(T))
    vega  = S * norm.pdf(d1) * np.sqrt(T) / 100

    return {
        "price": float(price),
        "greeks": {
            "delta": float(delta),
            "gamma": float(gamma),
            "vega":  float(vega),
            "theta": float(theta),
            "rho":   float(rho),
        }
    }
```

Start the backend:
```bash
cd backend
uvicorn main:app --reload --port 8000
# API now live at http://localhost:8000
# Docs UI at   http://localhost:8000/docs
```

---

## PART 6 — FRONTEND (React Dashboard)

### Step 6.1 — TailwindCSS Config

```javascript
// frontend/tailwind.config.js
module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          dark:    "#0D1117",
          panel:   "#161B22",
          border:  "#30363D",
          accent:  "#58A6FF",
          green:   "#3FB950",
          red:     "#F85149",
          muted:   "#8B949E",
        }
      },
      fontFamily: {
        mono: ["'JetBrains Mono'", "monospace"],
        sans: ["'Inter'", "sans-serif"],
      }
    }
  },
  plugins: []
}
```

### Step 6.2 — API Layer

```javascript
// frontend/src/api/neuralpricer.js
const BASE = "http://localhost:8000";

export async function priceOption(params) {
  const res = await fetch(`${BASE}/api/price`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function fetchLiveChain(currency = "BTC") {
  const res = await fetch(`${BASE}/api/live-chain/${currency}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function priceBatch(requests) {
  const res = await fetch(`${BASE}/api/price/batch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requests),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
```

### Step 6.3 — App Router

```jsx
// frontend/src/App.jsx
import { useState } from "react";
import Navbar   from "./components/Navbar";
import Pricer   from "./pages/Pricer";
import Greeks   from "./pages/Greeks";
import LiveChain from "./pages/LiveChain";
import Benchmark from "./pages/Benchmark";

export default function App() {
  const [page, setPage] = useState("pricer");

  const pages = {
    pricer:    <Pricer />,
    greeks:    <Greeks />,
    livechain: <LiveChain />,
    benchmark: <Benchmark />,
  };

  return (
    <div className="min-h-screen bg-brand-dark text-white font-sans">
      <Navbar active={page} setPage={setPage} />
      <main className="max-w-7xl mx-auto px-6 py-8">
        {pages[page]}
      </main>
    </div>
  );
}
```

```jsx
// frontend/src/components/Navbar.jsx
const tabs = [
  { id: "pricer",    label: "Option Pricer" },
  { id: "greeks",    label: "Greeks" },
  { id: "livechain", label: "Live Chain" },
  { id: "benchmark", label: "Benchmark" },
];

export default function Navbar({ active, setPage }) {
  return (
    <nav className="border-b border-brand-border bg-brand-panel px-6 py-4 flex items-center gap-8">
      <span className="font-mono font-bold text-brand-accent text-lg tracking-tight">
        ⚡ NeuralPricer
      </span>
      <div className="flex gap-1">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setPage(t.id)}
            className={`px-4 py-2 rounded text-sm font-medium transition-colors
              ${active === t.id
                ? "bg-brand-accent text-brand-dark"
                : "text-brand-muted hover:text-white hover:bg-brand-border"}`}
          >
            {t.label}
          </button>
        ))}
      </div>
    </nav>
  );
}
```

```jsx
// frontend/src/pages/Pricer.jsx
import { useState } from "react";
import { priceOption } from "../api/neuralpricer";

const DEFAULT = { S: 42000, K: 43000, T: 0.25, r: 0.045, sigma: 0.72, is_call: 1 };

function InputRow({ label, name, value, onChange, step=0.01, min=0 }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-brand-muted font-mono uppercase tracking-wider">
        {label}
      </label>
      <input
        type="number" name={name} value={value} step={step} min={min}
        onChange={e => onChange(name, parseFloat(e.target.value))}
        className="bg-brand-dark border border-brand-border rounded px-3 py-2
                   text-white font-mono text-sm focus:outline-none focus:border-brand-accent"
      />
    </div>
  );
}

function MetricCard({ label, value, sub, color="text-white" }) {
  return (
    <div className="bg-brand-panel border border-brand-border rounded-xl p-5">
      <p className="text-xs text-brand-muted font-mono uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-2xl font-mono font-bold ${color}`}>{value}</p>
      {sub && <p className="text-xs text-brand-muted mt-1">{sub}</p>}
    </div>
  );
}

export default function Pricer() {
  const [params, setParams] = useState(DEFAULT);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState(null);

  const handleChange = (name, val) => setParams(p => ({ ...p, [name]: val }));

  const handleSubmit = async () => {
    setLoading(true); setError(null);
    try {
      const res = await priceOption(params);
      setResult(res);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Option Pricer</h1>
        <p className="text-brand-muted text-sm mt-1">
          Enter option parameters — NeuralPricer runs both NN and Black-Scholes in parallel.
        </p>
      </div>

      {/* Input panel */}
      <div className="bg-brand-panel border border-brand-border rounded-xl p-6">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
          <InputRow label="Spot (S)"   name="S"     value={params.S}     onChange={handleChange} step={100} min={1} />
          <InputRow label="Strike (K)" name="K"     value={params.K}     onChange={handleChange} step={100} min={1} />
          <InputRow label="Time (T)"   name="T"     value={params.T}     onChange={handleChange} step={0.01} min={0.001} />
          <InputRow label="Rate (r)"   name="r"     value={params.r}     onChange={handleChange} step={0.001} min={0} />
          <InputRow label="Vol (σ)"    name="sigma" value={params.sigma} onChange={handleChange} step={0.01} min={0.01} />
          <div className="flex flex-col gap-1">
            <label className="text-xs text-brand-muted font-mono uppercase tracking-wider">Type</label>
            <select
              value={params.is_call}
              onChange={e => handleChange("is_call", parseInt(e.target.value))}
              className="bg-brand-dark border border-brand-border rounded px-3 py-2
                         text-white font-mono text-sm focus:outline-none focus:border-brand-accent"
            >
              <option value={1}>Call</option>
              <option value={0}>Put</option>
            </select>
          </div>
        </div>

        <button
          onClick={handleSubmit} disabled={loading}
          className="px-6 py-2.5 bg-brand-accent text-brand-dark rounded font-mono
                     font-semibold text-sm hover:opacity-90 disabled:opacity-50 transition"
        >
          {loading ? "Pricing..." : "Price Option →"}
        </button>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-brand-red rounded-xl p-4 text-brand-red text-sm font-mono">
          {error}
        </div>
      )}

      {/* Results */}
      {result && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <MetricCard label="NN Price"    value={`$${result.nn_price.toFixed(2)}`}  color="text-brand-accent" />
            <MetricCard label="BS Price"    value={`$${result.bs_price.toFixed(2)}`} />
            <MetricCard label="Abs Error"   value={`$${result.abs_error.toFixed(4)}`} color="text-brand-green" />
            <MetricCard label="Error %"     value={`${result.pct_error.toFixed(3)}%`} color="text-brand-green" />
          </div>

          {/* Greeks panel */}
          <div className="bg-brand-panel border border-brand-border rounded-xl p-6">
            <h2 className="text-base font-semibold mb-4">Greeks (Black-Scholes analytical)</h2>
            <div className="grid grid-cols-5 gap-4">
              {Object.entries(result.greeks).map(([key, val]) => (
                <div key={key} className="text-center">
                  <p className="text-xs text-brand-muted font-mono uppercase tracking-wider mb-1">
                    {key}
                  </p>
                  <p className="text-lg font-mono font-bold text-brand-accent">
                    {val.toFixed(4)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
```

```jsx
// frontend/src/pages/LiveChain.jsx
import { useState, useEffect } from "react";
import { fetchLiveChain } from "../api/neuralpricer";

export default function LiveChain() {
  const [currency, setCurrency] = useState("BTC");
  const [data, setData]         = useState([]);
  const [loading, setLoading]   = useState(false);
  const [lastFetch, setLastFetch] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const rows = await fetchLiveChain(currency);
      setData(rows);
      setLastFetch(new Date().toLocaleTimeString());
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [currency]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Live Option Chain</h1>
          <p className="text-brand-muted text-sm mt-1">
            Real-time data from Deribit · {lastFetch && `Last updated: ${lastFetch}`}
          </p>
        </div>
        <div className="flex gap-3">
          {["BTC","ETH"].map(c => (
            <button key={c}
              onClick={() => setCurrency(c)}
              className={`px-4 py-2 rounded font-mono text-sm font-semibold transition
                ${currency === c
                  ? "bg-brand-accent text-brand-dark"
                  : "border border-brand-border text-brand-muted hover:text-white"}`}
            >
              {c}
            </button>
          ))}
          <button onClick={load} disabled={loading}
            className="px-4 py-2 rounded border border-brand-border text-sm
                       text-brand-muted hover:text-white transition disabled:opacity-50">
            {loading ? "Loading..." : "↻ Refresh"}
          </button>
        </div>
      </div>

      <div className="bg-brand-panel border border-brand-border rounded-xl overflow-hidden">
        <table className="w-full text-sm font-mono">
          <thead>
            <tr className="border-b border-brand-border text-brand-muted text-xs uppercase">
              {["Instrument","Spot","Strike","Expiry (T)","IV","Type","Mid Price","NN Price"].map(h => (
                <th key={h} className="text-left px-4 py-3">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row, i) => (
              <tr key={i} className="border-b border-brand-border/50 hover:bg-brand-border/20">
                <td className="px-4 py-2.5 text-brand-accent">{row.instrument}</td>
                <td className="px-4 py-2.5">{row.S?.toLocaleString()}</td>
                <td className="px-4 py-2.5">{row.K?.toLocaleString()}</td>
                <td className="px-4 py-2.5">{(row.T * 365).toFixed(0)}d</td>
                <td className="px-4 py-2.5">{(row.sigma * 100).toFixed(1)}%</td>
                <td className={`px-4 py-2.5 font-semibold
                  ${row.is_call ? "text-brand-green" : "text-brand-red"}`}>
                  {row.is_call ? "CALL" : "PUT"}
                </td>
                <td className="px-4 py-2.5">${row.mid_price?.toFixed(2)}</td>
                <td className="px-4 py-2.5 text-brand-accent font-bold">
                  {row.nn_price ? `$${row.nn_price?.toFixed(2)}` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

### Step 6.4 — Start the Frontend

```bash
cd frontend
npm start
# Dashboard live at http://localhost:3000
```

---

## PART 7 — FULL WORKFLOW CHECKLIST

```
Phase 1: Data Collection (Local Machine, ~1-7 days running)
  □ Clone repo, set up Python venv
  □ Run data_collector.py test snapshot
  □ Start snapshot loop (288 per day, 5-min intervals)
  □ Upload parquet files to Google Drive

Phase 2: Training (Google Colab T4, ~30-90 minutes)
  □ Mount Drive, check GPU (Tesla T4)
  □ Run generate_dataset.py (500k+ rows)
  □ Run all 8 Colab cells in order
  □ Download best_model_scripted.pt + scalers to local models/

Phase 3: Backend (Local, ~30 minutes)
  □ Place model files in neuralpricer/models/
  □ Install FastAPI dependencies
  □ Run: uvicorn backend.main:app --reload --port 8000
  □ Test: http://localhost:8000/docs (Swagger UI)
  □ Test /api/price with sample request

Phase 4: Frontend (Local, ~1 hour)
  □ npm install in frontend/
  □ Verify Tailwind config
  □ npm start
  □ Confirm Pricer page prices an option
  □ Confirm LiveChain page loads Deribit data

Phase 5: Deployment (Optional)
  □ Backend → Railway.app or Render.com (free tiers)
  □ Frontend → Vercel or Netlify (free)
  □ Update CORS origin in main.py to your Vercel URL
  □ Set MODEL_DIR env var on the hosting platform
```

---

## PART 8 — ENVIRONMENT VARIABLES

Create `.env` in `backend/`:
```
MODEL_DIR=../models
PORT=8000
```

Create `.env` in `frontend/`:
```
REACT_APP_API_BASE=http://localhost:8000
```

Update `neuralpricer.js` to use:
```javascript
const BASE = process.env.REACT_APP_API_BASE || "http://localhost:8000";
```

---

## PART 9 — COMMON SETUP ERRORS AND FIXES

| Error | Cause | Fix |
|---|---|---|
| `CUDA not available` on Colab | Wrong runtime type | Runtime → Change runtime → GPU → T4 |
| `ModuleNotFoundError: torch` | Wrong Python env | Activate venv: `source venv/bin/activate` |
| `CORS error` in browser | Backend missing CORS header | Check `allow_origins` in `main.py` |
| `scaler not fitted` error | Loading model without scalers | Always load `scaler_X.pkl` and `scaler_y.pkl` too |
| `Empty snapshot from Deribit` | Network/rate limit | Add `time.sleep(0.5)` between requests |
| `NaN prices in dataset` | Extreme K values making log(S/K) undefined | Filter `df = df[np.isfinite(df.log_moneyness)]` |
| `React: fetch failed` | Backend not running | Start `uvicorn main:app --reload --port 8000` first |
| Colab session disconnected | >90 min idle | Save checkpoints to Drive every 10 epochs |
