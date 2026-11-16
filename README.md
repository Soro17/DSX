# DSX

A multi-asset trading platform with **live market prices** and **leveraged demo trading**. You can go long or short with up to **20x** leverage on Solana and its ecosystem tokens, plus crypto, metals, stocks, indices and forex. Every account starts with $100,000 in demo funds.

## Run it

Requires **Node.js 22.5+**.

- **Windows:** double-click **START-DSX** inside the extracted folder.
- **Any OS:**
  ```bash
  npm install
  npm start
  ```

Then open http://localhost:3000.

| Variable | Default | |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `DSX_DATA_DIR` | `./data` | Where the SQLite database lives |

```bash
npm test   # trading-engine tests (leverage cap, PnL, liquidation, SL/TP, limit orders…)
```

## Features

### Trading (isolated margin)

- **Leverage from 1x to 20x**, in whole numbers. The server enforces the cap and rejects anything above 20x.
- **Long and short** positions on every market.
- **Market and limit orders.** Limit orders reserve their margin and open automatically when the live price reaches the limit.
- **Stop loss and take profit**, set when opening a position or edited later. They trigger on live prices. Invalid levels are rejected, for example a stop loss beyond the liquidation price.
- **Liquidation price** is shown before you trade. If price reaches it, the position is liquidated and only its own margin is lost.
- **Position calculator:** margin, position size, quantity, fee, liquidation price and maximum position size. You can enter the amount as USD margin or as a quantity, and use the 10–100% quick buttons.
- **Live PnL and ROE**, open orders, position history (with the close reason: manual, TP, SL or liquidated) and order history.
- **Account summary:** equity, available balance, margin in use, funds in orders, unrealized and realized PnL, exposure and effective leverage, and win rate. You can **close all positions** or **reset** the account.
- **Fees:** 0.05% of notional on open and on close. Maintenance margin is 0.5%.

Liquidation price (isolated):

```
long  = entry × (1 − 1/leverage + 0.005)
short = entry × (1 + 1/leverage − 0.005)
```

### Markets (33)

| Group | Markets | Price source |
| --- | --- | --- |
| **Solana** | SOL, JTO, PYTH, RAY, ORCA, RENDER, HNT, WIF, BONK, POPCAT | Coinbase websocket, real-time |
| Crypto | BTC, ETH, XRP, DOGE, ADA, AVAX, LINK | Coinbase websocket, real-time |
| Metals | Gold, silver, platinum, copper (COMEX futures) | Yahoo Finance, may be delayed |
| Stocks | AAPL, NVDA, TSLA, MSFT, AMZN, GOOGL, META | Yahoo Finance |
| Indices | SPY, QQQ | Yahoo Finance |
| Forex | EUR, GBP, AUD | Yahoo Finance |

All price data is real: there are no simulated prices. When a market is closed (for example, US stocks outside trading hours), market orders are refused. Limit orders and SL/TP orders wait until trading resumes.

### Pages

- **`/` home:**
  - live SOL trading card with a chart and a leverage/liquidation preview
  - market pulse: top gainers and losers, plus key markets with 24h sparklines
  - Solana ecosystem section with a 3D scene and live token tiles
  - full markets table
- **`/trade` terminal:**
  - markets list
  - candlestick chart with volume, MA7/MA25, and lines for entry, TP, SL, liquidation and limit orders
  - order ticket
  - positions, orders and history
  - account panel

Both pages work on phones, tablets and desktops.

## Project layout

```
server/
  index.js    HTTP API + WebSocket push (/ws)
  markets.js  instrument list, MAX_LEVERAGE
  prices.js   live feeds, candles, sparklines
  engine.js   leveraged trading engine (positions, orders, SL/TP, liquidation)
  auth.js     accounts (scrypt), sessions
  db.js       SQLite schema
public/
  index.html, trade.html, img/dsx-mark.svg
  css/base.css (design system), home.css, trade.css
  js/common.js, home.js, trade.js, solana3d.js
test/engine.test.js
```

### API

| Method | Path | |
| --- | --- | --- |
| GET | `/api/markets` | Markets, quotes, trading limits |
| GET | `/api/candles/:symbol?tf=1m\|5m\|15m\|1h\|1d` | OHLCV |
| GET | `/api/sparklines` | Last 24 hourly closes per market |
| POST | `/api/auth/register` · `login` · `guest` · `logout` | Session cookie |
| GET | `/api/account` | Equity, margin, PnL, open positions |
| POST | `/api/orders` | `{symbol, side: long\|short, type: market\|limit, qty, leverage 1–20, limitPrice?, tp?, sl?}` |
| GET / DELETE | `/api/orders?status=` · `/api/orders/:id` | List and cancel |
| GET | `/api/positions?status=open\|closed` | Positions |
| PATCH | `/api/positions/:id` | `{tp, sl}` (`null` clears) |
| POST | `/api/positions/:id/close` · `/api/positions/close-all` | Market close |
| POST | `/api/account/reset` | Back to $100,000 |

The WebSocket at `/ws` pushes price batches (`quotes`) and per-user `account` events: `opened`, `filled`, `closed`, `take_profit`, `stop_loss` and `liquidation`.

## Notes

- Databases from older versions are upgraded automatically. Spot holdings become 1x long positions at their average cost.
- This is demo trading with virtual funds. Handling real money would require licensing, KYC/AML checks, custody, a payments provider and licensed market data.
