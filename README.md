# NeuralPricer

A full-stack option pricing app that combines Black-Scholes analytics with a React dashboard and a Flask API. It supports option pricing, Greeks, live chain lookups, user auth, and quote history.

## Overview

This project includes:
- A Python backend in `backend/` using Flask and MongoDB
- A React + Vite frontend in `frontend/`
- Option-pricing logic based on Black-Scholes and optional PyTorch model inference
- Mongo-backed user registration/login/session handling
- API endpoints for pricing, Greeks, and live market snapshots

## Tech stack

- Backend: Python 3.10+, Flask, PyMongo, NumPy, SciPy
- Optional ML: PyTorch
- Frontend: React, Vite, Tailwind CSS
- Database: MongoDB

## Repository structure

```text
NeuralPricer/
├── backend/
│   ├── main.py
│   ├── black_scholes.py
│   ├── data_collector.py
│   ├── requirements.txt
│   ├── .env                 # create locally; ignored by Git
│   └── README.md
├── frontend/
│   ├── src/
│   ├── package.json
│   ├── vite.config.js
│   └── index.html
├── models/
├── data/
├── tests/
├── README.md
├── SETUP_GUIDE.md
└── NEURALPRICER_COMPLETE_GUIDE.md
```

## Prerequisites

- Python 3.10+
- Node.js 18+
- MongoDB running locally on `mongodb://127.0.0.1:27017/`
- Git (optional)

## Quick start

### 1) Start MongoDB

Ensure MongoDB is running locally. On Windows, if installed as a service it will usually start automatically.

You can verify it with:

```bash
mongosh --eval "db.runCommand({ ping: 1 })"
```

### 2) Start the backend

```bash
cd backend
python -m venv venv
venv\Scripts\Activate.ps1
pip install -r requirements.txt
python main.py
```

The backend runs at:
- http://127.0.0.1:8000

Health check:

```bash
curl http://127.0.0.1:8000/api/health
```

### 3) Start the frontend

Open a new terminal:

```bash
cd frontend
npm install
npm run dev -- --host 127.0.0.1
```

The frontend usually opens at:
- http://127.0.0.1:3000

If port 3000 is already in use, Vite will automatically move to another port such as 3001.

## API endpoints

Core backend routes include:

- `GET /api/health` — server status and model readiness
- `POST /api/price` — single option price request
- `POST /api/price/batch` — batch option pricing
- `POST /api/greeks` — Greeks calculation
- `GET /api/live-chain/<currency>` — live option chain snapshot
- `POST /api/auth/register` — register a user
- `POST /api/auth/login` — login
- `POST /api/auth/logout` — logout
- `GET /api/auth/me` — current user
- `GET /api/history` — quote history

## Environment notes

The backend reads settings from `backend/.env`. This file is ignored by Git, so create it locally if you need to override the defaults.

Example:

```env
MODEL_DIR=../models
PORT=8000
MONGO_URI=mongodb://127.0.0.1:27017/
MONGO_DB=neuralpricer
```

## Troubleshooting

### CORS issue while using frontend on a different port

The backend allows local development origins including 3000, 3001, and 5173. If you launch the frontend on a different port, update the CORS list in `backend/main.py` as needed.

### MongoDB unavailable

The app can still serve option pricing without MongoDB. Authentication endpoints return a 503, while the history endpoint returns an empty result and reports that MongoDB is down.

### Model not loaded

The neural-network pricing path requires PyTorch and all three files in `models/`: `best_model_scripted.pt`, `scaler_X.pkl`, and `scaler_y.pkl`. Without them, the backend still returns Black-Scholes prices and notes that the model is unavailable.

## Notes

- The backend is designed to run locally for development and demo purposes.
- The frontend dev server is intended for local preview; this is not a production deployment setup.
- The model files are excluded from Git; provide the trained artifacts locally if you want to use model-powered pricing.
