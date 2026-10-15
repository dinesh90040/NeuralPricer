# ⚡ NeuralPricer Backend

> Flask + MongoDB REST API powering the NeuralPricer option pricing engine.

---

## 📌 Table of Contents

- [Overview](#overview)
- [Tech Stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Database Setup (MongoDB)](#database-setup-mongodb)
- [Backend Setup](#backend-setup)
- [Environment Variables](#environment-variables)
- [Running the Backend](#running-the-backend)
- [API Reference](#api-reference)
- [Project Structure](#project-structure)
- [Troubleshooting](#troubleshooting)

---

## Overview

The backend is a **Flask** REST API that:

- Computes **Black-Scholes** option prices and Greeks (Δ, Γ, ν, Θ, ρ) analytically.
- Optionally loads a **PyTorch neural network** model for ML-based pricing alongside Black-Scholes.
- Fetches **live option chain data** from the Deribit API (BTC / ETH crypto options).
- Provides **user authentication** (register / login / logout) backed by MongoDB.
- Logs every pricing **quote history** to MongoDB for analytics.
- Serves the React frontend running on `http://localhost:3000`.

---

## Tech Stack

| Component        | Technology                         |
| ---------------- | ---------------------------------- |
| Web Framework    | Flask 3.x + Flask-CORS             |
| Database         | MongoDB 7.x (via PyMongo)          |
| Auth             | Werkzeug password hashing + tokens |
| Math / Pricing   | NumPy, SciPy                       |
| Deep Learning    | PyTorch 2.x (optional)             |
| Data APIs        | Deribit REST API, yfinance          |
| Data Processing  | pandas, pyarrow                    |
| Environment      | python-dotenv                      |

---

## Prerequisites

Before you begin, make sure you have the following installed:

1. **Python 3.10+** — [Download](https://www.python.org/downloads/)
2. **MongoDB Community Server 7.x** — [Download](https://www.mongodb.com/try/download/community)
3. **pip** (comes with Python)
4. **Git** (optional, for cloning)

---

## Database Setup (MongoDB)

The backend uses **MongoDB** to store user accounts, sessions, and pricing history.

### Step 1 — Install MongoDB

#### Windows

1. Download the MongoDB Community Server MSI installer from  
   👉 https://www.mongodb.com/try/download/community
2. Run the installer — choose **"Complete"** setup type.
3. **Check** the option to install **MongoDB as a Windows Service** (recommended).
4. Finish the installation. MongoDB will start automatically as a background service.

#### macOS (Homebrew)

```bash
brew tap mongodb/brew
brew install mongodb-community@7.0
brew services start mongodb-community@7.0
```

#### Linux (Ubuntu / Debian)

```bash
# Import the MongoDB GPG key and add the repository
curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc | sudo gpg -o /usr/share/keyrings/mongodb-server-7.0.gpg --dearmor

echo "deb [ signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/7.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list

sudo apt update
sudo apt install -y mongodb-org

# Start MongoDB
sudo systemctl start mongod
sudo systemctl enable mongod
```

### Step 2 — Verify MongoDB is Running

```bash
# Check if MongoDB is listening on the default port (27017)
mongosh --eval "db.runCommand({ ping: 1 })"
```

You should see: `{ ok: 1 }`

> **Note:** The backend handles MongoDB being unavailable gracefully — the API will still serve Black-Scholes prices, but auth and history features will be disabled until MongoDB comes online.

### Step 3 — (Optional) Install MongoDB Compass

MongoDB Compass is a free GUI to browse your data visually:  
👉 https://www.mongodb.com/try/download/compass

Once installed, connect to `mongodb://127.0.0.1:27017/` and you'll see the `neuralpricer` database after the backend creates it.

### Database Collections

The backend automatically creates the following collections on first run:

| Collection     | Purpose                                       |
| -------------- | --------------------------------------------- |
| `users`        | Registered user accounts (name, email, hashed password) |
| `sessions`     | Active auth tokens with TTL auto-expiry (30 days)       |
| `price_logs`   | Every pricing query logged with timestamp and user      |

---

## Backend Setup

### Step 1 — Navigate to the backend directory

```bash
cd backend
```

### Step 2 — Create and activate a virtual environment

```bash
# Create virtual environment
python -m venv venv

# Activate it
# Windows (PowerShell):
venv\Scripts\Activate.ps1

# Windows (CMD):
venv\Scripts\activate.bat

# macOS / Linux:
source venv/bin/activate
```

### Step 3 — Install dependencies

```bash
pip install -r requirements.txt
```

> **Note:** PyTorch is listed in `requirements.txt` but is **optional**. If installation fails (e.g., no CUDA), the backend will still run — it just won't serve neural network prices.

---

## Environment Variables

The backend reads configuration from a `.env` file in the `backend/` directory.

### Default `.env`

```env
MODEL_DIR=../models
PORT=8000
```

### All Supported Variables

| Variable      | Default                          | Description                                      |
| ------------- | -------------------------------- | ------------------------------------------------ |
| `MODEL_DIR`   | `../models`                      | Path to the directory containing the trained model files (`best_model_scripted.pt`, `scaler_X.pkl`, `scaler_y.pkl`) |
| `PORT`        | `8000`                           | Port the Flask server listens on                 |
| `MONGO_URI`   | `mongodb://127.0.0.1:27017/`     | MongoDB connection string                        |
| `MONGO_DB`    | `neuralpricer`                   | MongoDB database name                            |

### Example `.env` with all options

```env
MODEL_DIR=../models
PORT=8000
MONGO_URI=mongodb://127.0.0.1:27017/
MONGO_DB=neuralpricer
```

---

## Running the Backend

### Quick Start (3 commands)

```bash
# 1. Make sure MongoDB is running (Windows service starts automatically)
#    On macOS/Linux: sudo systemctl start mongod

# 2. Activate virtual environment
venv\Scripts\Activate.ps1       # Windows PowerShell
# source venv/bin/activate      # macOS / Linux

# 3. Start the server
python main.py
```

You should see:

```
[NeuralPricer] MongoDB connected: mongodb://127.0.0.1:27017/ / neuralpricer
[NeuralPricer] Flask API on http://127.0.0.1:8000
```

### Verify it's running

Open your browser or use `curl`:

```bash
curl http://127.0.0.1:8000/
```

Response:

```json
{
  "status": "NeuralPricer API running (Flask)",
  "model_loaded": false,
  "mongo": "ok",
  "version": "2.0.0"
}
```

> `"model_loaded": false` is normal if you haven't trained and exported a model yet. The API still works with Black-Scholes pricing.

### Running with the Frontend

The backend is configured to accept CORS requests from `http://localhost:3000` (the React frontend). To run the full stack:

```bash
# Terminal 1 — Backend
cd backend
python main.py

# Terminal 2 — Frontend
cd frontend
npm install
npm run dev
```

---

## API Reference

### Health & Status

| Method | Endpoint        | Description                          |
| ------ | --------------- | ------------------------------------ |
| `GET`  | `/`             | API status, model & MongoDB status   |
| `GET`  | `/api/health`   | Detailed health check                |

### Pricing

| Method | Endpoint              | Description                                    |
| ------ | --------------------- | ---------------------------------------------- |
| `POST` | `/api/price`          | Price a single option (BS + NN)                |
| `POST` | `/api/price/batch`    | Price multiple options in one request           |
| `POST` | `/api/greeks`         | Compute Greeks only (Black-Scholes)            |
| `GET`  | `/api/live-chain/<currency>` | Fetch live Deribit option chain (BTC / ETH) |

#### `POST /api/price` — Example

**Request:**

```json
{
  "S": 100,
  "K": 105,
  "T": 0.5,
  "r": 0.05,
  "sigma": 0.2,
  "is_call": 1
}
```

| Field     | Type    | Description                              |
| --------- | ------- | ---------------------------------------- |
| `S`       | float   | Spot price of the underlying asset       |
| `K`       | float   | Strike price                             |
| `T`       | float   | Time to maturity (in years)              |
| `r`       | float   | Risk-free interest rate (e.g., 0.05 = 5%) |
| `sigma`   | float   | Implied volatility (e.g., 0.2 = 20%)    |
| `is_call` | int     | `1` for Call, `0` for Put                |

**Response:**

```json
{
  "bs_price": 5.5721,
  "nn_price": null,
  "abs_error": null,
  "pct_error": null,
  "greeks": {
    "delta": 0.545827,
    "gamma": 0.037524,
    "vega":  0.268492,
    "theta": -0.017233,
    "rho":   0.238691
  },
  "inputs": { "S": 100, "K": 105, "T": 0.5, "r": 0.05, "sigma": 0.2, "is_call": 1 },
  "note": "Model not loaded — showing BS price only. Train the model first."
}
```

### Authentication

| Method | Endpoint             | Description                 |
| ------ | -------------------- | --------------------------- |
| `POST` | `/api/auth/register` | Create a new user account   |
| `POST` | `/api/auth/login`    | Log in and receive a token  |
| `POST` | `/api/auth/logout`   | Invalidate the session      |
| `GET`  | `/api/auth/me`       | Get current user info       |

> Auth uses Bearer tokens. Include the header `Authorization: Bearer <token>` in subsequent requests.

#### `POST /api/auth/register` — Example

```json
{
  "name": "John",
  "email": "john@example.com",
  "password": "securepassword123"
}
```

### History

| Method | Endpoint        | Description                                    |
| ------ | --------------- | ---------------------------------------------- |
| `GET`  | `/api/history`  | Fetch recent pricing quotes (auth-scoped)      |

Query params: `?limit=20` (max 100)

---

## Project Structure

```
backend/
├── main.py              # Flask app — routes, auth, pricing endpoints
├── black_scholes.py     # Vectorized Black-Scholes pricer + Greeks
├── data_collector.py    # Live data fetching (Deribit API + yfinance)
├── requirements.txt     # Python dependencies
├── .env                 # Environment configuration
└── main_fastapi.py.bak  # Previous FastAPI version (kept as reference)
```

---

## Troubleshooting

### MongoDB won't connect

```
[NeuralPricer] MongoDB unavailable: ...
```

**Fix:** Make sure MongoDB is running:

```bash
# Windows — check the service
Get-Service MongoDB

# If stopped, start it
Start-Service MongoDB

# macOS
brew services start mongodb-community@7.0

# Linux
sudo systemctl start mongod
```

### `ModuleNotFoundError: No module named 'flask'`

**Fix:** Activate your virtual environment and install dependencies:

```bash
venv\Scripts\Activate.ps1          # Windows
pip install -r requirements.txt
```

### PyTorch import fails

```
[NeuralPricer] torch unavailable, NN disabled: ...
```

**This is OK.** The backend degrades gracefully — all endpoints work, but `nn_price` will be `null`. To fix, install PyTorch:

```bash
# CPU only
pip install torch --index-url https://download.pytorch.org/whl/cpu

# With CUDA (GPU)
pip install torch --index-url https://download.pytorch.org/whl/cu121
```

### Model not loaded

```json
{ "note": "Model not loaded — showing BS price only. Train the model first." }
```

**Fix:** Train the model and place these files in the `models/` directory:

- `best_model_scripted.pt` — TorchScript exported model
- `scaler_X.pkl` — Input feature scaler (scikit-learn)
- `scaler_y.pkl` — Output label scaler (scikit-learn)

### Port already in use

```
OSError: [Errno 48] Address already in use
```

**Fix:** Change the port in `.env`:

```env
PORT=8001
```

Or kill the process using port 8000:

```bash
# Windows
netstat -ano | findstr :8000
taskkill /PID <PID> /F

# macOS / Linux
lsof -i :8000
kill -9 <PID>
```

---

<div align="center">

**NeuralPricer Backend** · Flask + MongoDB · Built with ❤️

</div>
