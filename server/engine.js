// Demo trading engine: orders execute against live market prices.
//  - Market orders fill immediately (crypto at best bid/ask, others at last price).
//  - Limit orders reserve funds and fill when the live price reaches the limit.
//  - Spot only (no leverage / short selling). Fee: 0.10% of notional.

const { EventEmitter } = require('node:events');
const { db, tx } = require('./db');
const { BY_SYMBOL } = require('./markets');
const prices = require('./prices');
const { STARTING_USD, httpError } = require('./auth');

const FEE_RATE = 0.001;
const MIN_NOTIONAL = 1; // USD
const EPS = 1e-9;

const events = new EventEmitter();

const q = {
  balance: db.prepare('SELECT amount, locked, avg_cost FROM balances WHERE user_id = ? AND asset = ?'),
  upsertBalance: db.prepare(`
    INSERT INTO balances (user_id, asset, amount, locked, avg_cost) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id, asset) DO UPDATE SET amount = excluded.amount, locked = excluded.locked, avg_cost = excluded.avg_cost`),
  deleteBalance: db.prepare('DELETE FROM balances WHERE user_id = ? AND asset = ?'),
  balances: db.prepare('SELECT asset, amount, locked, avg_cost FROM balances WHERE user_id = ?'),
  insertOrder: db.prepare(`
    INSERT INTO orders (user_id, symbol, side, type, qty, limit_price, status, fill_price, fee, realized_pnl, reserved, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
  order: db.prepare('SELECT * FROM orders WHERE id = ?'),
  fillOrder: db.prepare("UPDATE orders SET status = 'filled', fill_price = ?, fee = ?, realized_pnl = ?, reserved = 0, updated_at = ? WHERE id = ? AND status = 'open'"),
  cancelOrder: db.prepare("UPDATE orders SET status = 'cancelled', reserved = 0, updated_at = ? WHERE id = ? AND status = 'open'"),
  openForSymbol: db.prepare("SELECT * FROM orders WHERE status = 'open' AND symbol = ? ORDER BY created_at"),
  userOrders: db.prepare('SELECT * FROM orders WHERE user_id = ? AND status = ? ORDER BY updated_at DESC LIMIT ?'),
};

function bal(userId, asset) {
  return q.balance.get(userId, asset) || { amount: 0, locked: 0, avg_cost: 0 };
}

function saveBal(userId, asset, b) {
  if (asset !== 'USD' && b.amount <= EPS && b.locked <= EPS) q.deleteBalance.run(userId, asset);
  else q.upsertBalance.run(userId, asset, Math.max(0, b.amount), Math.max(0, b.locked), b.avg_cost);
}

function round(n, d) {
  const f = 10 ** d;
  return Math.floor(n * f + EPS) / f;
}

function toDTO(o) {
  return {
    id: o.id, symbol: o.symbol, side: o.side, type: o.type, qty: o.qty,
    limitPrice: o.limit_price, status: o.status, fillPrice: o.fill_price,
    fee: o.fee, realizedPnl: o.realized_pnl, createdAt: o.created_at, updatedAt: o.updated_at,
  };
}

/** Price a taker would get right now. */
function execPrice(quote, side) {
  if (side === 'buy') return quote.ask > 0 ? quote.ask : quote.price;
  return quote.bid > 0 ? quote.bid : quote.price;
}

/**
 * Settle a fill against balances. `reserved` is what the order had locked (0 for immediate fills).
 * Returns { fee, realizedPnl }.
 */
function settle(userId, symbol, side, qty, price, reserved) {
  const usd = bal(userId, 'USD');
  const asset = bal(userId, symbol);
  const notional = qty * price;
  const fee = notional * FEE_RATE;

  if (side === 'buy') {
    usd.locked -= reserved;
    if (usd.amount - usd.locked + EPS < notional + fee) throw httpError(400, 'Insufficient USD balance.');
    usd.amount -= notional + fee;
    const newAmt = asset.amount + qty;
    asset.avg_cost = (asset.amount * asset.avg_cost + notional + fee) / newAmt;
    asset.amount = newAmt;
    saveBal(userId, 'USD', usd);
    saveBal(userId, symbol, asset);
    return { fee, realizedPnl: null };
  }

  asset.locked -= reserved;
  if (asset.amount - asset.locked + EPS < qty) throw httpError(400, `Insufficient ${symbol} balance.`);
  const realizedPnl = (price - asset.avg_cost) * qty - fee;
  asset.amount -= qty;
  if (asset.amount <= EPS) asset.avg_cost = 0;
  usd.amount += notional - fee;
  saveBal(userId, 'USD', usd);
  saveBal(userId, symbol, asset);
  return { fee, realizedPnl };
}

function placeOrder(userId, input) {
  const m = BY_SYMBOL[input.symbol];
  if (!m) throw httpError(400, 'Unknown market.');
  const side = input.side;
  const type = input.type;
  if (!['buy', 'sell'].includes(side)) throw httpError(400, 'Side must be buy or sell.');
  if (!['market', 'limit'].includes(type)) throw httpError(400, 'Type must be market or limit.');

  const qty = round(Number(input.qty), m.qtyDecimals);
  if (!Number.isFinite(qty) || qty <= 0) throw httpError(400, `Quantity is too small (min step ${10 ** -m.qtyDecimals}).`);

  const quote = prices.getQuote(m.symbol);
  if (!quote?.price) throw httpError(503, 'No live price for this market yet. Try again in a moment.');

  const limitPrice = type === 'limit' ? Number(input.limitPrice) : null;
  if (type === 'limit' && !(limitPrice > 0)) throw httpError(400, 'Enter a valid limit price.');

  const marketOpen = quote.marketOpen !== false;
  if (type === 'market' && !marketOpen) {
    throw httpError(400, `${m.name} market is closed. Place a limit order — it will fill when trading resumes.`);
  }

  const px = execPrice(quote, side);
  const refPrice = type === 'limit' ? limitPrice : px;
  if (qty * refPrice < MIN_NOTIONAL) throw httpError(400, `Minimum order size is $${MIN_NOTIONAL}.`);

  const marketable = type === 'market' || (marketOpen && (side === 'buy' ? limitPrice >= px : limitPrice <= px));
  const now = Date.now();

  const order = tx(() => {
    if (marketable) {
      const { fee, realizedPnl } = settle(userId, m.symbol, side, qty, px, 0);
      const { lastInsertRowid } = q.insertOrder.run(userId, m.symbol, side, type, qty, limitPrice, 'filled', px, fee, realizedPnl, 0, now, now);
      return q.order.get(lastInsertRowid);
    }
    // Resting limit order: reserve funds.
    let reserved;
    if (side === 'buy') {
      reserved = qty * limitPrice * (1 + FEE_RATE);
      const usd = bal(userId, 'USD');
      if (usd.amount - usd.locked + EPS < reserved) throw httpError(400, 'Insufficient USD balance.');
      usd.locked += reserved;
      saveBal(userId, 'USD', usd);
    } else {
      reserved = qty;
      const a = bal(userId, m.symbol);
      if (a.amount - a.locked + EPS < reserved) throw httpError(400, `Insufficient ${m.symbol} balance.`);
      a.locked += reserved;
      saveBal(userId, m.symbol, a);
    }
    const { lastInsertRowid } = q.insertOrder.run(userId, m.symbol, side, type, qty, limitPrice, 'open', null, 0, null, reserved, now, now);
    return q.order.get(lastInsertRowid);
  });

  const dto = toDTO(order);
  events.emit('order', userId, dto);
  return dto;
}

function cancelOrder(userId, orderId) {
  const order = tx(() => {
    const o = q.order.get(Number(orderId));
    if (!o || o.user_id !== userId) throw httpError(404, 'Order not found.');
    if (o.status !== 'open') throw httpError(400, 'Order is no longer open.');
    const asset = o.side === 'buy' ? 'USD' : o.symbol;
    const b = bal(userId, asset);
    b.locked -= o.reserved;
    saveBal(userId, asset, b);
    q.cancelOrder.run(Date.now(), o.id);
    return q.order.get(o.id);
  });
  const dto = toDTO(order);
  events.emit('order', userId, dto);
  return dto;
}

/** Called on each live price tick: fill any limit orders the price has reached. */
function onTick(quote) {
  if (quote.marketOpen === false) return;
  for (const o of q.openForSymbol.all(quote.symbol)) {
    const px = execPrice(quote, o.side);
    const hit = o.side === 'buy' ? px <= o.limit_price : px >= o.limit_price;
    if (!hit) continue;
    try {
      const filled = tx(() => {
        const { fee, realizedPnl } = settle(o.user_id, o.symbol, o.side, o.qty, o.limit_price, o.reserved);
        q.fillOrder.run(o.limit_price, fee, realizedPnl, Date.now(), o.id);
        return q.order.get(o.id);
      });
      events.emit('order', o.user_id, toDTO(filled));
    } catch (err) {
      console.error(`[engine] failed to fill order ${o.id}: ${err.message}`);
    }
  }
}

function listOrders(userId, status, limit = 100) {
  return q.userOrders.all(userId, status, Math.min(Number(limit) || 100, 500)).map(toDTO);
}

function portfolio(userId) {
  let cash = 0;
  let cashLocked = 0;
  let holdingsValue = 0;
  const holdings = [];
  for (const b of q.balances.all(userId)) {
    if (b.asset === 'USD') {
      cash = b.amount;
      cashLocked = b.locked;
      continue;
    }
    const m = BY_SYMBOL[b.asset];
    const price = prices.getQuote(b.asset)?.price ?? b.avg_cost;
    const value = b.amount * price;
    holdingsValue += value;
    holdings.push({
      symbol: b.asset, name: m?.name, category: m?.category,
      qty: b.amount, locked: b.locked, avgCost: b.avg_cost, price, value,
      unrealizedPnl: (price - b.avg_cost) * b.amount,
      unrealizedPct: b.avg_cost ? ((price - b.avg_cost) / b.avg_cost) * 100 : 0,
    });
  }
  holdings.sort((a, b) => b.value - a.value);
  const equity = cash + holdingsValue;
  return {
    cash, cashAvailable: cash - cashLocked, cashLocked, holdingsValue, equity,
    startingBalance: STARTING_USD,
    totalPnl: equity - STARTING_USD,
    totalPnlPct: ((equity - STARTING_USD) / STARTING_USD) * 100,
    holdings,
  };
}

function resetAccount(userId) {
  tx(() => {
    db.prepare('DELETE FROM orders WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM balances WHERE user_id = ?').run(userId);
    db.prepare('INSERT INTO balances (user_id, asset, amount) VALUES (?, ?, ?)').run(userId, 'USD', STARTING_USD);
  });
}

prices.feed.on('tick', onTick);

module.exports = { FEE_RATE, events, placeOrder, cancelOrder, listOrders, portfolio, resetAccount };
