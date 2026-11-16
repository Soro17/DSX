# DSX

A multi-asset exchange: crypto, metals, stocks, indices and forex in one place, with **live market prices** and a **$100,000 demo account** for paper trading.

## Run it

Requires **Node.js 22.5+** (uses the built-in `node:sqlite`).

```bash
npm install
npm start
```

Open http://localhost:3000. Click **Start demo** to create an account, or use **Try instantly as a guest**.

Set `PORT` to change the port, and `DSX_DATA_DIR` to change where the SQLite database is stored (default `./data`).
If your network needs an HTTPS proxy, set `HTTPS_PROXY` and run Node with `NODE_USE_ENV_PROXY=1`.

## What's in it

| Page | What it does |
| --- | --- |
| `/` | Landing page: 3D coin hero (three.js), live price ticker, markets table by asset class |
| `/trade` | Trading terminal: market list, live candlestick chart (1m–1d), order entry, positions with live P&L, open orders, history |

**24 markets**:

- **Crypto:** BTC, ETH, SOL, XRP, DOGE, ADA, AVAX, LINK
- **Metals:** gold, silver, platinum, copper
- **Stocks:** AAPL, NVDA, TSLA, MSFT, AMZN, GOOGL, META
- **Indices:** SPY, QQQ
- **Forex:** EUR, GBP, AUD

Every market is priced in USD.

### Trading rules (demo)

- Market orders fill immediately at the live price. Crypto fills at the best bid/ask from the Coinbase order book.
- Limit orders reserve your funds and fill automatically when the live price reaches your limit.
- When a market is closed (for example, US stocks outside trading hours), market orders are refused. Limit orders wait and fill once trading resumes.
- Spot only: no leverage and no short selling. The fee is 0.10% of order value.
- **Reset** restores the account to $100,000.

### Market data

| Asset class | Source | Latency |
| --- | --- | --- |
| Crypto | Coinbase Exchange public websocket | Real-time, tick by tick |
| Stocks, indices, metals (futures), forex | Yahoo Finance public chart API, polled every 8s | Near real-time; futures may be delayed |

Neither source needs an API key. Yahoo's endpoint is unofficial. A production deployment should use a licensed feed such as Polygon, Finnhub or Twelve Data. The feed code is isolated in `server/prices.js`.

## Project layout

```
server/
  index.js    HTTP API, static files, WebSocket push (/ws)
  markets.js  instrument list
  prices.js   live price feeds + candle history
  engine.js   order execution, balances, portfolio
  auth.js     accounts, password hashing (scrypt), sessions
  db.js       SQLite schema
public/
  index.html, trade.html
  css/        design tokens + page styles
  js/         common.js (API, live socket, formatting, auth modal), landing.js, trade.js, coin3d.js
```

### API

| Method | Path | |
| --- | --- | --- |
| GET | `/api/markets` | Markets and latest quotes |
| GET | `/api/candles/:symbol?tf=1m\|5m\|15m\|1h\|1d` | OHLCV history |
| POST | `/api/auth/register` · `/login` · `/guest` · `/logout` | Session cookie auth |
| GET | `/api/me` | Current user |
| GET | `/api/portfolio` | Cash, holdings, P&L |
| GET | `/api/orders?status=open\|filled\|cancelled` | Orders |
| POST | `/api/orders` | `{symbol, side, type, qty, limitPrice?}` |
| DELETE | `/api/orders/:id` | Cancel an open order |
| POST | `/api/account/reset` | Reset demo account |

WebSocket `/ws` pushes `{type:"quotes"}` price batches and `{type:"order"}` fill events for the logged-in user.

## Going from demo to real money

These need to be in place before any real funds are handled:

- Licensing for your jurisdiction (crypto/broker/exchange), plus KYC and AML checks.
- A custody or brokerage partner, or exchange connectivity, so that orders route to a real venue.
- A payments provider for fiat deposits and withdrawals.
- Licensed market data.
- Security hardening: rate limiting, 2FA, audit logs, and decimal or integer money math instead of floats.
