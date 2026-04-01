# Prediction Market Comp Monitor

A production-oriented local app that now includes a starting comps dashboard for Kalshi and Polymarket. The new view is designed for PM-style scanning of prediction markets: prices, liquidity, depth pockets, and short-term changes that are worth attention.

## Architecture

- `backend/`: Express API plus a prediction-market comp service that normalizes Kalshi and Polymarket markets into one dashboard payload
- `frontend/`: React app with a dedicated comp monitor view for alerts, watchlist scanning, and depth inspection

## Important constraints

- This project is designed for approved/public sportsbook access only.
- Real sportsbook integrations are stubbed behind clean adapter interfaces.
- No authentication bypass, bot evasion, or protected-endpoint circumvention is implemented.
- The recommended live path is a licensed/public odds API that returns sportsbook-specific lines.

## Run locally

1. Copy `.env.example` to `backend/.env`
2. For the new prediction-market view, set `PREDICTION_MARKETS_ENABLE_LIVE_FETCH=true` in `backend/.env` if you want the app to attempt live Kalshi and Polymarket pulls. If you leave it false, the app uses realistic sample data so the UI is still fully runnable.
3. Install dependencies:

```bash
npm install --prefix backend
npm install --prefix frontend
```

4. Start the backend:

```bash
npm run backend
```

5. Start the frontend in another terminal:

```bash
npm run frontend
```

6. Open `http://localhost:5173` for the React UI

## New prediction-market endpoint

- `GET /api/prediction-markets`
- Optional query params: `platform`, `category`, `search`

## What the comp dashboard surfaces

- Cross-venue watchlist with normalized YES price, price move, and liquidity
- Alert tape for sharp liquidity changes and sharp price moves between snapshots
- Comparable-market rows that line up likely Kalshi and Polymarket analogs
- YES-side order book depth ladder and midpoint liquidity pockets

## Data points worth storing next

- Top-of-book bid/ask by side, spread, and midpoint
- Resting depth by price band, especially within 1c, 2c, and 5c of midpoint
- Last trade price and last trade timestamp
- 1m / 5m / 15m deltas for price, spread, liquidity, and volume
- Open interest, daily volume, and large single-print or burst activity flags
- A stable market-matching table between Kalshi and Polymarket instead of title heuristics

## Setup notes

- Polymarket market discovery and CLOB reads are wired as public endpoints in the starter service.
- Kalshi is wired to public market-data style reads first. If the live environment requires signed access for some endpoints, add the auth layer in the backend service rather than exposing secrets to the frontend.
- If your corporate network intercepts TLS, Node fetches may fail until the local cert chain is trusted. The app will fall back to mock data in that case.

## Backend endpoints

- `GET /health`
- `GET /games`
- `GET /odds?game_id=<id>&sportsbook=<book>&marketType=<type>`
- `GET /markets?type=<type>&sportsbook=<book>`
- `GET /books`

## Current integration status

- `DraftKings`, `FanDuel`, `BetOnline`, `Pinnacle`, and `Bookmaker` adapters are present.
- By default they return realistic mock payloads so the app is runnable immediately.
- If `ENABLE_REAL_FETCH=true` and `ODDS_API_KEY` is set, the app will fetch live WNBA featured markets from The Odds API for supported books.
- Current supported live books through that path: `DraftKings`, `FanDuel`, `BetOnline.ag`, `Pinnacle`.
- `Bookmaker` remains mocked unless you connect another approved provider that supports it.
