// Engine tests with controlled prices (no network). Run: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DSX_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-test-'));
const prices = require('../server/prices');
const auth = require('../server/auth');
const engine = require('../server/engine');

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);
let n = 0;
const newUser = () => auth.createUser({ email: `t${++n}@test.io`, name: 'Tester', password: 'password123' });
const tick = (symbol, price, extra = {}) => prices.setQuote(symbol, { price, bid: price, ask: price, open: price, marketOpen: true, ...extra });

test('leverage is capped at 20x and must be a whole number', () => {
  const u = newUser();
  tick('BTC', 50_000);
  for (const bad of [0, 21, 25, 100, 2.5, 'abc', -3]) {
    assert.throws(() => engine.placeOrder(u, { symbol: 'BTC', side: 'long', type: 'market', qty: 0.01, leverage: bad }), /1x to 20x/);
  }
  const ok = engine.placeOrder(u, { symbol: 'BTC', side: 'long', type: 'market', qty: 0.01, leverage: 20 });
  assert.equal(ok.position.leverage, 20);
});

test('long position: margin, fee, liquidation price and PnL', () => {
  const u = newUser();
  tick('ETH', 2000);
  const { position: p } = engine.placeOrder(u, { symbol: 'ETH', side: 'long', type: 'market', qty: 10, leverage: 10 });
  near(p.margin, 2000);                       // 20,000 notional / 10x
  near(p.openFee, 10);                        // 0.05% of 20,000
  near(p.liqPrice, 2000 * (1 - 0.1 + 0.005)); // 1810
  const a = engine.account(u);
  near(a.available, 100_000 - 2000 - 10);
  tick('ETH', 2100);
  const a2 = engine.account(u);
  near(a2.unrealizedPnl, 1000);
  near(a2.positions[0].roe, 50);
  const closed = engine.closePosition(u, p.id);
  near(closed.realizedPnl, 1000 - 2100 * 10 * 0.0005); // pnl minus close fee
  near(engine.account(u).equity, 100_000 - 10 + 1000 - 10.5);
});

test('short position profits when price falls', () => {
  const u = newUser();
  tick('SOL', 100);
  const { position: p } = engine.placeOrder(u, { symbol: 'SOL', side: 'short', type: 'market', qty: 100, leverage: 5 });
  near(p.liqPrice, 100 * (1 + 0.2 - 0.005));
  tick('SOL', 90);
  near(engine.account(u).unrealizedPnl, 1000);
  const c = engine.closePosition(u, p.id);
  assert.ok(c.realizedPnl > 990);
});

test('liquidation wipes only the isolated margin', () => {
  const u = newUser();
  tick('XRP', 1);
  const { position: p } = engine.placeOrder(u, { symbol: 'XRP', side: 'long', type: 'market', qty: 10_000, leverage: 20 });
  const before = engine.account(u).wallet;
  tick('XRP', 0.9); // far below 0.955 liquidation price
  const [closed] = engine.listPositions(u, 'closed');
  assert.equal(closed.closeReason, 'liquidation');
  near(closed.realizedPnl, -p.margin);
  near(engine.account(u).wallet, before); // nothing returned, nothing extra lost
  assert.equal(engine.listPositions(u, 'open').length, 0);
});

test('stop loss and take profit trigger on live ticks', () => {
  const u = newUser();
  tick('ADA', 1);
  engine.placeOrder(u, { symbol: 'ADA', side: 'long', type: 'market', qty: 1000, leverage: 2, sl: 0.9, tp: 1.2 });
  engine.placeOrder(u, { symbol: 'ADA', side: 'short', type: 'market', qty: 1000, leverage: 2, sl: 1.25, tp: 0.95 });
  tick('ADA', 1.21); // long TP hits
  tick('ADA', 1.26); // short SL hits
  const reasons = engine.listPositions(u, 'closed').map((p) => `${p.side}:${p.closeReason}`).sort();
  assert.deepEqual(reasons, ['long:take_profit', 'short:stop_loss']);
});

test('invalid TP/SL is rejected', () => {
  const u = newUser();
  tick('AVAX', 10);
  assert.throws(() => engine.placeOrder(u, { symbol: 'AVAX', side: 'long', type: 'market', qty: 10, leverage: 10, sl: 11 }), /below/);
  assert.throws(() => engine.placeOrder(u, { symbol: 'AVAX', side: 'long', type: 'market', qty: 10, leverage: 10, sl: 9 }), /liquidation/);
  assert.throws(() => engine.placeOrder(u, { symbol: 'AVAX', side: 'short', type: 'market', qty: 10, leverage: 10, tp: 11 }), /below/);
  const { position } = engine.placeOrder(u, { symbol: 'AVAX', side: 'long', type: 'market', qty: 10, leverage: 10 });
  const upd = engine.updateTpSl(u, position.id, { sl: 9.5, tp: 12 });
  assert.equal(upd.sl, 9.5);
  assert.equal(upd.tp, 12);
  const cleared = engine.updateTpSl(u, position.id, { sl: null, tp: null });
  assert.equal(cleared.sl, null);
});

test('limit order reserves margin, fills when price reaches it, cancel releases funds', () => {
  const u = newUser();
  tick('LINK', 20);
  const { order } = engine.placeOrder(u, { symbol: 'LINK', side: 'long', type: 'limit', qty: 100, leverage: 4, limitPrice: 18, tp: 22 });
  assert.equal(order.status, 'open');
  near(engine.account(u).inOrders, 1800 / 4 + 1800 * 0.0005);
  tick('LINK', 19);
  assert.equal(engine.listOrders(u, 'open').length, 1);
  tick('LINK', 17.9);
  assert.equal(engine.listOrders(u, 'open').length, 0);
  const [pos] = engine.listPositions(u, 'open');
  assert.equal(pos.entryPrice, 18);
  assert.equal(pos.tp, 22);
  near(engine.account(u).inOrders, 0);

  const { order: o2 } = engine.placeOrder(u, { symbol: 'LINK', side: 'short', type: 'limit', qty: 10, leverage: 2, limitPrice: 30 });
  engine.cancelOrder(u, o2.id);
  near(engine.account(u).inOrders, 0);
});

test('insufficient balance and closed markets are handled', () => {
  const u = newUser();
  tick('BTC', 50_000);
  assert.throws(() => engine.placeOrder(u, { symbol: 'BTC', side: 'long', type: 'market', qty: 10, leverage: 2 }), /Insufficient/);
  tick('AAPL', 200, { marketOpen: false });
  assert.throws(() => engine.placeOrder(u, { symbol: 'AAPL', side: 'long', type: 'market', qty: 1, leverage: 1 }), /closed/);
  const { order } = engine.placeOrder(u, { symbol: 'AAPL', side: 'long', type: 'limit', qty: 1, leverage: 1, limitPrice: 205 });
  assert.equal(order.status, 'open'); // waits for the open even though it is marketable
});

test('close all and reset', () => {
  const u = newUser();
  tick('DOGE', 0.1);
  engine.placeOrder(u, { symbol: 'DOGE', side: 'long', type: 'market', qty: 1000, leverage: 3 });
  engine.placeOrder(u, { symbol: 'DOGE', side: 'short', type: 'market', qty: 1000, leverage: 3 });
  const r = engine.closeAll(u);
  assert.equal(r.closed.length, 2);
  engine.resetAccount(u);
  const a = engine.account(u);
  assert.equal(a.equity, 100_000);
  assert.equal(engine.listPositions(u, 'closed').length, 0);
});
