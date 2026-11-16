// Leveraged demo trading engine — isolated margin, executed against live market prices.
//
//  - Long or short any market with 1x–20x leverage (hard cap, enforced here).
//  - Market orders fill immediately (crypto at best bid/ask, others at last price).
//  - Limit orders reserve margin + fee and open the position when the live price reaches the limit.
//  - Each position has its own margin, liquidation price and optional stop loss / take profit,
//    all checked on every live price tick.
//  - Fee: 0.05% of notional when opening and when closing.

const { EventEmitter } = require('node:events');
const { db, tx } = require('./db');
const { BY_SYMBOL, MAX_LEVERAGE } = require('./markets');
const prices = require('./prices');
const { STARTING_USD, httpError } = require('./auth');

const FEE_RATE = 0.0005;          // per side
const MAINT_MARGIN_RATE = 0.005;  // 0.5% of notional
const MIN_NOTIONAL = 5;           // USD
const EPS = 1e-9;

const events = new EventEmitter();

// ---------------------------------------------------------------- statements
const q = {
  usd: db.prepare("SELECT amount, locked FROM balances WHERE user_id = ? AND asset = 'USD'"),
  setUsd: db.prepare(`INSERT INTO balances (user_id, asset, amount, locked, avg_cost) VALUES (?, 'USD', ?, ?, 0)
    ON CONFLICT(user_id, asset) DO UPDATE SET amount = excluded.amount, locked = excluded.locked`),

  insertPos: db.prepare(`INSERT INTO positions (user_id, symbol, side, qty, leverage, entry_price, margin, liq_price, sl, tp, open_fee, status, opened_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`),
  pos: db.prepare('SELECT * FROM positions WHERE id = ?'),
  closePos: db.prepare(`UPDATE positions SET status = 'closed', close_price = ?, close_fee = ?, realized_pnl = ?, close_reason = ?, closed_at = ?
    WHERE id = ? AND status = 'open'`),
  setTpSl: db.prepare('UPDATE positions SET sl = ?, tp = ? WHERE id = ?'),
  openPosForSymbol: db.prepare("SELECT * FROM positions WHERE status = 'open' AND symbol = ?"),
  userPositions: db.prepare('SELECT * FROM positions WHERE user_id = ? AND status = ? ORDER BY COALESCE(closed_at, opened_at) DESC LIMIT ?'),
  realizedSum: db.prepare("SELECT COALESCE(SUM(realized_pnl), 0) AS pnl, COUNT(*) AS n, COALESCE(SUM(realized_pnl > 0), 0) AS wins FROM positions WHERE user_id = ? AND status = 'closed'"),

  insertOrder: db.prepare(`INSERT INTO trade_orders (user_id, symbol, side, type, qty, leverage, limit_price, sl, tp, reserved, status, fill_price, fee, position_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
  order: db.prepare('SELECT * FROM trade_orders WHERE id = ?'),
  fillOrder: db.prepare("UPDATE trade_orders SET status = 'filled', fill_price = ?, fee = ?, reserved = 0, position_id = ?, updated_at = ? WHERE id = ? AND status = 'open'"),
  cancelOrder: db.prepare("UPDATE trade_orders SET status = 'cancelled', reserved = 0, updated_at = ? WHERE id = ? AND status = 'open'"),
  openOrdersForSymbol: db.prepare("SELECT * FROM trade_orders WHERE status = 'open' AND symbol = ? ORDER BY created_at"),
  userOrders: db.prepare('SELECT * FROM trade_orders WHERE user_id = ? AND status = ? ORDER BY updated_at DESC LIMIT ?'),
};

// ---------------------------------------------------------------- math helpers
function liqPrice(side, entry, leverage) {
  return side === 'long'
    ? entry * (1 - 1 / leverage + MAINT_MARGIN_RATE)
    : entry * (1 + 1 / leverage - MAINT_MARGIN_RATE);
}

function pnl(side, entry, price, qty) {
  return (side === 'long' ? price - entry : entry - price) * qty;
}

/** Price a taker gets now: opening long / closing short pays the ask; opening short / closing long gets the bid. */
function takerPrice(quote, action) {
  const buy = action === 'buy';
  if (buy) return quote.ask > 0 ? quote.ask : quote.price;
  return quote.bid > 0 ? quote.bid : quote.price;
}
const openAction = (side) => (side === 'long' ? 'buy' : 'sell');
const closeAction = (side) => (side === 'long' ? 'sell' : 'buy');

function roundDown(n, d) {
  const f = 10 ** d;
  return Math.floor(n * f + EPS) / f;
}

function usd(userId) {
  return q.usd.get(userId) || { amount: 0, locked: 0 };
}
function saveUsd(userId, b) {
  q.setUsd.run(userId, Math.max(0, b.amount), Math.max(0, b.locked));
}

// ---------------------------------------------------------------- DTOs
function positionDTO(p, quote = prices.getQuote(p.symbol)) {
  const mark = quote?.price ?? p.entry_price;
  const open = p.status === 'open';
  const upnl = open ? pnl(p.side, p.entry_price, mark, p.qty) : null;
  return {
    id: p.id, symbol: p.symbol, side: p.side, qty: p.qty, leverage: p.leverage,
    entryPrice: p.entry_price, markPrice: open ? mark : null, liqPrice: p.liq_price,
    margin: p.margin, notional: p.qty * (open ? mark : p.entry_price),
    sl: p.sl, tp: p.tp, openFee: p.open_fee, status: p.status,
    unrealizedPnl: upnl, roe: open ? (upnl / p.margin) * 100 : null,
    closePrice: p.close_price, closeFee: p.close_fee, realizedPnl: p.realized_pnl,
    realizedRoe: p.realized_pnl != null ? (p.realized_pnl / p.margin) * 100 : null,
    closeReason: p.close_reason, openedAt: p.opened_at, closedAt: p.closed_at,
  };
}

function orderDTO(o) {
  return {
    id: o.id, symbol: o.symbol, side: o.side, type: o.type, qty: o.qty, leverage: o.leverage,
    limitPrice: o.limit_price, sl: o.sl, tp: o.tp, reserved: o.reserved, status: o.status,
    fillPrice: o.fill_price, fee: o.fee, positionId: o.position_id, createdAt: o.created_at, updatedAt: o.updated_at,
  };
}

// ---------------------------------------------------------------- validation
function parseLeverage(v) {
  const lev = Number(v);
  if (!Number.isInteger(lev) || lev < 1 || lev > MAX_LEVERAGE) {
    throw httpError(400, `Leverage must be a whole number from 1x to ${MAX_LEVERAGE}x.`);
  }
  return lev;
}

function parseOptionalPrice(v, label) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!(n > 0) || !Number.isFinite(n)) throw httpError(400, `${label} must be a positive price.`);
  return n;
}

/** Checks SL/TP make sense for a position on `side` priced around `ref` with liquidation at `liq`. */
function validateTpSl(side, ref, liq, sl, tp, m) {
  const fmt = (n) => n.toFixed(m.priceDecimals);
  if (side === 'long') {
    if (sl != null && sl >= ref) throw httpError(400, `Stop loss for a long must be below ${fmt(ref)}.`);
    if (sl != null && sl <= liq) throw httpError(400, `Stop loss must be above the liquidation price (${fmt(liq)}).`);
    if (tp != null && tp <= ref) throw httpError(400, `Take profit for a long must be above ${fmt(ref)}.`);
  } else {
    if (sl != null && sl <= ref) throw httpError(400, `Stop loss for a short must be above ${fmt(ref)}.`);
    if (sl != null && sl >= liq) throw httpError(400, `Stop loss must be below the liquidation price (${fmt(liq)}).`);
    if (tp != null && tp >= ref) throw httpError(400, `Take profit for a short must be below ${fmt(ref)}.`);
  }
}

// ---------------------------------------------------------------- core actions
/** Opens a position inside an existing transaction. Returns the position row. */
function openPosition(userId, { symbol, side, qty, leverage, price, sl, tp }, reserved) {
  const notional = qty * price;
  const margin = notional / leverage;
  const fee = notional * FEE_RATE;
  const b = usd(userId);
  b.locked -= reserved;
  if (b.amount - b.locked + EPS < margin + fee) throw httpError(400, 'Insufficient available balance for this margin.');
  b.amount -= margin + fee;
  saveUsd(userId, b);
  const liq = liqPrice(side, price, leverage);
  const { lastInsertRowid } = q.insertPos.run(userId, symbol, side, qty, leverage, price, margin, liq, sl, tp, fee, Date.now());
  return q.pos.get(lastInsertRowid);
}

/** Closes an open position inside an existing transaction at `price`. */
function settleClose(p, price, reason) {
  let fee;
  let realized;
  let credit;
  if (reason === 'liquidation') {
    // Isolated margin: the position's margin is lost; nothing is returned to the wallet.
    fee = 0;
    realized = -p.margin;
    credit = 0;
  } else {
    fee = p.qty * price * FEE_RATE;
    const gross = pnl(p.side, p.entry_price, price, p.qty);
    credit = Math.max(0, p.margin + gross - fee); // loss can never exceed the isolated margin
    realized = credit - p.margin;
  }
  const b = usd(p.user_id);
  b.amount += credit;
  saveUsd(p.user_id, b);
  q.closePos.run(price, fee, realized, reason, Date.now(), p.id);
  return q.pos.get(p.id);
}

function placeOrder(userId, input) {
  const m = BY_SYMBOL[input.symbol];
  if (!m) throw httpError(400, 'Unknown market.');
  const side = input.side;
  if (!['long', 'short'].includes(side)) throw httpError(400, 'Side must be long or short.');
  const type = input.type;
  if (!['market', 'limit'].includes(type)) throw httpError(400, 'Order type must be market or limit.');
  const leverage = parseLeverage(input.leverage ?? 1);

  const qty = roundDown(Number(input.qty), m.qtyDecimals);
  if (!Number.isFinite(qty) || qty <= 0) throw httpError(400, 'Enter a position size.');

  const quote = prices.getQuote(m.symbol);
  if (!quote?.price) throw httpError(503, 'No live price for this market yet. Try again in a moment.');
  const marketOpen = quote.marketOpen !== false;
  if (type === 'market' && !marketOpen) {
    throw httpError(400, `${m.name} market is closed. Use a limit order — it fills when trading resumes.`);
  }

  const limitPrice = type === 'limit' ? parseOptionalPrice(input.limitPrice, 'Limit price') : null;
  if (type === 'limit' && limitPrice == null) throw httpError(400, 'Enter a limit price.');
  const sl = parseOptionalPrice(input.sl, 'Stop loss');
  const tp = parseOptionalPrice(input.tp, 'Take profit');

  const px = takerPrice(quote, openAction(side));
  const marketable = type === 'market' || (marketOpen && (side === 'long' ? limitPrice >= px : limitPrice <= px));
  const entry = marketable ? px : limitPrice;
  if (qty * entry < MIN_NOTIONAL) throw httpError(400, `Minimum position size is $${MIN_NOTIONAL}.`);
  validateTpSl(side, entry, liqPrice(side, entry, leverage), sl, tp, m);

  const now = Date.now();
  const result = tx(() => {
    if (marketable) {
      const pos = openPosition(userId, { symbol: m.symbol, side, qty, leverage, price: px, sl, tp }, 0);
      const { lastInsertRowid } = q.insertOrder.run(userId, m.symbol, side, type, qty, leverage, limitPrice, sl, tp, 0, 'filled', px, pos.open_fee, pos.id, now, now);
      return { order: q.order.get(lastInsertRowid), position: pos };
    }
    const notional = qty * limitPrice;
    const reserved = notional / leverage + notional * FEE_RATE;
    const b = usd(userId);
    if (b.amount - b.locked + EPS < reserved) throw httpError(400, 'Insufficient available balance for this margin.');
    b.locked += reserved;
    saveUsd(userId, b);
    const { lastInsertRowid } = q.insertOrder.run(userId, m.symbol, side, type, qty, leverage, limitPrice, sl, tp, reserved, 'open', null, 0, null, now, now);
    return { order: q.order.get(lastInsertRowid), position: null };
  });

  const out = { order: orderDTO(result.order), position: result.position ? positionDTO(result.position) : null };
  events.emit('account', userId, { kind: result.position ? 'opened' : 'order', ...out });
  return out;
}

function cancelOrder(userId, orderId) {
  const order = tx(() => {
    const o = q.order.get(Number(orderId));
    if (!o || o.user_id !== userId) throw httpError(404, 'Order not found.');
    if (o.status !== 'open') throw httpError(400, 'Order is no longer open.');
    const b = usd(userId);
    b.locked -= o.reserved;
    saveUsd(userId, b);
    q.cancelOrder.run(Date.now(), o.id);
    return q.order.get(o.id);
  });
  const dto = orderDTO(order);
  events.emit('account', userId, { kind: 'cancelled', order: dto });
  return dto;
}

function closePosition(userId, positionId, reason = 'manual') {
  const p0 = q.pos.get(Number(positionId));
  if (!p0 || p0.user_id !== userId) throw httpError(404, 'Position not found.');
  if (p0.status !== 'open') throw httpError(400, 'Position is already closed.');
  const quote = prices.getQuote(p0.symbol);
  if (!quote?.price) throw httpError(503, 'No live price for this market yet.');
  if (quote.marketOpen === false) {
    throw httpError(400, `${BY_SYMBOL[p0.symbol]?.name || p0.symbol} market is closed. Set a stop loss / take profit — they trigger when trading resumes.`);
  }
  const price = takerPrice(quote, closeAction(p0.side));
  const closed = tx(() => {
    const p = q.pos.get(p0.id);
    if (p.status !== 'open') throw httpError(400, 'Position is already closed.');
    return settleClose(p, price, reason);
  });
  const dto = positionDTO(closed);
  events.emit('account', userId, { kind: 'closed', position: dto });
  return dto;
}

function closeAll(userId) {
  const open = q.userPositions.all(userId, 'open', 500);
  const closed = [];
  const skipped = [];
  for (const p of open) {
    try { closed.push(closePosition(userId, p.id)); } catch (err) { skipped.push({ id: p.id, symbol: p.symbol, reason: err.message }); }
  }
  return { closed, skipped };
}

function updateTpSl(userId, positionId, input) {
  const p = q.pos.get(Number(positionId));
  if (!p || p.user_id !== userId) throw httpError(404, 'Position not found.');
  if (p.status !== 'open') throw httpError(400, 'Position is already closed.');
  const m = BY_SYMBOL[p.symbol];
  const sl = parseOptionalPrice(input.sl, 'Stop loss');
  const tp = parseOptionalPrice(input.tp, 'Take profit');
  const mark = prices.getQuote(p.symbol)?.price ?? p.entry_price;
  validateTpSl(p.side, mark, p.liq_price, sl, tp, m);
  q.setTpSl.run(sl, tp, p.id);
  const dto = positionDTO(q.pos.get(p.id));
  events.emit('account', userId, { kind: 'tpsl', position: dto });
  return dto;
}

// ---------------------------------------------------------------- live tick processing
function onTick(quote) {
  if (quote.marketOpen === false || !quote.price) return;
  const symbol = quote.symbol;

  // 1) Resting limit orders that the market has reached.
  for (const o of q.openOrdersForSymbol.all(symbol)) {
    const px = takerPrice(quote, openAction(o.side));
    const hit = o.side === 'long' ? px <= o.limit_price : px >= o.limit_price;
    if (!hit) continue;
    try {
      const res = tx(() => {
        const pos = openPosition(o.user_id, {
          symbol, side: o.side, qty: o.qty, leverage: o.leverage, price: o.limit_price, sl: o.sl, tp: o.tp,
        }, o.reserved);
        q.fillOrder.run(o.limit_price, pos.open_fee, pos.id, Date.now(), o.id);
        return { order: q.order.get(o.id), position: pos };
      });
      events.emit('account', o.user_id, { kind: 'filled', order: orderDTO(res.order), position: positionDTO(res.position, quote) });
    } catch (err) {
      console.error(`[engine] could not fill order ${o.id}: ${err.message}`);
    }
  }

  // 2) Liquidations, stop losses and take profits on open positions (mark = last trade price).
  const mark = quote.price;
  for (const p of q.openPosForSymbol.all(symbol)) {
    const long = p.side === 'long';
    let reason = null;
    if (long ? mark <= p.liq_price : mark >= p.liq_price) reason = 'liquidation';
    else if (p.sl != null && (long ? mark <= p.sl : mark >= p.sl)) reason = 'stop_loss';
    else if (p.tp != null && (long ? mark >= p.tp : mark <= p.tp)) reason = 'take_profit';
    if (!reason) continue;
    const price = reason === 'liquidation' ? p.liq_price : takerPrice(quote, closeAction(p.side));
    try {
      const closed = tx(() => settleClose(q.pos.get(p.id), price, reason));
      events.emit('account', p.user_id, { kind: reason, position: positionDTO(closed, quote) });
    } catch (err) {
      console.error(`[engine] could not close position ${p.id}: ${err.message}`);
    }
  }
}

// ---------------------------------------------------------------- queries
function listOrders(userId, status, limit = 100) {
  return q.userOrders.all(userId, status, Math.min(Number(limit) || 100, 500)).map(orderDTO);
}

function listPositions(userId, status, limit = 200) {
  return q.userPositions.all(userId, status, Math.min(Number(limit) || 200, 500)).map((p) => positionDTO(p));
}

function account(userId) {
  const b = usd(userId);
  const positions = listPositions(userId, 'open');
  let marginUsed = 0;
  let unrealizedPnl = 0;
  let notional = 0;
  for (const p of positions) {
    marginUsed += p.margin;
    unrealizedPnl += p.unrealizedPnl;
    notional += p.notional;
  }
  const equity = b.amount + marginUsed + unrealizedPnl;
  const stats = q.realizedSum.get(userId);
  return {
    wallet: b.amount,
    available: b.amount - b.locked,
    inOrders: b.locked,
    marginUsed,
    unrealizedPnl,
    equity,
    exposure: notional,
    effectiveLeverage: equity > 0 ? notional / equity : 0,
    startingBalance: STARTING_USD,
    totalPnl: equity - STARTING_USD,
    totalPnlPct: ((equity - STARTING_USD) / STARTING_USD) * 100,
    realizedPnl: stats.pnl,
    closedTrades: stats.n,
    winRate: stats.n ? (stats.wins / stats.n) * 100 : null,
    positions,
  };
}

/** True while any account has open positions or resting orders that need live price checks. */
function hasOpenWork() {
  return !!db.prepare("SELECT 1 FROM positions WHERE status = 'open' UNION ALL SELECT 1 FROM trade_orders WHERE status = 'open' LIMIT 1").get();
}

function resetAccount(userId) {
  tx(() => {
    db.prepare('DELETE FROM trade_orders WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM positions WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM orders WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM balances WHERE user_id = ?').run(userId);
    db.prepare("INSERT INTO balances (user_id, asset, amount) VALUES (?, 'USD', ?)").run(userId, STARTING_USD);
  });
}

// ---------------------------------------------------------------- migration from the spot engine
// Older databases hold spot balances per asset. Convert each into a 1x long position at its
// average cost, release any reservations and cancel the old spot orders. Runs once (idempotent).
(function migrateSpot() {
  const legacy = db.prepare("SELECT user_id, asset, amount, avg_cost FROM balances WHERE asset != 'USD'").all();
  const hasOpenSpot = db.prepare("SELECT 1 FROM orders WHERE status = 'open' LIMIT 1").get();
  if (!legacy.length && !hasOpenSpot) return;
  tx(() => {
    const now = Date.now();
    for (const r of legacy) {
      if (r.amount > EPS && r.avg_cost > 0 && BY_SYMBOL[r.asset]) {
        const margin = r.amount * r.avg_cost;
        q.insertPos.run(r.user_id, r.asset, 'long', r.amount, 1, r.avg_cost, margin, liqPrice('long', r.avg_cost, 1), null, null, 0, now);
      }
    }
    db.prepare("DELETE FROM balances WHERE asset != 'USD'").run();
    db.prepare("UPDATE orders SET status = 'cancelled', reserved = 0, updated_at = ? WHERE status = 'open'").run(now);
    db.prepare("UPDATE balances SET locked = 0 WHERE asset = 'USD'").run();
  });
  console.log(`[engine] migrated ${legacy.length} spot holding(s) to 1x long positions`);
})();

prices.feed.on('tick', onTick);

module.exports = {
  FEE_RATE, MAINT_MARGIN_RATE, MIN_NOTIONAL, MAX_LEVERAGE, events,
  placeOrder, cancelOrder, closePosition, closeAll, updateTpSl,
  listOrders, listPositions, account, resetAccount, liqPrice, hasOpenWork,
};
