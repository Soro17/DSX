// Friendly check before anything loads: AG needs Node's built-in SQLite (Node 22.5+).
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 5)) {
  console.error(`\nAG Exchange needs Node.js 22.5 or newer — you have ${process.version}.\nDownload the current LTS from https://nodejs.org and run "npm start" again.\n`);
  process.exit(1);
}
// Hide Node's "SQLite is experimental" notice on versions that still print it.
const emit = process.emitWarning;
process.emitWarning = (w, ...rest) => (String(w).includes('SQLite') ? undefined : emit.call(process, w, ...rest));
// Node 22.5–22.12 only expose node:sqlite behind a flag: restart once with it.
try {
  require('node:sqlite');
} catch {
  if (!process.execArgv.includes('--experimental-sqlite')) {
    const { status } = require('node:child_process').spawnSync(
      process.execPath, ['--experimental-sqlite', ...process.execArgv, ...process.argv.slice(1)], { stdio: 'inherit' });
    process.exit(status ?? 1);
  }
  throw new Error('node:sqlite is unavailable in this Node.js build.');
}

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
  trading: {
    feeRate: engine.FEE_RATE,
    maintMarginRate: engine.MAINT_MARGIN_RATE,
    maxLeverage: engine.MAX_LEVERAGE,
    minNotional: engine.MIN_NOTIONAL,
  },
  markets: MARKETS.map(({ feed, ...m }) => ({ ...m, quote: prices.getQuote(m.symbol) })),
})));

app.get('/api/sparklines', wrap(() => prices.getSparklines()));

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
    email: `guest-${tag}@demo.ag`,
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
app.get('/api/account', auth.requireUser, wrap((req) => engine.account(req.user.id)));

app.get('/api/positions', auth.requireUser, wrap((req) => {
  const status = req.query.status === 'closed' ? 'closed' : 'open';
  return engine.listPositions(req.user.id, status, req.query.limit);
}));
app.post('/api/positions/close-all', auth.requireUser, wrap((req) => engine.closeAll(req.user.id)));
app.post('/api/positions/:id/close', auth.requireUser, wrap((req) => engine.closePosition(req.user.id, req.params.id)));
app.patch('/api/positions/:id', auth.requireUser, wrap((req) => engine.updateTpSl(req.user.id, req.params.id, req.body || {})));

app.get('/api/orders', auth.requireUser, wrap((req) => {
  const status = ['open', 'filled', 'cancelled'].includes(req.query.status) ? req.query.status : 'open';
  return engine.listOrders(req.user.id, status, req.query.limit);
}));
app.post('/api/orders', auth.requireUser, wrap((req) => engine.placeOrder(req.user.id, req.body || {})));
app.delete('/api/orders/:id', auth.requireUser, wrap((req) => engine.cancelOrder(req.user.id, req.params.id)));

app.post('/api/account/reset', auth.requireUser, wrap((req) => {
  engine.resetAccount(req.user.id);
  return engine.account(req.user.id);
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

engine.events.on('account', (userId, event) => {
  const msg = JSON.stringify({ type: 'account', data: event });
  for (const ws of socketsByUser.get(userId) || []) if (ws.readyState === ws.OPEN) ws.send(msg);
});

// ---------------------------------------------------------------- boot
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\nPort ${PORT} is already in use. Close the other program or run with another port, e.g. PORT=3001 npm start\n`);
    process.exit(1);
  }
  throw err;
});
server.listen(PORT, () => console.log(`\n  AG Exchange is running → open http://localhost:${PORT} in your browser\n`));
prices.start().catch((err) => console.error('[prices] failed to start', err));
