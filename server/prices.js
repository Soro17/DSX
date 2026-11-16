// Live market data.
//  - Crypto: Coinbase Exchange public websocket (ticker channel), real-time, no API key.
//  - Metals / stocks / indices / forex: Yahoo Finance public chart API, polled.
// Emits 'tick' (quote) whenever a price changes.

const { EventEmitter } = require('node:events');
const { WebSocket: WsClient } = require('ws');
const { MARKETS, BY_SYMBOL } = require('./markets');

const COINBASE_REST = 'https://api.exchange.coinbase.com';
const COINBASE_WS = 'wss://ws-feed.exchange.coinbase.com';
const YAHOO = 'https://query1.finance.yahoo.com';
const UA = { 'User-Agent': 'Mozilla/5.0 (DSX market data)' };
const YAHOO_POLL_MS = 8_000;

const feed = new EventEmitter();
feed.setMaxListeners(50);

/** symbol -> quote */
const quotes = {};

function setQuote(symbol, patch) {
  const prev = quotes[symbol] || { symbol };
  const q = { ...prev, ...patch, symbol, ts: Date.now() };
  if (q.price && q.open) {
    q.change = q.price - q.open;
    q.changePct = (q.change / q.open) * 100;
  }
  quotes[symbol] = q;
  if (prev.price !== q.price || prev.marketOpen !== q.marketOpen) feed.emit('tick', q);
}

function getQuote(symbol) {
  return quotes[symbol] || null;
}

function allQuotes() {
  return MARKETS.map((m) => quotes[m.symbol]).filter(Boolean);
}

async function getJSON(url) {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

// ---------------------------------------------------------------- Coinbase
const cryptoMarkets = MARKETS.filter((m) => m.source === 'coinbase');
const byFeed = Object.fromEntries(MARKETS.map((m) => [m.feed, m]));

async function seedCoinbase() {
  await Promise.all(
    cryptoMarkets.map(async (m) => {
      try {
        const [t, s] = await Promise.all([
          getJSON(`${COINBASE_REST}/products/${m.feed}/ticker`),
          getJSON(`${COINBASE_REST}/products/${m.feed}/stats`),
        ]);
        setQuote(m.symbol, {
          price: +t.price, bid: +t.bid, ask: +t.ask,
          open: +s.open, high: +s.high, low: +s.low, volume: +s.volume,
          marketOpen: true,
        });
      } catch (err) {
        console.warn(`[prices] coinbase seed ${m.feed}: ${err.message}`);
      }
    }),
  );
}

// Honour HTTPS_PROXY for the websocket when one is configured (fetch uses NODE_USE_ENV_PROXY).
const PROXY = process.env.HTTPS_PROXY || process.env.https_proxy;
const wsAgent = PROXY ? new (require('https-proxy-agent').HttpsProxyAgent)(PROXY) : undefined;

let cbRetry = 1_000;
function connectCoinbase() {
  const ws = new WsClient(COINBASE_WS, { agent: wsAgent });
  ws.addEventListener('open', () => {
    cbRetry = 1_000;
    ws.send(JSON.stringify({ type: 'subscribe', product_ids: cryptoMarkets.map((m) => m.feed), channels: ['ticker'] }));
    console.log('[prices] coinbase websocket connected');
  });
  ws.addEventListener('message', (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.type !== 'ticker') return;
    const m = byFeed[msg.product_id];
    if (!m) return;
    setQuote(m.symbol, {
      price: +msg.price, bid: +msg.best_bid, ask: +msg.best_ask,
      open: +msg.open_24h, high: +msg.high_24h, low: +msg.low_24h, volume: +msg.volume_24h,
      marketOpen: true,
    });
  });
  ws.addEventListener('close', () => {
    console.warn(`[prices] coinbase websocket closed; reconnecting in ${cbRetry}ms`);
    setTimeout(connectCoinbase, cbRetry);
    cbRetry = Math.min(cbRetry * 2, 30_000);
  });
  ws.addEventListener('error', (ev) => console.warn(`[prices] coinbase websocket error: ${ev.message || 'unknown'}`));
}

// ---------------------------------------------------------------- Yahoo
const yahooMarkets = MARKETS.filter((m) => m.source === 'yahoo');

async function pollYahoo() {
  const symbols = yahooMarkets.map((m) => encodeURIComponent(m.feed)).join(',');
  try {
    const data = await getJSON(`${YAHOO}/v8/finance/spark?symbols=${symbols}&range=1d&interval=1m`);
    const now = Date.now() / 1000;
    for (const m of yahooMarkets) {
      const d = data[m.feed];
      if (!d || !Array.isArray(d.close)) continue;
      let price = null;
      let high = -Infinity;
      let low = Infinity;
      for (const c of d.close) {
        if (c == null) continue;
        price = c;
        if (c > high) high = c;
        if (c < low) low = c;
      }
      if (price == null) continue;
      setQuote(m.symbol, {
        price,
        open: d.previousClose ?? d.chartPreviousClose,
        high: Number.isFinite(high) ? high : undefined,
        low: Number.isFinite(low) ? low : undefined,
        marketOpen: now >= d.start && now <= d.end,
      });
    }
  } catch (err) {
    console.warn(`[prices] yahoo poll: ${err.message}`);
  }
}

// ---------------------------------------------------------------- Candles
const TF = {
  '1m':  { cb: 60,    yi: '1m',  yr: '5d' },
  '5m':  { cb: 300,   yi: '5m',  yr: '5d' },
  '15m': { cb: 900,   yi: '15m', yr: '1mo' },
  '1h':  { cb: 3600,  yi: '60m', yr: '3mo' },
  '1d':  { cb: 86400, yi: '1d',  yr: '2y' },
};
const candleCache = new Map();

/** Returns [{time (unix s), open, high, low, close, volume}] oldest first. */
async function getCandles(symbol, tf) {
  const m = BY_SYMBOL[symbol];
  const t = TF[tf];
  if (!m || !t) throw Object.assign(new Error('Unknown symbol or timeframe'), { status: 400 });
  const key = `${symbol}:${tf}`;
  const hit = candleCache.get(key);
  if (hit && Date.now() - hit.at < 15_000) return hit.data;

  let data;
  if (m.source === 'coinbase') {
    const rows = await getJSON(`${COINBASE_REST}/products/${m.feed}/candles?granularity=${t.cb}`);
    data = rows
      .map(([time, low, high, open, close, volume]) => ({ time, open, high, low, close, volume }))
      .sort((a, b) => a.time - b.time);
  } else {
    const json = await getJSON(`${YAHOO}/v8/finance/chart/${encodeURIComponent(m.feed)}?interval=${t.yi}&range=${t.yr}`);
    const r = json.chart?.result?.[0];
    const q = r?.indicators?.quote?.[0] || {};
    data = [];
    (r?.timestamp || []).forEach((time, i) => {
      const [open, high, low, close] = [q.open?.[i], q.high?.[i], q.low?.[i], q.close?.[i]];
      if ([open, high, low, close].some((v) => v == null)) return;
      data.push({ time, open, high, low, close, volume: q.volume?.[i] || 0 });
    });
  }
  candleCache.set(key, { at: Date.now(), data });
  return data;
}

// ---------------------------------------------------------------- start
async function start() {
  await Promise.all([seedCoinbase(), pollYahoo()]);
  connectCoinbase();
  setInterval(pollYahoo, YAHOO_POLL_MS);
}

module.exports = { feed, start, getQuote, allQuotes, getCandles, TIMEFRAMES: Object.keys(TF) };
