# training/train.py
# Local training script — same pipeline as the Colab cells in the guides
# (PART 4 of NEURALPRICER_COMPLETE_GUIDE.md / PHASE 7 of SETUP_GUIDE.md),
# runnable on CPU or CUDA.
#
#   python training/train.py --data data/processed/dataset.parquet --epochs 100 --batch 4096
#
# Outputs to models/:
#   best_model.pt            state dict (best validation loss)
#   best_model_scripted.pt   TorchScript export (loaded by backend/main.py)
#   scaler_X.pkl, scaler_y.pkl
#   history.json, metrics.json
import argparse
import json
import os
import sys

import numpy as np
import pandas as pd
import joblib
import sklearn
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_squared_error, mean_absolute_error, r2_score

import torch
import torch.nn as nn
from torch.utils.data import Dataset, DataLoader

FEATURE_COLS = ["S", "K", "T", "r", "sigma", "is_call",
                "moneyness", "log_moneyness", "sqrt_T"]
TARGET_COL = "mid_price"


class OptionPricingNet(nn.Module):
    """Feedforward MLP for option pricing.
    Input: 9 features, Output: 1 (option price, non-negative via Softplus)."""
    def __init__(self, input_dim=9, hidden_dims=(256, 256, 128, 64), dropout=0.1):
        super().__init__()
        layers = []
        prev = input_dim
        for h in hidden_dims:
            layers += [nn.Linear(prev, h), nn.BatchNorm1d(h), nn.ELU(), nn.Dropout(dropout)]
            prev = h
        layers.append(nn.Linear(prev, 1))
        self.net = nn.Sequential(*layers)

    def forward(self, x):
        return torch.nn.functional.softplus(self.net(x))


class OptionDataset(Dataset):
    def __init__(self, X, y):
        self.X = torch.tensor(X, dtype=torch.float32)
        self.y = torch.tensor(y, dtype=torch.float32).unsqueeze(1)

    def __len__(self):
        return len(self.X)

    def __getitem__(self, i):
        return self.X[i], self.y[i]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="data/processed/dataset.parquet")
    ap.add_argument("--save_dir", default="models")
    ap.add_argument("--epochs", type=int, default=100)
    ap.add_argument("--batch", type=int, default=4096)
    ap.add_argument("--lr", type=float, default=1e-3)
    ap.add_argument("--patience", type=int, default=15)
    ap.add_argument("--dropout", type=float, default=0.1)
    ap.add_argument("--max_rows", type=int, default=0,
                    help="0 = use all rows; otherwise subsample for quick runs")
    args = ap.parse_args()

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Device: {device}")
    os.makedirs(args.save_dir, exist_ok=True)

    df = pd.read_parquet(args.data)
    if args.max_rows and len(df) > args.max_rows:
        df = df.sample(n=args.max_rows, random_state=42)
    print(f"Total rows: {len(df):,}")

    X = df[FEATURE_COLS].values
    y = df[TARGET_COL].values

    # Train / val / test split (70 / 15 / 15)
    X_train, X_temp, y_train, y_temp = train_test_split(X, y, test_size=0.30, random_state=42)
    X_val, X_test, y_val, y_test = train_test_split(X_temp, y_temp, test_size=0.50, random_state=42)
    print(f"Train: {len(X_train):,}  |  Val: {len(X_val):,}  |  Test: {len(X_test):,}")

    scaler_X = StandardScaler()
    X_train_s = scaler_X.fit_transform(X_train)
    X_val_s = scaler_X.transform(X_val)
    X_test_s = scaler_X.transform(X_test)

    scaler_y = StandardScaler()
    y_train_s = scaler_y.fit_transform(y_train.reshape(-1, 1)).flatten()
    y_val_s = scaler_y.transform(y_val.reshape(-1, 1)).flatten()
    y_test_s = scaler_y.transform(y_test.reshape(-1, 1)).flatten()

    joblib.dump(scaler_X, os.path.join(args.save_dir, "scaler_X.pkl"))
    joblib.dump(scaler_y, os.path.join(args.save_dir, "scaler_y.pkl"))
    print("Scalers saved.")

    kw = dict(num_workers=0, pin_memory=(device.type == "cuda"))
    train_loader = DataLoader(OptionDataset(X_train_s, y_train_s), batch_size=args.batch, shuffle=True, **kw)
    val_loader = DataLoader(OptionDataset(X_val_s, y_val_s), batch_size=args.batch, shuffle=False, **kw)
    test_loader = DataLoader(OptionDataset(X_test_s, y_test_s), batch_size=args.batch, shuffle=False, **kw)

    model = OptionPricingNet(input_dim=9).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-5)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=args.epochs, eta_min=1e-5)
    criterion = nn.HuberLoss(delta=1.0)

    # Mixed precision only on CUDA
    use_amp = device.type == "cuda"
    amp_scaler = torch.amp.GradScaler("cuda", enabled=use_amp)

    best_val = float("inf")
    no_improve = 0
    history = {"train": [], "val": []}

    for epoch in range(1, args.epochs + 1):
        model.train()
        tr_loss = 0.0
        for Xb, yb in train_loader:
            Xb, yb = Xb.to(device), yb.to(device)
            optimizer.zero_grad()
            with torch.amp.autocast("cuda", enabled=use_amp):
                loss = criterion(model(Xb), yb)
            amp_scaler.scale(loss).backward()
            amp_scaler.step(optimizer)
            amp_scaler.update()
            tr_loss += loss.item() * Xb.size(0)
        tr_loss /= len(train_loader.dataset)

        model.eval()
        vl_loss = 0.0
        with torch.no_grad():
            for Xb, yb in val_loader:
                vl_loss += criterion(model(Xb.to(device)), yb.to(device)).item() * Xb.size(0)
        vl_loss /= len(val_loader.dataset)

        scheduler.step()
        history["train"].append(tr_loss)
        history["val"].append(vl_loss)

        if vl_loss < best_val:
            best_val, no_improve = vl_loss, 0
            torch.save(model.state_dict(), os.path.join(args.save_dir, "best_model.pt"))
            tag = " <- best"
        else:
            no_improve += 1
            tag = ""

        if epoch % 10 == 0 or epoch == 1:
            print(f"Epoch {epoch:03d} | Train {tr_loss:.6f} | Val {vl_loss:.6f}{tag}", flush=True)

        if no_improve >= args.patience:
            print(f"Early stopping at epoch {epoch}.")
            break

    print(f"\nBest val loss: {best_val:.6f}")

    # ── Evaluation on test set ────────────────────────────────────────────────
    model.load_state_dict(torch.load(os.path.join(args.save_dir, "best_model.pt")))
    model.eval()
    preds, actuals = [], []
    with torch.no_grad():
        for Xb, yb in test_loader:
            preds.append(model(Xb.to(device)).cpu().numpy())
            actuals.append(yb.numpy())
    preds = scaler_y.inverse_transform(np.vstack(preds))
    actuals = scaler_y.inverse_transform(np.vstack(actuals))

    metrics = {
        "rmse": float(np.sqrt(mean_squared_error(actuals, preds))),
        "mae": float(mean_absolute_error(actuals, preds)),
        "r2": float(r2_score(actuals, preds)),
        "best_val_loss": float(best_val),
        "rows": int(len(df)),
        "device": str(device),
        "training_environment": {
            "torch": torch.__version__,
            "scikit_learn": sklearn.__version__,
        },
    }
    print(f"Test RMSE : {metrics['rmse']:.4f}")
    print(f"Test MAE  : {metrics['mae']:.4f}")
    print(f"Test R2   : {metrics['r2']:.6f}")

    # ── Export TorchScript for the backend ────────────────────────────────────
    traced = torch.jit.trace(model.eval(), torch.randn(1, 9).to(device))
    traced.save(os.path.join(args.save_dir, "best_model_scripted.pt"))
    print("TorchScript model saved.")

    with open(os.path.join(args.save_dir, "history.json"), "w") as f:
        json.dump(history, f)
    with open(os.path.join(args.save_dir, "metrics.json"), "w") as f:
        json.dump(metrics, f, indent=2)
    print(f"Artifacts written to {args.save_dir}/")


if __name__ == "__main__":
    sys.exit(main())
