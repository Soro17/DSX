const http = require('node:http');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const { WebSocketServer } = require('ws');

const { MARKETS, CATEGORIES } = require('./markets');
const prices = require('./prices');
const auth = require('./auth');
const engine = require('./engine');

const PORT = Number(process.env.PORT) || 3000;
const ROOT = path.join(__dirname, '..');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '20kb' }));

// ---------------------------------------------------------------- static
app.use(express.static(path.join(ROOT, 'public'), { extensions: ['html'] }));
app.get('/vendor/lightweight-charts.js', (_req, res) =>
  res.sendFile(path.join(ROOT, 'node_modules/lightweight-charts/dist/lightweight-charts.standalone.production.js')));
app.get('/vendor/three/three.module.js', (_req, res) =>
  res.sendFile(path.join(ROOT, 'node_modules/three/build/three.module.min.js')));
app.use('/vendor/three/addons', express.static(path.join(ROOT, 'node_modules/three/examples/jsm')));

// ---------------------------------------------------------------- helpers
const wrap = (fn) => (req, res) => {
  try {
    const out = fn(req, res);
    if (out && typeof out.then === 'function') {
      out.then((v) => v !== undefined && res.json(v)).catch((err) => sendError(res, err));
    } else if (out !== undefined) {
      res.json(out);
    }
  } catch (err) {
    sendError(res, err);
  }
};

function sendError(res, err) {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 && !err.status ? 'Something went wrong.' : err.message });
}

// ---------------------------------------------------------------- market data
app.get('/api/markets', wrap(() => ({
  categories: CATEGORIES,
  feeRate: engine.FEE_RATE,
  markets: MARKETS.map(({ feed, ...m }) => ({ ...m, quote: prices.getQuote(m.symbol) })),
})));

app.get('/api/candles/:symbol', wrap((req) => prices.getCandles(req.params.symbol, req.query.tf || '15m')));

// ---------------------------------------------------------------- auth
app.post('/api/auth/register', wrap((req, res) => {
  const id = auth.createUser(req.body || {});
  auth.setSessionCookie(res, auth.createSession(id));
  return { ok: true };
}));

app.post('/api/auth/login', wrap((req, res) => {
  const id = auth.verifyLogin(req.body?.email, req.body?.password);
  auth.setSessionCookie(res, auth.createSession(id));
  return { ok: true };
}));

// One-click demo: a throwaway account with the standard demo balance.
app.post('/api/auth/guest', wrap((_req, res) => {
  const tag = crypto.randomBytes(4).toString('hex');
  const id = auth.createUser({
    email: `guest-${tag}@demo.dsx`,
    name: `Guest ${tag.slice(0, 4).toUpperCase()}`,
    password: crypto.randomBytes(24).toString('hex'),
  });
  auth.setSessionCookie(res, auth.createSession(id));
  return { ok: true };
}));

app.post('/api/auth/logout', wrap((req, res) => {
  auth.destroySession(auth.tokenFromRequest(req));
  auth.clearSessionCookie(res);
  return { ok: true };
}));

app.get('/api/me', wrap((req) => ({ user: auth.userFromToken(auth.tokenFromRequest(req)) })));

// ---------------------------------------------------------------- trading
app.get('/api/portfolio', auth.requireUser, wrap((req) => engine.portfolio(req.user.id)));

app.get('/api/orders', auth.requireUser, wrap((req) => {
  const status = ['open', 'filled', 'cancelled'].includes(req.query.status) ? req.query.status : 'open';
  return engine.listOrders(req.user.id, status, req.query.limit);
}));

app.post('/api/orders', auth.requireUser, wrap((req) => engine.placeOrder(req.user.id, req.body || {})));

app.delete('/api/orders/:id', auth.requireUser, wrap((req) => engine.cancelOrder(req.user.id, req.params.id)));

app.post('/api/account/reset', auth.requireUser, wrap((req) => {
  engine.resetAccount(req.user.id);
  return engine.portfolio(req.user.id);
}));

app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// ---------------------------------------------------------------- websocket
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
const socketsByUser = new Map(); // userId -> Set<ws>

wss.on('connection', (ws, req) => {
  const user = auth.userFromToken(auth.tokenFromRequest(req));
  ws.userId = user?.id ?? null;
  if (ws.userId) {
    if (!socketsByUser.has(ws.userId)) socketsByUser.set(ws.userId, new Set());
    socketsByUser.get(ws.userId).add(ws);
  }
  ws.send(JSON.stringify({ type: 'quotes', data: prices.allQuotes() }));
  ws.on('close', () => socketsByUser.get(ws.userId)?.delete(ws));
});

// Batch price ticks so clients get at most ~4 updates per second.
let pending = new Map();
prices.feed.on('tick', (q) => pending.set(q.symbol, q));
setInterval(() => {
  if (!pending.size) return;
  const msg = JSON.stringify({ type: 'quotes', data: [...pending.values()] });
  pending = new Map();
  for (const ws of wss.clients) if (ws.readyState === ws.OPEN) ws.send(msg);
}, 250);

engine.events.on('order', (userId, order) => {
  const msg = JSON.stringify({ type: 'order', data: order });
  for (const ws of socketsByUser.get(userId) || []) if (ws.readyState === ws.OPEN) ws.send(msg);
});

// ---------------------------------------------------------------- boot
server.listen(PORT, () => console.log(`DSX running on http://localhost:${PORT}`));
prices.start().catch((err) => console.error('[prices] failed to start', err));
