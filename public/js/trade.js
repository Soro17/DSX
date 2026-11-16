import {
  api, store, loadMarkets, connectLive, onQuotes, onOrder, openAuth, currentUser, logout, toast,
  fmtPrice, fmtUSD, fmtSignedUSD, fmtPct, fmtQty, dirClass, assetIcon, flash,
} from './common.js';

const $ = (id) => document.getElementById(id);
const TFS = ['1m', '5m', '15m', '1h', '1d'];
const TF_SEC = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '1d': 86400 };
const TZ_SHIFT = -new Date().getTimezoneOffset() * 60; // chart shows local time
const CAT_COLORS = { crypto: '#f7931a', metals: '#f4c55b', stocks: '#8b6cff', indices: '#c8ff3d', forex: '#7ab8ff' };

const state = {
  symbol: null,
  tf: localStorage.getItem('dsx.tf') || '15m',
  category: 'all',
  search: '',
  side: 'buy',
  type: 'market',
  tab: 'positions',
  user: null,
  portfolio: null,
  openOrders: [],
  history: [],
};
const safeStore = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

// =============================================================== markets list
function renderCategoryPills() {
  const box = $('cat-pills');
  box.innerHTML = '';
  for (const c of [{ id: 'all', label: 'All' }, ...store.categories]) {
    const b = document.createElement('button');
    b.className = `pill${state.category === c.id ? ' active' : ''}`;
    b.textContent = c.label;
    b.onclick = () => { state.category = c.id; renderCategoryPills(); renderMarketList(); };
    box.append(b);
  }
}

function renderMarketList() {
  const list = $('mp-list');
  list.innerHTML = '';
  const term = state.search.trim().toLowerCase();
  const items = store.markets.filter((m) =>
    (state.category === 'all' || m.category === state.category) &&
    (!term || m.symbol.toLowerCase().includes(term) || m.name.toLowerCase().includes(term)));
  if (!items.length) {
    list.innerHTML = '<div class="empty">No markets match.</div>';
    return;
  }
  for (const m of items) {
    const b = document.createElement('button');
    b.className = `mp-item${m.symbol === state.symbol ? ' active' : ''}`;
    b.dataset.symbol = m.symbol;
    b.append(assetIcon(m.symbol, true));
    b.insertAdjacentHTML('beforeend', '<span class="info"><div class="sym"></div><div class="nm"></div></span><span class="px num"><div class="p"></div><div class="c"></div></span>');
    b.querySelector('.sym').textContent = m.symbol;
    b.querySelector('.nm').textContent = m.name;
    b.onclick = () => { selectSymbol(m.symbol); closeDrawer(); };
    list.append(b);
    updateMarketItem(m.symbol);
  }
}

function updateMarketItem(symbol, prev) {
  const el = document.querySelector(`.mp-item[data-symbol="${symbol}"]`);
  const q = store.quotes[symbol];
  if (!el || !q) return;
  const p = el.querySelector('.p');
  p.textContent = fmtPrice(symbol, q.price);
  if (q.marketOpen === false) p.insertAdjacentHTML('beforeend', '<span class="dot" title="Market closed"></span>');
  flash(p, prev?.price, q.price);
  const c = el.querySelector('.c');
  c.textContent = fmtPct(q.changePct);
  c.className = `c ${dirClass(q.changePct)}`;
}

function openDrawer() { $('markets-panel').classList.add('open'); $('scrim').classList.remove('hidden'); $('search').focus(); }
function closeDrawer() { $('markets-panel').classList.remove('open'); $('scrim').classList.add('hidden'); }

// =============================================================== market header
function renderHeader() {
  const m = store.bySymbol[state.symbol];
  $('mh-ic').replaceChildren(assetIcon(m.symbol));
  $('mh-name').textContent = m.name;
  $('mh-sym').textContent = `${m.symbol}/USD${m.unit ? ` · per ${m.unit}` : ''} · ${store.categories.find((c) => c.id === m.category)?.label}`;
  $('sym-switch-ic').replaceChildren(assetIcon(m.symbol, true));
  $('sym-switch-label').textContent = `${m.symbol}/USD`;
  $('f-qty-suffix').textContent = m.symbol;
  document.title = `${m.symbol} — DSX Terminal`;
  updateHeader();
}

function updateHeader(prev) {
  const s = state.symbol;
  const q = store.quotes[s];
  if (!q) return;
  const price = $('mh-price');
  price.textContent = fmtPrice(s, q.price);
  flash(price, prev?.price, q.price);
  const chg = $('mh-chg');
  chg.textContent = `${fmtPrice(s, q.change)} (${fmtPct(q.changePct)})`.replace(/^(?!-)/, q.change >= 0 ? '+' : '');
  chg.className = `chg num ${dirClass(q.changePct)}`;
  $('mh-high').textContent = fmtPrice(s, q.high);
  $('mh-low').textContent = fmtPrice(s, q.low);
  $('mh-spread').textContent = q.bid ? `${fmtPrice(s, q.bid)} / ${fmtPrice(s, q.ask)}` : 'Last price';
  const st = $('mh-status');
  const open = q.marketOpen !== false;
  st.className = `badge ${open ? 'live' : 'closed'}`;
  st.textContent = open ? 'Live' : 'Closed';
  document.title = `${fmtPrice(s, q.price)} ${s} — DSX`;
}

// =============================================================== chart
let chart, candleSeries, volumeSeries, candles = [], chartReq = 0;
const orderLines = [];

function initChart() {
  const el = $('chart');
  chart = LightweightCharts.createChart(el, {
    autoSize: true,
    layout: { background: { type: 'solid', color: 'transparent' }, textColor: '#8a90a2', fontFamily: 'JetBrains Mono, monospace', fontSize: 11 },
    grid: { vertLines: { color: 'rgba(255,255,255,0.035)' }, horzLines: { color: 'rgba(255,255,255,0.035)' } },
    rightPriceScale: { borderColor: 'rgba(255,255,255,0.08)' },
    timeScale: { borderColor: 'rgba(255,255,255,0.08)', timeVisible: true, secondsVisible: false, rightOffset: 6 },
    crosshair: {
      mode: LightweightCharts.CrosshairMode.Normal,
      vertLine: { color: 'rgba(200,255,61,0.35)', labelBackgroundColor: '#1a1f2b' },
      horzLine: { color: 'rgba(200,255,61,0.35)', labelBackgroundColor: '#1a1f2b' },
    },
  });
  candleSeries = chart.addCandlestickSeries({
    upColor: '#22d39a', downColor: '#ff5470', borderVisible: false, wickUpColor: '#22d39a', wickDownColor: '#ff5470',
  });
  volumeSeries = chart.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: 'vol', lastValueVisible: false, priceLineVisible: false });
  chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });

  const box = $('tf-pills');
  for (const tf of TFS) {
    const b = document.createElement('button');
    b.className = `pill${tf === state.tf ? ' active' : ''}`;
    b.textContent = tf;
    b.dataset.tf = tf;
    b.onclick = () => {
      state.tf = tf;
      safeStore('dsx.tf', tf);
      box.querySelectorAll('.pill').forEach((p) => p.classList.toggle('active', p.dataset.tf === tf));
      loadCandles();
    };
    box.append(b);
  }
}

function chartMessage(text) {
  let msg = document.querySelector('.chart-msg');
  if (!text) { msg?.remove(); return; }
  if (!msg) { msg = document.createElement('div'); msg.className = 'chart-msg'; $('chart').append(msg); }
  msg.textContent = text;
}

async function loadCandles() {
  const req = ++chartReq;
  const m = store.bySymbol[state.symbol];
  candleSeries.applyOptions({ priceFormat: { type: 'price', precision: m.priceDecimals, minMove: 10 ** -m.priceDecimals } });
  chartMessage('Loading chart…');
  try {
    const data = await api(`/candles/${state.symbol}?tf=${state.tf}`);
    if (req !== chartReq) return;
    candles = data.map((c) => ({ ...c, time: c.time + TZ_SHIFT }));
    candleSeries.setData(candles);
    volumeSeries.setData(candles.map((c) => ({
      time: c.time, value: c.volume, color: c.close >= c.open ? 'rgba(34,211,154,0.25)' : 'rgba(255,84,112,0.25)',
    })));
    chart.timeScale().fitContent();
    chart.timeScale().scrollToRealTime();
    chartMessage(candles.length ? '' : 'No chart data for this timeframe.');
    $('chart-note').textContent = m.source === 'yahoo' && m.category !== 'forex' ? 'Prices may be delayed' : 'Real-time';
  } catch (err) {
    if (req === chartReq) chartMessage(`Chart unavailable: ${err.message}`);
  }
}

/** Fold a live tick into the latest candle. */
function tickChart(q) {
  if (!candles.length || q.symbol !== state.symbol || q.price == null) return;
  const last = candles[candles.length - 1];
  const size = TF_SEC[state.tf];
  const bucket = Math.floor((Date.now() / 1000 + TZ_SHIFT) / size) * size;
  let c;
  if (state.tf !== '1d' && q.marketOpen !== false && bucket > last.time) {
    c = { time: bucket, open: last.close, high: q.price, low: q.price, close: q.price, volume: 0 };
    candles.push(c);
  } else {
    c = last;
    c.close = q.price;
    c.high = Math.max(c.high, q.price);
    c.low = Math.min(c.low, q.price);
  }
  candleSeries.update(c);
}

function renderOrderLines() {
  while (orderLines.length) candleSeries.removePriceLine(orderLines.pop());
  for (const o of state.openOrders.filter((x) => x.symbol === state.symbol)) {
    orderLines.push(candleSeries.createPriceLine({
      price: o.limitPrice, color: o.side === 'buy' ? '#22d39a' : '#ff5470', lineWidth: 1,
      lineStyle: LightweightCharts.LineStyle.Dashed, axisLabelVisible: true,
      title: `${o.side === 'buy' ? 'BUY' : 'SELL'} ${fmtQty(o.symbol, o.qty)}`,
    }));
  }
}

// =============================================================== order form
const fee = () => store.feeRate;

function quotePrice() {
  const q = store.quotes[state.symbol];
  if (!q) return null;
  if (state.type === 'limit') {
    const lp = parseFloat($('f-limit').value);
    return lp > 0 ? lp : null;
  }
  return state.side === 'buy' ? (q.ask || q.price) : (q.bid || q.price);
}

function available() {
  const p = state.portfolio;
  if (!p) return 0;
  if (state.side === 'buy') return p.cashAvailable;
  const h = p.holdings.find((x) => x.symbol === state.symbol);
  return h ? h.qty - h.locked : 0;
}

function setSide(side) {
  state.side = side;
  document.querySelectorAll('.side-seg button').forEach((b) => b.classList.toggle('active', b.dataset.side === side));
  updateForm('qty');
}

function setType(type) {
  state.type = type;
  document.querySelectorAll('.type-tabs button').forEach((b) => b.classList.toggle('active', b.dataset.type === type));
  document.querySelector('.limit-only').classList.toggle('hidden', type !== 'limit');
  if (type === 'limit' && !$('f-limit').value) {
    const q = store.quotes[state.symbol];
    if (q?.price) $('f-limit').value = q.price.toFixed(store.bySymbol[state.symbol].priceDecimals);
  }
  updateForm('qty');
}

/** Recompute derived fields. `source` says which input the user edited ('qty' or 'total'). */
function updateForm(source) {
  const m = store.bySymbol[state.symbol];
  const price = quotePrice();
  const qtyEl = $('f-qty');
  const totalEl = $('f-total');
  if (price && source === 'total') {
    const total = parseFloat(totalEl.value);
    qtyEl.value = total > 0 ? +(total / price).toFixed(m.qtyDecimals) : '';
  } else if (price && source === 'qty') {
    const qty = parseFloat(qtyEl.value);
    totalEl.value = qty > 0 ? (qty * price).toFixed(2) : '';
  }
  const qty = parseFloat(qtyEl.value) || 0;
  const notional = price ? qty * price : 0;
  const f = notional * fee();
  const buying = state.side === 'buy';

  $('s-avail').textContent = buying ? fmtUSD(available()) : `${fmtQty(m.symbol, available())} ${m.symbol}`;
  $('s-price-lbl').textContent = state.type === 'limit' ? 'Limit price' : buying ? 'Est. price (ask)' : 'Est. price (bid)';
  $('s-price').textContent = price ? `$${fmtPrice(m.symbol, price)}` : '—';
  $('s-fee-rate').textContent = `${(fee() * 100).toFixed(2)}%`;
  $('s-fee').textContent = fmtUSD(f);
  $('s-total-lbl').textContent = buying ? 'You pay' : 'You receive';
  $('s-total').textContent = fmtUSD(buying ? notional + f : notional - f);

  const q = store.quotes[state.symbol];
  const closed = q?.marketOpen === false;
  const note = $('closed-note');
  note.classList.toggle('hidden', !closed);
  if (closed) note.textContent = state.type === 'market'
    ? `${m.name} is closed right now. Switch to a limit order — it will fill when trading resumes.`
    : 'Market closed — this limit order will wait and fill when trading resumes.';

  const btn = $('submit');
  btn.className = `btn btn-lg submit ${state.side}`;
  btn.textContent = !state.user ? 'Log in to trade' : `${buying ? 'Buy' : 'Sell'} ${m.symbol}`;
  btn.disabled = !!state.user && closed && state.type === 'market';
}

function setPct(pct) {
  const m = store.bySymbol[state.symbol];
  const price = quotePrice();
  if (!price) return;
  const avail = available();
  const qty = state.side === 'buy' ? (avail * pct) / (price * (1 + fee())) : avail * pct;
  const f = 10 ** m.qtyDecimals;
  $('f-qty').value = qty > 0 ? Math.floor(qty * f) / f : '';
  updateForm('qty');
}

async function submitOrder(e) {
  e.preventDefault();
  if (!state.user) return requireLogin();
  const err = $('order-error');
  err.textContent = '';
  const qty = parseFloat($('f-qty').value);
  if (!(qty > 0)) { err.textContent = 'Enter an amount.'; return; }
  const body = { symbol: state.symbol, side: state.side, type: state.type, qty };
  if (state.type === 'limit') body.limitPrice = parseFloat($('f-limit').value);
  const btn = $('submit');
  btn.disabled = true;
  try {
    const o = await api('/orders', { method: 'POST', body });
    $('f-qty').value = '';
    $('f-total').value = '';
    if (o.status === 'filled') {
      toast(`${o.side === 'buy' ? 'Bought' : 'Sold'} ${fmtQty(o.symbol, o.qty)} ${o.symbol}`, `at $${fmtPrice(o.symbol, o.fillPrice)}`, 'ok');
    } else {
      toast('Limit order placed', `${o.side} ${fmtQty(o.symbol, o.qty)} ${o.symbol} @ $${fmtPrice(o.symbol, o.limitPrice)}`, 'info');
    }
    await refreshAccount();
  } catch (ex) {
    err.textContent = ex.message;
  } finally {
    btn.disabled = false;
    updateForm();
  }
}

// =============================================================== account
async function refreshAccount() {
  if (!state.user) return;
  const [p, open, filled, cancelled] = await Promise.all([
    api('/portfolio'), api('/orders?status=open'), api('/orders?status=filled&limit=100'), api('/orders?status=cancelled&limit=50'),
  ]);
  state.portfolio = p;
  state.openOrders = open;
  state.history = [...filled, ...cancelled].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 120);
  renderAccount();
  renderTab();
  renderOrderLines();
  updateForm();
}

/** Recompute portfolio values from live quotes without hitting the server. */
function revalue() {
  const p = state.portfolio;
  if (!p) return;
  p.holdingsValue = 0;
  for (const h of p.holdings) {
    const q = store.quotes[h.symbol];
    if (q?.price) h.price = q.price;
    h.value = h.qty * h.price;
    h.unrealizedPnl = (h.price - h.avgCost) * h.qty;
    h.unrealizedPct = h.avgCost ? ((h.price - h.avgCost) / h.avgCost) * 100 : 0;
    p.holdingsValue += h.value;
  }
  p.equity = p.cash + p.holdingsValue;
  p.totalPnl = p.equity - p.startingBalance;
  p.totalPnlPct = (p.totalPnl / p.startingBalance) * 100;
}

function renderAccount() {
  const p = state.portfolio;
  $('top-stats').classList.toggle('hidden', !p);
  if (!p) {
    for (const id of ['ts-equity', 'ts-cash', 'ts-pnl', 'ap-equity', 'ap-cash', 'ap-locked', 'ap-hold']) $(id).textContent = '—';
    $('ap-pnl').textContent = 'Log in to see your balance';
    $('ap-pnl').className = 'ap-pnl muted';
    $('alloc').innerHTML = '';
    return;
  }
  $('ts-equity').textContent = fmtUSD(p.equity);
  $('ts-cash').textContent = fmtUSD(p.cashAvailable);
  $('ts-pnl').textContent = `${fmtSignedUSD(p.totalPnl)}`;
  $('ts-pnl').className = `num ${dirClass(p.totalPnl)}`;
  $('ap-equity').textContent = fmtUSD(p.equity);
  $('ap-pnl').textContent = `${fmtSignedUSD(p.totalPnl)} (${fmtPct(p.totalPnlPct)}) all time`;
  $('ap-pnl').className = `ap-pnl num ${dirClass(p.totalPnl)}`;
  $('ap-cash').textContent = fmtUSD(p.cashAvailable);
  $('ap-locked').textContent = fmtUSD(p.cashLocked);
  $('ap-hold').textContent = fmtUSD(p.holdingsValue);

  const alloc = $('alloc');
  alloc.innerHTML = '';
  const parts = [{ v: p.cash, c: 'rgba(255,255,255,0.25)' }];
  const byCat = {};
  for (const h of p.holdings) byCat[h.category] = (byCat[h.category] || 0) + h.value;
  for (const [cat, v] of Object.entries(byCat)) parts.push({ v, c: CAT_COLORS[cat] || '#888' });
  for (const part of parts) {
    if (part.v <= 0) continue;
    const i = document.createElement('i');
    i.style.flex = String(part.v);
    i.style.background = part.c;
    alloc.append(i);
  }
}

// =============================================================== bottom tabs
function renderTab() {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === state.tab));
  $('cnt-positions').textContent = state.portfolio?.holdings.length || '';
  $('cnt-open').textContent = state.openOrders.length || '';
  const body = $('tab-body');

  if (!state.user) {
    body.innerHTML = '<div class="empty">Open a free demo account with $100,000 to start trading.<br><button class="btn btn-primary btn-sm" id="empty-login">Open demo account</button></div>';
    $('empty-login').onclick = requireLogin;
    return;
  }

  if (state.tab === 'positions') {
    const hs = state.portfolio?.holdings || [];
    if (!hs.length) { body.innerHTML = '<div class="empty">No positions yet. Place your first trade →</div>'; return; }
    body.innerHTML = `<table class="tbl"><thead><tr><th>Asset</th><th>Amount</th><th>Avg cost</th><th>Price</th><th>Value</th><th>P&amp;L</th><th></th></tr></thead><tbody></tbody></table>`;
    const tb = body.querySelector('tbody');
    for (const h of hs) {
      const tr = document.createElement('tr');
      tr.dataset.symbol = h.symbol;
      tr.innerHTML = `<td><span class="asset"></span></td><td class="num"></td><td class="num"></td><td class="num pp"></td><td class="num pv"></td><td class="num pl"></td><td><button class="link-btn">Close</button></td>`;
      const a = tr.querySelector('.asset');
      a.append(assetIcon(h.symbol, true), h.symbol);
      a.onclick = () => selectSymbol(h.symbol);
      tr.children[1].textContent = fmtQty(h.symbol, h.qty) + (h.locked > 0 ? ` (${fmtQty(h.symbol, h.locked)} in orders)` : '');
      tr.children[2].textContent = `$${fmtPrice(h.symbol, h.avgCost)}`;
      const btn = tr.querySelector('.link-btn');
      const free = h.qty - h.locked;
      if (free <= 0) btn.disabled = true;
      btn.onclick = () => closePosition(h.symbol, free, btn);
      tb.append(tr);
    }
    updatePositionsLive();
  } else if (state.tab === 'open') {
    if (!state.openOrders.length) { body.innerHTML = '<div class="empty">No open orders. Limit orders you place will appear here.</div>'; return; }
    body.innerHTML = `<table class="tbl"><thead><tr><th>Market</th><th>Side</th><th>Amount</th><th>Limit</th><th>Market price</th><th>Placed</th><th></th></tr></thead><tbody></tbody></table>`;
    const tb = body.querySelector('tbody');
    for (const o of state.openOrders) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td><span class="asset"></span></td><td></td><td class="num"></td><td class="num"></td><td class="num"></td><td class="muted"></td><td><button class="link-btn">Cancel</button></td>`;
      const a = tr.querySelector('.asset');
      a.append(assetIcon(o.symbol, true), o.symbol);
      a.onclick = () => selectSymbol(o.symbol);
      tr.children[1].innerHTML = `<span class="side-${o.side}">${o.side}</span>`;
      tr.children[2].textContent = fmtQty(o.symbol, o.qty);
      tr.children[3].textContent = `$${fmtPrice(o.symbol, o.limitPrice)}`;
      tr.children[4].textContent = `$${fmtPrice(o.symbol, store.quotes[o.symbol]?.price)}`;
      tr.children[5].textContent = new Date(o.createdAt).toLocaleString();
      tr.querySelector('.link-btn').onclick = async (ev) => {
        ev.target.disabled = true;
        try { await api(`/orders/${o.id}`, { method: 'DELETE' }); toast('Order cancelled', '', 'info'); await refreshAccount(); }
        catch (err) { toast('Could not cancel', err.message, 'err'); ev.target.disabled = false; }
      };
      tb.append(tr);
    }
  } else {
    if (!state.history.length) { body.innerHTML = '<div class="empty">No trades yet.</div>'; return; }
    body.innerHTML = `<table class="tbl"><thead><tr><th>Time</th><th>Market</th><th>Side</th><th>Type</th><th>Amount</th><th>Price</th><th>Fee</th><th>Realized P&amp;L</th><th>Status</th></tr></thead><tbody></tbody></table>`;
    const tb = body.querySelector('tbody');
    for (const o of state.history) {
      const tr = document.createElement('tr');
      const px = o.fillPrice ?? o.limitPrice;
      tr.innerHTML = `<td class="muted"></td><td></td><td><span class="side-${o.side}">${o.side}</span></td><td class="muted"></td><td class="num"></td><td class="num"></td><td class="num muted"></td><td class="num"></td><td class="muted"></td>`;
      tr.children[0].textContent = new Date(o.updatedAt).toLocaleString();
      tr.children[1].textContent = `${o.symbol}/USD`;
      tr.children[3].textContent = o.type;
      tr.children[4].textContent = fmtQty(o.symbol, o.qty);
      tr.children[5].textContent = `$${fmtPrice(o.symbol, px)}`;
      tr.children[6].textContent = o.status === 'filled' ? fmtUSD(o.fee) : '—';
      tr.children[7].textContent = o.realizedPnl != null ? fmtSignedUSD(o.realizedPnl) : '—';
      tr.children[7].className = `num ${dirClass(o.realizedPnl)}`;
      tr.children[8].textContent = o.status;
      tb.append(tr);
    }
  }
}

function updatePositionsLive() {
  if (state.tab !== 'positions' || !state.portfolio) return;
  for (const h of state.portfolio.holdings) {
    const tr = document.querySelector(`#tab-body tr[data-symbol="${h.symbol}"]`);
    if (!tr) continue;
    tr.querySelector('.pp').textContent = `$${fmtPrice(h.symbol, h.price)}`;
    tr.querySelector('.pv').textContent = fmtUSD(h.value);
    const pl = tr.querySelector('.pl');
    pl.textContent = `${fmtSignedUSD(h.unrealizedPnl)} (${fmtPct(h.unrealizedPct)})`;
    pl.className = `num pl ${dirClass(h.unrealizedPnl)}`;
  }
}

async function closePosition(symbol, qty, btn) {
  const q = store.quotes[symbol];
  if (q?.marketOpen === false) {
    toast('Market closed', 'Use a limit sell order to close this position when trading resumes.', 'err');
    return;
  }
  btn.disabled = true;
  try {
    const o = await api('/orders', { method: 'POST', body: { symbol, side: 'sell', type: 'market', qty } });
    toast(`Closed ${symbol}`, `Sold ${fmtQty(symbol, o.qty)} at $${fmtPrice(symbol, o.fillPrice)} · P&L ${fmtSignedUSD(o.realizedPnl)}`, 'ok');
    await refreshAccount();
  } catch (err) {
    toast('Could not close position', err.message, 'err');
    btn.disabled = false;
  }
}

// =============================================================== user
async function requireLogin() {
  if (await openAuth('signup')) {
    await initUser();
    connectLive(); // reconnect so the socket carries the new session
  }
}

async function initUser() {
  state.user = await currentUser();
  const box = $('top-user');
  box.innerHTML = '';
  if (state.user) {
    const av = document.createElement('span');
    av.className = 'avatar';
    av.textContent = state.user.name.slice(0, 1).toUpperCase();
    av.title = `${state.user.name} · ${state.user.email}`;
    const out = document.createElement('button');
    out.className = 'btn btn-ghost btn-sm hide-sm';
    out.textContent = 'Log out';
    out.onclick = async () => { await logout(); location.href = '/'; };
    box.append(av, out);
    await refreshAccount();
  } else {
    const b = document.createElement('button');
    b.className = 'btn btn-primary btn-sm';
    b.textContent = 'Start demo';
    b.onclick = requireLogin;
    box.append(b);
    state.portfolio = null;
    state.openOrders = [];
    renderAccount();
    renderTab();
    updateForm();
  }
}

// =============================================================== symbol selection
function selectSymbol(symbol) {
  if (!store.bySymbol[symbol]) return;
  state.symbol = symbol;
  safeStore('dsx.symbol', symbol);
  history.replaceState(null, '', `/trade?s=${symbol}`);
  document.querySelectorAll('.mp-item').forEach((el) => el.classList.toggle('active', el.dataset.symbol === symbol));
  $('f-limit').value = '';
  $('f-qty').value = '';
  $('f-total').value = '';
  $('order-error').textContent = '';
  if (state.type === 'limit') setType('limit');
  renderHeader();
  loadCandles();
  renderOrderLines();
  updateForm();
}

// =============================================================== boot
(async () => {
  await loadMarkets();
  initChart();
  renderCategoryPills();

  const fromUrl = new URLSearchParams(location.search).get('s');
  let saved = null;
  try { saved = localStorage.getItem('dsx.symbol'); } catch { /* ignore */ }
  state.symbol = [fromUrl, saved, 'BTC'].find((s) => s && store.bySymbol[s]);
  renderMarketList();
  selectSymbol(state.symbol);
  await initUser();
  connectLive();

  onQuotes((changes) => {
    for (const { q, prev } of changes) {
      updateMarketItem(q.symbol, prev);
      if (q.symbol === state.symbol) {
        updateHeader(prev);
        tickChart(q);
      }
    }
    if (state.portfolio) {
      revalue();
      renderAccount();
      updatePositionsLive();
    }
    if (state.type === 'market') updateForm();
  });

  onOrder(async (o) => {
    if (o.status === 'filled' && o.type === 'limit') {
      toast(`Limit order filled`, `${o.side === 'buy' ? 'Bought' : 'Sold'} ${fmtQty(o.symbol, o.qty)} ${o.symbol} at $${fmtPrice(o.symbol, o.fillPrice)}`, 'ok');
    }
    await refreshAccount();
  });

  // events
  $('search').addEventListener('input', (e) => { state.search = e.target.value; renderMarketList(); });
  $('sym-switch').onclick = openDrawer;
  $('mp-close').onclick = closeDrawer;
  $('scrim').onclick = closeDrawer;
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });
  document.querySelectorAll('.side-seg button').forEach((b) => { b.onclick = () => setSide(b.dataset.side); });
  document.querySelectorAll('.type-tabs button').forEach((b) => { b.onclick = () => setType(b.dataset.type); });
  document.querySelectorAll('.tab').forEach((t) => { t.onclick = () => { state.tab = t.dataset.tab; renderTab(); }; });
  $('pct-row').addEventListener('click', (e) => { const p = e.target.dataset.pct; if (p) setPct(+p); });
  $('f-qty').addEventListener('input', () => updateForm('qty'));
  $('f-total').addEventListener('input', () => updateForm('total'));
  $('f-limit').addEventListener('input', () => updateForm('qty'));
  $('order-form').addEventListener('submit', submitOrder);
  $('reset-btn').onclick = async () => {
    if (!state.user) return requireLogin();
    if (!confirm('Reset your demo account? This clears all positions and orders and restores $100,000.')) return;
    await api('/account/reset', { method: 'POST' });
    toast('Demo account reset', 'Balance restored to $100,000.', 'info');
    await refreshAccount();
  };
})();
