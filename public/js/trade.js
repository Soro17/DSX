import {
  api, store, loadMarkets, connectLive, onQuotes, onAccount, openAuth, currentUser, logout, toast,
  fmtPrice, fmtUSD, fmtSignedUSD, fmtPct, fmtQty, fmtCompact, dirClass, assetIcon, flash,
} from './common.js';

const $ = (id) => document.getElementById(id);
const TFS = ['1m', '5m', '15m', '1h', '1d'];
const TF_SEC = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '1d': 86400 };
const TZ_SHIFT = -new Date().getTimezoneOffset() * 60; // chart shows local time
const REASON = { manual: 'Closed', take_profit: 'Take profit', stop_loss: 'Stop loss', liquidation: 'Liquidated' };

const ls = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
};
const num = (v) => { const n = parseFloat(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : NaN; };

const state = {
  symbol: null,
  tf: ls.get('ag.tf', '15m'),
  side: 'long',
  type: 'market',
  unit: 'margin',
  leverage: Number(ls.get('ag.lev', 10)) || 10,
  category: 'all',
  search: '',
  tab: 'positions',
  maOn: ls.get('ag.ma', '1') === '1',
  linesOn: ls.get('ag.lines', '1') === '1',
  user: null,
  account: null,
  openOrders: [],
  closed: [],
  history: [],
};

// =============================================================== markets list
function renderCategoryPills() {
  $('cat-pills').replaceChildren(...[{ id: 'all', label: 'All' }, ...store.categories].map((c) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `pill${c.id === 'solana' ? ' sol' : ''}${state.category === c.id ? ' active' : ''}`;
    b.textContent = c.label;
    b.onclick = () => { state.category = c.id; renderCategoryPills(); renderMarketList(); };
    return b;
  }));
}

function renderMarketList() {
  const list = $('mp-list');
  const term = state.search.trim().toLowerCase();
  const items = store.markets.filter((m) => (state.category === 'all' || m.category === state.category)
    && (!term || m.symbol.toLowerCase().includes(term) || m.name.toLowerCase().includes(term)));
  if (!items.length) { list.innerHTML = '<div class="empty">No markets match.</div>'; return; }
  list.replaceChildren(...items.map((m) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `mp-item${m.symbol === state.symbol ? ' active' : ''}`;
    b.dataset.symbol = m.symbol;
    b.append(assetIcon(m.symbol, 'sm'));
    b.insertAdjacentHTML('beforeend', '<span class="info"><div class="sym"></div><div class="nm"></div></span><span class="px num"><div class="p"></div><div class="c"></div></span>');
    b.querySelector('.sym').textContent = m.symbol;
    b.querySelector('.nm').textContent = m.name;
    b.onclick = () => { selectSymbol(m.symbol); closeDrawer(); };
    return b;
  }));
  items.forEach((m) => updateMarketItem(m.symbol));
}

function updateMarketItem(symbol, prev) {
  const el = document.querySelector(`.mp-item[data-symbol="${symbol}"]`);
  const q = store.quotes[symbol];
  if (!el || !q) return;
  const p = el.querySelector('.p');
  p.textContent = fmtPrice(symbol, q.price);
  if (q.marketOpen === false) p.insertAdjacentHTML('beforeend', '<span class="closed-dot" title="Market closed"></span>');
  flash(p, prev?.price, q.price);
  const c = el.querySelector('.c');
  c.textContent = fmtPct(q.changePct);
  c.className = `c ${dirClass(q.changePct)}`;
}

function openDrawer() { $('markets-panel').classList.add('open'); $('scrim').classList.remove('hidden'); $('search').focus(); }
function closeDrawer() { $('markets-panel').classList.remove('open'); $('scrim').classList.add('hidden'); }

// =============================================================== header
function renderHeader() {
  const m = store.bySymbol[state.symbol];
  $('mh-ic').replaceChildren(assetIcon(m.symbol, 'lg'));
  $('mh-name').textContent = m.name;
  $('mh-sym').textContent = `${m.symbol}/USD${m.unit ? ` · per ${m.unit}` : ''} · ${store.categories.find((c) => c.id === m.category)?.label}`;
  $('mh-maxlev').textContent = `Up to ${store.trading.maxLeverage}x`;
  $('sym-switch-ic').replaceChildren(assetIcon(m.symbol, 'sm'));
  $('sym-switch-label').textContent = `${m.symbol}/USD`;
  $('unit-qty').textContent = `Qty ${m.symbol}`;
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
  chg.textContent = `${q.change >= 0 ? '+' : ''}${fmtPrice(s, q.change)} (${fmtPct(q.changePct)})`;
  chg.className = `chg num ${dirClass(q.changePct)}`;
  $('mh-high').textContent = fmtPrice(s, q.high);
  $('mh-low').textContent = fmtPrice(s, q.low);
  $('mh-vol').textContent = q.volume ? `${fmtCompact(q.volume)} ${s}` : '—';
  $('mh-spread').textContent = q.bid ? `${fmtPrice(s, q.bid)} / ${fmtPrice(s, q.ask)}` : 'Last price';
  const st = $('mh-status');
  const open = q.marketOpen !== false;
  st.className = `badge ${open ? 'live' : 'closed'}`;
  st.textContent = open ? 'Live' : 'Closed';
  document.title = `${fmtPrice(s, q.price)} ${s}/USD — AG Exchange`;
}

// =============================================================== chart
let chart, candleSeries, volumeSeries, ma7, ma25, candles = [], chartReq = 0;
let priceLines = [];

function initChart() {
  chart = LightweightCharts.createChart($('chart'), {
    autoSize: true,
    layout: { background: { type: 'solid', color: 'transparent' }, textColor: '#8b92a8', fontFamily: 'JetBrains Mono, monospace', fontSize: 11 },
    grid: { vertLines: { color: 'rgba(255,255,255,0.03)' }, horzLines: { color: 'rgba(255,255,255,0.03)' } },
    rightPriceScale: { borderColor: 'rgba(255,255,255,0.07)' },
    timeScale: { borderColor: 'rgba(255,255,255,0.07)', timeVisible: true, secondsVisible: false, rightOffset: 8 },
    crosshair: {
      mode: LightweightCharts.CrosshairMode.Normal,
      vertLine: { color: 'rgba(155,123,255,0.4)', labelBackgroundColor: '#211a45' },
      horzLine: { color: 'rgba(155,123,255,0.4)', labelBackgroundColor: '#211a45' },
    },
  });
  candleSeries = chart.addCandlestickSeries({ upColor: '#16c784', downColor: '#f6465d', borderVisible: false, wickUpColor: '#16c784', wickDownColor: '#f6465d' });
  volumeSeries = chart.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: 'vol', lastValueVisible: false, priceLineVisible: false });
  chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });
  const maOpts = { lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false };
  ma7 = chart.addLineSeries({ ...maOpts, color: '#f5b94a' });
  ma25 = chart.addLineSeries({ ...maOpts, color: '#c069ff' });

  $('tf-pills').replaceChildren(...TFS.map((tf) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `pill${tf === state.tf ? ' active' : ''}`;
    b.textContent = tf;
    b.dataset.tf = tf;
    b.onclick = () => {
      state.tf = tf;
      ls.set('ag.tf', tf);
      document.querySelectorAll('#tf-pills .pill').forEach((p) => p.classList.toggle('active', p.dataset.tf === tf));
      loadCandles();
    };
    return b;
  }));

  $('ma-toggle').checked = state.maOn;
  $('lines-toggle').checked = state.linesOn;
  $('ma-toggle').onchange = (e) => { state.maOn = e.target.checked; ls.set('ag.ma', state.maOn ? '1' : '0'); renderMA(); };
  $('lines-toggle').onchange = (e) => { state.linesOn = e.target.checked; ls.set('ag.lines', state.linesOn ? '1' : '0'); renderPriceLines(); };
}

function chartMessage(text) {
  let msg = document.querySelector('.chart-msg');
  if (!text) { msg?.remove(); return; }
  if (!msg) { msg = document.createElement('div'); msg.className = 'chart-msg'; $('chart').append(msg); }
  msg.textContent = text;
}

function sma(data, n) {
  const out = [];
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum += data[i].close;
    if (i >= n) sum -= data[i - n].close;
    if (i >= n - 1) out.push({ time: data[i].time, value: sum / n });
  }
  return out;
}

function renderMA() {
  const a = state.maOn ? sma(candles, 7) : [];
  const b = state.maOn ? sma(candles, 25) : [];
  ma7.setData(a);
  ma25.setData(b);
  const legend = $('ma-legend');
  if (!state.maOn || !a.length) { legend.innerHTML = ''; return; }
  const s = state.symbol;
  legend.innerHTML = `<span class="m7">MA7 ${fmtPrice(s, a[a.length - 1].value)}</span>${b.length ? `<span class="m25">MA25 ${fmtPrice(s, b[b.length - 1].value)}</span>` : ''}`;
}

async function loadCandles() {
  const req = ++chartReq;
  const m = store.bySymbol[state.symbol];
  const priceFormat = { type: 'price', precision: m.priceDecimals, minMove: 10 ** -m.priceDecimals };
  candleSeries.applyOptions({ priceFormat });
  ma7.applyOptions({ priceFormat });
  ma25.applyOptions({ priceFormat });
  chartMessage('Loading chart…');
  try {
    const data = await api(`/candles/${state.symbol}?tf=${state.tf}`);
    if (req !== chartReq) return;
    candles = data.map((c) => ({ ...c, time: c.time + TZ_SHIFT }));
    candleSeries.setData(candles);
    volumeSeries.setData(candles.map((c) => ({ time: c.time, value: c.volume, color: c.close >= c.open ? 'rgba(22,199,132,0.25)' : 'rgba(246,70,93,0.25)' })));
    renderMA();
    chart.timeScale().fitContent();
    chart.timeScale().scrollToRealTime();
    chartMessage(candles.length ? '' : 'No chart data for this timeframe.');
    const live = m.source === 'coinbase' || m.category === 'forex';
    $('chart-note').textContent = live ? 'Real-time data' : 'Data may be delayed';
  } catch (err) {
    if (req === chartReq) chartMessage(`Chart unavailable: ${err.message}`);
  }
}

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
  if (state.maOn) {
    const n = candles.length;
    for (const [series, len] of [[ma7, 7], [ma25, 25]]) {
      if (n < len) continue;
      const v = candles.slice(n - len).reduce((s, x) => s + x.close, 0) / len;
      series.update({ time: c.time, value: v });
    }
  }
}

function renderPriceLines() {
  for (const l of priceLines) candleSeries.removePriceLine(l);
  priceLines = [];
  if (!state.linesOn) return;
  const add = (price, color, title, style = LightweightCharts.LineStyle.Dashed) => {
    if (price == null) return;
    priceLines.push(candleSeries.createPriceLine({ price, color, lineWidth: 1, lineStyle: style, axisLabelVisible: true, title }));
  };
  for (const p of state.account?.positions || []) {
    if (p.symbol !== state.symbol) continue;
    const tag = `${p.side === 'long' ? 'L' : 'S'} ${p.leverage}x`;
    add(p.entryPrice, '#c9cfe0', `${tag} entry`, LightweightCharts.LineStyle.Solid);
    add(p.liqPrice, '#f5b94a', `${tag} liq`);
    add(p.tp, '#16c784', `${tag} TP`);
    add(p.sl, '#f6465d', `${tag} SL`);
  }
  for (const o of state.openOrders) {
    if (o.symbol !== state.symbol) continue;
    add(o.limitPrice, '#4f7bff', `${o.side === 'long' ? 'Buy' : 'Sell'} limit ${o.leverage}x`, LightweightCharts.LineStyle.Dotted);
  }
}

// =============================================================== leverage
function setLeverage(v, persist = true) {
  const max = store.trading.maxLeverage;
  let lev = Math.round(num(v));
  if (!Number.isFinite(lev)) lev = state.leverage;
  lev = Math.min(max, Math.max(1, lev));
  state.leverage = lev;
  if (persist) ls.set('ag.lev', String(lev));
  $('lev-input').value = `${lev}x`;
  $('lev-range').value = lev;
  $('lev-range').style.setProperty('--fill', `${((lev - 1) / (max - 1)) * 100}%`);
  document.querySelectorAll('#lev-quick button').forEach((b) => b.classList.toggle('active', Number(b.dataset.lev) === lev));
  const warn = lev >= 10;
  $('lev-warn').classList.toggle('hidden', !warn);
  if (warn) $('lev-warn-pct').textContent = `${((1 / lev - store.trading.maintMarginRate) * 100).toFixed(1)}%`;
  updateForm();
}

// =============================================================== order form
function refPrice() {
  const q = store.quotes[state.symbol];
  if (!q?.price) return null;
  if (state.type === 'limit') { const lp = num($('f-limit').value); return lp > 0 ? lp : null; }
  return state.side === 'long' ? (q.ask || q.price) : (q.bid || q.price);
}

function available() { return state.account?.available ?? 0; }

function maxMargin() {
  return available() / (1 + state.leverage * store.trading.feeRate);
}

/** Quantity implied by the amount box. */
function orderQty(price) {
  const amt = num($('f-amount').value);
  if (!(amt > 0) || !price) return 0;
  return state.unit === 'margin' ? (amt * state.leverage) / price : amt;
}

function liqFor(side, entry, lev) {
  const mmr = store.trading.maintMarginRate;
  return side === 'long' ? entry * (1 - 1 / lev + mmr) : entry * (1 + 1 / lev - mmr);
}

function updateForm() {
  if (!state.symbol) return;
  const m = store.bySymbol[state.symbol];
  const s = m.symbol;
  const price = refPrice();
  const qty = orderQty(price);
  const notional = price ? qty * price : 0;
  const margin = notional / state.leverage;
  const fee = notional * store.trading.feeRate;
  const long = state.side === 'long';

  $('s-avail').textContent = state.account ? fmtUSD(available()) : '—';
  $('s-entry-lbl').textContent = state.type === 'limit' ? 'Entry (limit)' : `Entry (est. ${long ? 'ask' : 'bid'})`;
  $('s-entry').textContent = price ? `$${fmtPrice(s, price)}` : '—';
  $('s-size').textContent = notional ? fmtUSD(notional) : '—';
  $('s-qty').textContent = qty ? `${fmtQty(s, qty)} ${s}` : '—';
  $('s-margin').textContent = notional ? fmtUSD(margin) : '—';
  $('s-fee-rate').textContent = `${(store.trading.feeRate * 100).toFixed(2)}%`;
  $('s-fee').textContent = notional ? fmtUSD(fee) : '—';
  $('s-liq').textContent = price ? `$${fmtPrice(s, liqFor(state.side, price, state.leverage))}` : '—';
  $('s-max').textContent = state.account ? fmtUSD(maxMargin() * state.leverage, 0) : '—';
  $('f-amount-suffix').textContent = state.unit === 'margin' ? 'USD' : s;

  // TP / SL estimates
  const est = (target) => {
    if (!(target > 0) || !qty || !price) return '';
    const pnl = (long ? target - price : price - target) * qty;
    return `${fmtSignedUSD(pnl)} (${fmtPct((pnl / margin) * 100, 1)})`;
  };
  $('tp-est').textContent = est(num($('f-tp').value));
  $('sl-est').textContent = est(num($('f-sl').value));

  const q = store.quotes[s];
  const closed = q?.marketOpen === false;
  $('closed-note').classList.toggle('hidden', !closed);
  if (closed) {
    $('closed-note').textContent = state.type === 'market'
      ? `${m.name} is closed right now. Switch to a limit order — it fills when trading resumes.`
      : 'Market closed — this limit order will wait and fill when trading resumes.';
  }

  const btn = $('submit');
  btn.className = `btn btn-lg btn-block submit ${state.side}`;
  btn.textContent = !state.user ? 'Log in to trade' : `${long ? 'Open Long' : 'Open Short'} · ${state.leverage}x`;
  btn.disabled = !!state.user && closed && state.type === 'market';
}

function setSide(side) {
  state.side = side;
  document.querySelectorAll('.side-seg button').forEach((b) => b.classList.toggle('active', b.dataset.side === side));
  updateForm();
}

function setType(type) {
  state.type = type;
  document.querySelectorAll('.type-tabs button').forEach((b) => b.classList.toggle('active', b.dataset.type === type));
  document.querySelector('.limit-only').classList.toggle('hidden', type !== 'limit');
  if (type === 'limit' && !$('f-limit').value) useLastPrice();
  updateForm();
}

function setUnit(unit) {
  if (unit === state.unit) return;
  const price = refPrice();
  const qty = orderQty(price);
  state.unit = unit;
  document.querySelectorAll('.unit-toggle button').forEach((b) => b.classList.toggle('active', b.dataset.unit === unit));
  const m = store.bySymbol[state.symbol];
  if (qty && price) {
    $('f-amount').value = unit === 'margin' ? ((qty * price) / state.leverage).toFixed(2) : +qty.toFixed(m.qtyDecimals);
  }
  updateForm();
}

function useLastPrice() {
  const q = store.quotes[state.symbol];
  if (q?.price) $('f-limit').value = q.price.toFixed(store.bySymbol[state.symbol].priceDecimals);
  updateForm();
}

function setPct(pct) {
  if (!state.user) { requireLogin(); return; }
  const price = refPrice();
  if (!price) return;
  const margin = Math.floor(maxMargin() * pct * 100) / 100;
  const m = store.bySymbol[state.symbol];
  if (state.unit === 'margin') $('f-amount').value = margin > 0 ? margin.toFixed(2) : '';
  else {
    const f = 10 ** m.qtyDecimals;
    const qty = Math.floor(((margin * state.leverage) / price) * f) / f;
    $('f-amount').value = qty > 0 ? qty : '';
  }
  updateForm();
}

async function submitOrder(e) {
  e.preventDefault();
  if (!state.user) { requireLogin(); return; }
  const err = $('order-error');
  err.textContent = '';
  const price = refPrice();
  const m = store.bySymbol[state.symbol];
  const qty = Math.floor(orderQty(price) * 10 ** m.qtyDecimals) / 10 ** m.qtyDecimals;
  if (!(qty > 0)) { err.textContent = 'Enter an amount.'; return; }
  const body = { symbol: state.symbol, side: state.side, type: state.type, qty, leverage: state.leverage };
  if (state.type === 'limit') body.limitPrice = num($('f-limit').value);
  if ($('tpsl-toggle').checked) {
    const tp = num($('f-tp').value);
    const sl = num($('f-sl').value);
    if (tp > 0) body.tp = tp;
    if (sl > 0) body.sl = sl;
  }
  const btn = $('submit');
  btn.disabled = true;
  try {
    const { order, position } = await api('/orders', { method: 'POST', body });
    $('f-amount').value = '';
    $('f-tp').value = '';
    $('f-sl').value = '';
    state.tab = position ? 'positions' : 'orders';
    if (position) {
      toast(`${position.side === 'long' ? 'Long' : 'Short'} ${position.leverage}x opened`,
        `${fmtQty(position.symbol, position.qty)} ${position.symbol} at $${fmtPrice(position.symbol, position.entryPrice)} · liq. $${fmtPrice(position.symbol, position.liqPrice)}`, 'ok');
    } else {
      toast('Limit order placed', `${order.side} ${order.leverage}x · ${fmtQty(order.symbol, order.qty)} ${order.symbol} @ $${fmtPrice(order.symbol, order.limitPrice)}`, 'info');
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
  try {
    const [acct, open, closed, filled, cancelled] = await Promise.all([
      api('/account'), api('/orders?status=open'), api('/positions?status=closed&limit=100'),
      api('/orders?status=filled&limit=100'), api('/orders?status=cancelled&limit=50'),
    ]);
    state.account = acct;
    state.openOrders = open;
    state.closed = closed;
    state.history = [...filled, ...cancelled].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 120);
  } catch (err) {
    if (err.status === 401) { state.user = null; await initUser(); return; }
    toast('Could not refresh account', err.message, 'err');
  }
  renderAccount();
  renderTab();
  renderPriceLines();
  updateForm();
}

/** Recompute PnL/equity from live quotes between server refreshes. */
function revalue() {
  const a = state.account;
  if (!a) return;
  a.unrealizedPnl = 0;
  a.exposure = 0;
  for (const p of a.positions) {
    const q = store.quotes[p.symbol];
    if (q?.price) p.markPrice = q.price;
    p.unrealizedPnl = (p.side === 'long' ? p.markPrice - p.entryPrice : p.entryPrice - p.markPrice) * p.qty;
    p.roe = (p.unrealizedPnl / p.margin) * 100;
    p.notional = p.qty * p.markPrice;
    a.unrealizedPnl += p.unrealizedPnl;
    a.exposure += p.notional;
  }
  a.equity = a.wallet + a.marginUsed + a.unrealizedPnl;
  a.effectiveLeverage = a.equity > 0 ? a.exposure / a.equity : 0;
  a.totalPnl = a.equity - a.startingBalance;
  a.totalPnlPct = (a.totalPnl / a.startingBalance) * 100;
}

function setSigned(el, v, text) {
  el.textContent = text ?? fmtSignedUSD(v);
  el.classList.remove('up', 'down');
  const d = dirClass(v);
  if (d) el.classList.add(d);
}

function renderAccount() {
  const a = state.account;
  $('top-stats').classList.toggle('hidden', !a);
  if (!a) {
    for (const id of ['ap-equity', 'ap-avail', 'ap-margin', 'ap-orders', 'ap-upnl', 'ap-rpnl', 'ap-exposure', 'ap-win']) $(id).textContent = '—';
    $('ap-pnl').textContent = 'Log in to see your balance';
    $('ap-pnl').className = 'ap-pnl muted';
    $('ap-margin-bar').style.width = '0';
    return;
  }
  $('ts-equity').textContent = fmtUSD(a.equity);
  $('ts-avail').textContent = fmtUSD(a.available);
  setSigned($('ts-upnl'), a.unrealizedPnl);
  $('ap-equity').textContent = fmtUSD(a.equity);
  setSigned($('ap-pnl'), a.totalPnl, `${fmtSignedUSD(a.totalPnl)} (${fmtPct(a.totalPnlPct)}) all time`);
  $('ap-avail').textContent = fmtUSD(a.available);
  $('ap-margin').textContent = fmtUSD(a.marginUsed);
  $('ap-orders').textContent = fmtUSD(a.inOrders);
  setSigned($('ap-upnl'), a.unrealizedPnl);
  setSigned($('ap-rpnl'), a.realizedPnl);
  $('ap-exposure').textContent = `${fmtUSD(a.exposure, 0)} · ${a.effectiveLeverage.toFixed(2)}x`;
  $('ap-win').textContent = a.closedTrades ? `${a.closedTrades} · ${a.winRate.toFixed(0)}%` : '0';
  $('ap-margin-bar').style.width = `${Math.min(100, a.equity > 0 ? ((a.marginUsed + a.inOrders) / a.equity) * 100 : 0)}%`;
}

// =============================================================== bottom tabs
function cell(tr, label, html, cls = '') {
  const td = document.createElement('td');
  td.dataset.label = label;
  if (cls) td.className = cls;
  if (html instanceof Node) td.append(html); else td.innerHTML = html;
  tr.append(td);
  return td;
}
function marketCell(symbol, side, lev) {
  const wrap = document.createElement('span');
  wrap.className = 'mkt';
  wrap.append(assetIcon(symbol, 'sm'));
  const b = document.createElement('b');
  b.textContent = symbol;
  wrap.append(b);
  if (side) wrap.insertAdjacentHTML('beforeend', `<span class="badge ${side}">${side} ${lev}x</span>`);
  wrap.onclick = () => selectSymbol(symbol);
  return wrap;
}
function table(headers) {
  const t = document.createElement('table');
  t.className = 'tbl';
  t.innerHTML = `<thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody></tbody>`;
  return t;
}
function empty(text, withLogin = false) {
  const d = document.createElement('div');
  d.className = 'empty';
  d.textContent = text;
  if (withLogin) {
    d.append(document.createElement('br'));
    const b = document.createElement('button');
    b.className = 'btn btn-primary btn-sm';
    b.textContent = 'Open demo account';
    b.onclick = requireLogin;
    d.append(b);
  }
  return d;
}

function renderTab() {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === state.tab));
  const positions = state.account?.positions || [];
  $('cnt-positions').textContent = positions.length || '';
  $('cnt-orders').textContent = state.openOrders.length || '';
  $('close-all').classList.toggle('hidden', !(state.tab === 'positions' && positions.length > 1));
  const body = $('tab-body');

  if (!state.user) { body.replaceChildren(empty('Open a free demo account with $100,000 to start trading.', true)); return; }

  if (state.tab === 'positions') {
    if (!positions.length) { body.replaceChildren(empty('No open positions. Choose Long or Short, set leverage and place your first trade.')); return; }
    const t = table(['Market', 'Size', 'Entry', 'Mark', 'Liq. price', 'Margin', 'PnL (ROE)', 'TP / SL', '']);
    const tb = t.querySelector('tbody');
    for (const p of positions) {
      const tr = document.createElement('tr');
      tr.dataset.id = p.id;
      cell(tr, 'Market', marketCell(p.symbol, p.side, p.leverage));
      cell(tr, 'Size', `<span class="num">${fmtQty(p.symbol, p.qty)} ${p.symbol}</span><span class="sub num p-notional"></span>`);
      cell(tr, 'Entry', `<span class="num">${fmtPrice(p.symbol, p.entryPrice)}</span>`);
      cell(tr, 'Mark', '<span class="num p-mark"></span>');
      cell(tr, 'Liq. price', `<span class="num liq">${fmtPrice(p.symbol, p.liqPrice)}</span>`);
      cell(tr, 'Margin', `<span class="num">${fmtUSD(p.margin)}</span>`);
      cell(tr, 'PnL (ROE)', '<span class="num p-pnl"></span><span class="sub num p-roe"></span>');
      const tpsl = document.createElement('span');
      tpsl.className = 'tpsl-cell';
      tpsl.innerHTML = `<span class="v num"><span class="up">${p.tp != null ? fmtPrice(p.symbol, p.tp) : '—'}</span><span class="down">${p.sl != null ? fmtPrice(p.symbol, p.sl) : '—'}</span></span>`;
      const edit = document.createElement('button');
      edit.className = 'icon-btn';
      edit.type = 'button';
      edit.title = 'Edit take profit / stop loss';
      edit.setAttribute('aria-label', `Edit TP/SL for ${p.symbol}`);
      edit.textContent = '✎';
      edit.onclick = () => openTpSlModal(p);
      tpsl.append(edit);
      cell(tr, 'TP / SL', tpsl);
      const close = document.createElement('button');
      close.className = 'btn btn-xs';
      close.type = 'button';
      close.textContent = 'Close';
      close.onclick = () => closePosition(p, close);
      cell(tr, '', close, 'acts-cell');
      tb.append(tr);
    }
    body.replaceChildren(t);
    updatePositionsLive();
  } else if (state.tab === 'orders') {
    if (!state.openOrders.length) { body.replaceChildren(empty('No open orders. Limit orders wait here until the market reaches your price.')); return; }
    const t = table(['Market', 'Type', 'Amount', 'Limit price', 'Market price', 'Margin reserved', 'TP / SL', 'Placed', '']);
    const tb = t.querySelector('tbody');
    for (const o of state.openOrders) {
      const tr = document.createElement('tr');
      cell(tr, 'Market', marketCell(o.symbol, o.side, o.leverage));
      cell(tr, 'Type', 'Limit');
      cell(tr, 'Amount', `<span class="num">${fmtQty(o.symbol, o.qty)} ${o.symbol}</span>`);
      cell(tr, 'Limit price', `<span class="num">${fmtPrice(o.symbol, o.limitPrice)}</span>`);
      cell(tr, 'Market price', `<span class="num">${fmtPrice(o.symbol, store.quotes[o.symbol]?.price)}</span>`);
      cell(tr, 'Margin reserved', `<span class="num">${fmtUSD(o.reserved)}</span>`);
      cell(tr, 'TP / SL', `<span class="num"><span class="up">${o.tp != null ? fmtPrice(o.symbol, o.tp) : '—'}</span> / <span class="down">${o.sl != null ? fmtPrice(o.symbol, o.sl) : '—'}</span></span>`);
      cell(tr, 'Placed', `<span class="muted">${new Date(o.createdAt).toLocaleString()}</span>`);
      const cancel = document.createElement('button');
      cancel.className = 'btn btn-xs';
      cancel.type = 'button';
      cancel.textContent = 'Cancel';
      cancel.onclick = async () => {
        cancel.disabled = true;
        try { await api(`/orders/${o.id}`, { method: 'DELETE' }); toast('Order cancelled', 'Reserved margin released.', 'info'); await refreshAccount(); }
        catch (err) { toast('Could not cancel', err.message, 'err'); cancel.disabled = false; }
      };
      cell(tr, '', cancel, 'acts-cell');
      tb.append(tr);
    }
    body.replaceChildren(t);
  } else if (state.tab === 'closed') {
    if (!state.closed.length) { body.replaceChildren(empty('No closed positions yet.')); return; }
    const t = table(['Market', 'Size', 'Entry', 'Exit', 'Margin', 'Realized PnL', 'Result', 'Closed']);
    const tb = t.querySelector('tbody');
    for (const p of state.closed) {
      const tr = document.createElement('tr');
      cell(tr, 'Market', marketCell(p.symbol, p.side, p.leverage));
      cell(tr, 'Size', `<span class="num">${fmtQty(p.symbol, p.qty)} ${p.symbol}</span>`);
      cell(tr, 'Entry', `<span class="num">${fmtPrice(p.symbol, p.entryPrice)}</span>`);
      cell(tr, 'Exit', `<span class="num">${fmtPrice(p.symbol, p.closePrice)}</span>`);
      cell(tr, 'Margin', `<span class="num">${fmtUSD(p.margin)}</span>`);
      cell(tr, 'Realized PnL', `<span class="num ${dirClass(p.realizedPnl)}">${fmtSignedUSD(p.realizedPnl)}</span><span class="sub num">${fmtPct(p.realizedRoe, 1)}</span>`);
      cell(tr, 'Result', `<span class="reason ${p.closeReason}">${REASON[p.closeReason] || p.closeReason}</span>`);
      cell(tr, 'Closed', `<span class="muted">${new Date(p.closedAt).toLocaleString()}</span>`);
      tb.append(tr);
    }
    body.replaceChildren(t);
  } else {
    if (!state.history.length) { body.replaceChildren(empty('No orders yet.')); return; }
    const t = table(['Time', 'Market', 'Type', 'Amount', 'Price', 'Fee', 'Status']);
    const tb = t.querySelector('tbody');
    for (const o of state.history) {
      const tr = document.createElement('tr');
      cell(tr, 'Time', `<span class="muted">${new Date(o.updatedAt).toLocaleString()}</span>`);
      cell(tr, 'Market', marketCell(o.symbol, o.side, o.leverage));
      cell(tr, 'Type', `<span class="muted">${o.type}</span>`);
      cell(tr, 'Amount', `<span class="num">${fmtQty(o.symbol, o.qty)} ${o.symbol}</span>`);
      cell(tr, 'Price', `<span class="num">${fmtPrice(o.symbol, o.fillPrice ?? o.limitPrice)}</span>`);
      cell(tr, 'Fee', `<span class="num muted">${o.status === 'filled' ? fmtUSD(o.fee) : '—'}</span>`);
      cell(tr, 'Status', `<span class="reason${o.status === 'filled' ? ' take_profit' : ''}">${o.status}</span>`);
      tb.append(tr);
    }
    body.replaceChildren(t);
  }
}

function updatePositionsLive() {
  if (state.tab !== 'positions' || !state.account) return;
  for (const p of state.account.positions) {
    const tr = document.querySelector(`#tab-body tr[data-id="${p.id}"]`);
    if (!tr) continue;
    tr.querySelector('.p-mark').textContent = fmtPrice(p.symbol, p.markPrice);
    tr.querySelector('.p-notional').textContent = fmtUSD(p.notional);
    const pnl = tr.querySelector('.p-pnl');
    pnl.textContent = fmtSignedUSD(p.unrealizedPnl);
    pnl.className = `num p-pnl ${dirClass(p.unrealizedPnl)}`;
    const roe = tr.querySelector('.p-roe');
    roe.textContent = fmtPct(p.roe, 2);
    roe.className = `sub num p-roe ${dirClass(p.roe)}`;
  }
}

async function closePosition(p, btn) {
  btn.disabled = true;
  try {
    const c = await api(`/positions/${p.id}/close`, { method: 'POST' });
    toast(`${c.symbol} ${c.side} closed`, `Exit $${fmtPrice(c.symbol, c.closePrice)} · PnL ${fmtSignedUSD(c.realizedPnl)}`, c.realizedPnl >= 0 ? 'ok' : 'warn');
    await refreshAccount();
  } catch (err) {
    toast('Could not close position', err.message, 'err');
    btn.disabled = false;
  }
}

// =============================================================== modals
function modal(html, cls = '') {
  const back = document.createElement('div');
  back.className = 'modal-backdrop';
  back.innerHTML = `<div class="modal card ${cls}" role="dialog" aria-modal="true"><button class="close" type="button" aria-label="Close">×</button>${html}</div>`;
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  back.querySelector('.close').onclick = close;
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
  document.addEventListener('keydown', onKey);
  document.body.append(back);
  return { el: back, close };
}

function confirmModal(title, text, okLabel, danger = false) {
  return new Promise((resolve) => {
    const { el, close } = modal(`<h2></h2><p class="lead"></p><div class="tpsl-modal"><div class="actions"><button class="btn btn-lg" type="button" data-r="0">Cancel</button><button class="btn btn-lg ${danger ? 'btn-down' : 'btn-primary'}" type="button" data-r="1"></button></div></div>`);
    el.querySelector('h2').textContent = title;
    el.querySelector('.lead').textContent = text;
    el.querySelector('[data-r="1"]').textContent = okLabel;
    let done = false;
    el.addEventListener('click', (e) => {
      const r = e.target.closest('[data-r]');
      if (!r) return;
      done = true;
      close();
      resolve(r.dataset.r === '1');
    });
    new MutationObserver((_, obs) => { if (!el.isConnected) { obs.disconnect(); if (!done) resolve(false); } }).observe(document.body, { childList: true });
    el.querySelector('[data-r="1"]').focus();
  });
}

function openTpSlModal(p) {
  const s = p.symbol;
  const { el, close } = modal(`
    <h2>Take profit / Stop loss</h2>
    <p class="lead"></p>
    <div class="tpsl-modal">
      <div class="pos-sum"><div><span>Entry</span><b class="num">${fmtPrice(s, p.entryPrice)}</b></div><div><span>Mark</span><b class="num m-mark">${fmtPrice(s, p.markPrice)}</b></div><div><span>Liquidation</span><b class="num liq">${fmtPrice(s, p.liqPrice)}</b></div></div>
      <form novalidate>
        <div class="field"><label for="m-tp"><span>Take profit</span><span class="est up num" id="m-tp-est"></span></label><div class="input-wrap"><input class="input num" id="m-tp" inputmode="decimal" placeholder="None"><span class="suffix">USD</span></div></div>
        <div class="field"><label for="m-sl"><span>Stop loss</span><span class="est down num" id="m-sl-est"></span></label><div class="input-wrap"><input class="input num" id="m-sl" inputmode="decimal" placeholder="None"><span class="suffix">USD</span></div></div>
        <div class="form-error" aria-live="polite"></div>
        <div class="actions"><button class="btn btn-lg" type="button" id="m-clear">Remove both</button><button class="btn btn-primary btn-lg" type="submit">Save</button></div>
      </form>
    </div>`, 'tpsl-modal-wrap');
  el.querySelector('.lead').textContent = `${s} ${p.side} ${p.leverage}x · ${fmtQty(s, p.qty)} ${s}. Triggers on the live mark price and closes the whole position.`;
  const tp = el.querySelector('#m-tp');
  const sl = el.querySelector('#m-sl');
  tp.value = p.tp ?? '';
  sl.value = p.sl ?? '';
  const est = () => {
    for (const [inp, out] of [[tp, '#m-tp-est'], [sl, '#m-sl-est']]) {
      const v = num(inp.value);
      const pnl = v > 0 ? (p.side === 'long' ? v - p.entryPrice : p.entryPrice - v) * p.qty : null;
      el.querySelector(out).textContent = pnl == null ? '' : `${fmtSignedUSD(pnl)} (${fmtPct((pnl / p.margin) * 100, 1)})`;
    }
  };
  tp.oninput = est;
  sl.oninput = est;
  est();
  const save = async (body) => {
    el.querySelector('.form-error').textContent = '';
    try {
      await api(`/positions/${p.id}`, { method: 'PATCH', body });
      close();
      toast('TP / SL updated', `${s} ${p.side} ${p.leverage}x`, 'ok');
      await refreshAccount();
    } catch (err) {
      el.querySelector('.form-error').textContent = err.message;
    }
  };
  el.querySelector('form').onsubmit = (e) => {
    e.preventDefault();
    save({ tp: num(tp.value) > 0 ? num(tp.value) : null, sl: num(sl.value) > 0 ? num(sl.value) : null });
  };
  el.querySelector('#m-clear').onclick = () => save({ tp: null, sl: null });
  tp.focus();
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
    out.type = 'button';
    out.textContent = 'Log out';
    out.onclick = async () => { await logout(); location.href = '/'; };
    box.append(av, out);
    await refreshAccount();
  } else {
    const b = document.createElement('button');
    b.className = 'btn btn-primary btn-sm';
    b.type = 'button';
    b.textContent = 'Start trading';
    b.onclick = requireLogin;
    box.append(b);
    state.account = null;
    state.openOrders = [];
    renderAccount();
    renderTab();
    renderPriceLines();
    updateForm();
  }
}

// =============================================================== symbol selection
function selectSymbol(symbol) {
  if (!store.bySymbol[symbol]) return;
  state.symbol = symbol;
  ls.set('ag.symbol', symbol);
  history.replaceState(null, '', `/trade?s=${symbol}`);
  document.querySelectorAll('.mp-item').forEach((el) => el.classList.toggle('active', el.dataset.symbol === symbol));
  for (const id of ['f-limit', 'f-amount', 'f-tp', 'f-sl']) $(id).value = '';
  $('order-error').textContent = '';
  if (state.type === 'limit') useLastPrice();
  renderHeader();
  loadCandles().then(renderPriceLines);
  updateForm();
}

// =============================================================== boot
(async () => {
  await loadMarkets();
  $('op-maxlev').textContent = `${store.trading.maxLeverage}x`;
  $('lev-range').max = store.trading.maxLeverage;
  initChart();
  renderCategoryPills();

  const params = new URLSearchParams(location.search);
  state.symbol = [params.get('s'), ls.get('ag.symbol', null), 'SOL'].find((s) => s && store.bySymbol[s]);
  if (params.get('side') === 'short') state.side = 'short';
  if (params.get('lev')) state.leverage = Number(params.get('lev'));
  renderMarketList();
  setSide(state.side);
  selectSymbol(state.symbol);
  setLeverage(state.leverage, !params.get('lev'));
  await initUser();
  connectLive();

  onQuotes((changes) => {
    for (const { q, prev } of changes) {
      updateMarketItem(q.symbol, prev);
      if (q.symbol === state.symbol) { updateHeader(prev); tickChart(q); }
    }
    if (state.account) { revalue(); renderAccount(); updatePositionsLive(); }
    if (state.type === 'market') updateForm();
  });

  onAccount(async (ev) => {
    const p = ev.position;
    if (ev.kind === 'filled' && p) toast('Limit order filled', `${p.side} ${p.leverage}x · ${fmtQty(p.symbol, p.qty)} ${p.symbol} at $${fmtPrice(p.symbol, p.entryPrice)}`, 'ok');
    if (ev.kind === 'take_profit') toast(`Take profit hit · ${p.symbol}`, `Closed at $${fmtPrice(p.symbol, p.closePrice)} · PnL ${fmtSignedUSD(p.realizedPnl)}`, 'ok');
    if (ev.kind === 'stop_loss') toast(`Stop loss hit · ${p.symbol}`, `Closed at $${fmtPrice(p.symbol, p.closePrice)} · PnL ${fmtSignedUSD(p.realizedPnl)}`, 'warn');
    if (ev.kind === 'liquidation') toast(`Liquidated · ${p.symbol} ${p.side} ${p.leverage}x`, `Margin of ${fmtUSD(p.margin)} lost at $${fmtPrice(p.symbol, p.closePrice)}`, 'err');
    await refreshAccount();
  });

  // ---- events
  $('search').addEventListener('input', (e) => { state.search = e.target.value; renderMarketList(); });
  $('sym-switch').onclick = openDrawer;
  $('mp-close').onclick = closeDrawer;
  $('scrim').onclick = closeDrawer;
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });
  document.querySelectorAll('.side-seg button').forEach((b) => { b.onclick = () => setSide(b.dataset.side); });
  document.querySelectorAll('.type-tabs button').forEach((b) => { b.onclick = () => setType(b.dataset.type); });
  document.querySelectorAll('.unit-toggle button').forEach((b) => { b.onclick = () => setUnit(b.dataset.unit); });
  document.querySelectorAll('.tab').forEach((t) => { t.onclick = () => { state.tab = t.dataset.tab; renderTab(); }; });
  $('lev-range').addEventListener('input', (e) => setLeverage(e.target.value));
  $('lev-minus').onclick = () => setLeverage(state.leverage - 1);
  $('lev-plus').onclick = () => setLeverage(state.leverage + 1);
  $('lev-input').addEventListener('focus', (e) => { e.target.value = state.leverage; e.target.select(); });
  $('lev-input').addEventListener('change', (e) => setLeverage(e.target.value));
  $('lev-input').addEventListener('blur', (e) => setLeverage(e.target.value));
  $('lev-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } });
  $('lev-quick').addEventListener('click', (e) => { const v = e.target.dataset.lev; if (v) setLeverage(v); });
  $('pct-row').addEventListener('click', (e) => { const p = e.target.dataset.pct; if (p) setPct(+p); });
  $('use-last').onclick = useLastPrice;
  for (const id of ['f-amount', 'f-limit', 'f-tp', 'f-sl']) $(id).addEventListener('input', () => updateForm());
  $('tpsl-toggle').onchange = (e) => { $('tpsl').classList.toggle('hidden', !e.target.checked); updateForm(); };
  $('order-form').addEventListener('submit', submitOrder);
  $('close-all').onclick = async () => {
    const n = state.account?.positions.length || 0;
    if (!(await confirmModal('Close all positions?', `This market-closes all ${n} open positions at the current price.`, 'Close all', true))) return;
    try {
      const r = await api('/positions/close-all', { method: 'POST' });
      const total = r.closed.reduce((s, p) => s + p.realizedPnl, 0);
      toast(`Closed ${r.closed.length} position${r.closed.length === 1 ? '' : 's'}`, `Realized ${fmtSignedUSD(total)}${r.skipped.length ? ` · ${r.skipped.length} skipped (market closed)` : ''}`, 'info');
    } catch (err) { toast('Could not close positions', err.message, 'err'); }
    await refreshAccount();
  };
  $('reset-btn').onclick = async () => {
    if (!state.user) { requireLogin(); return; }
    if (!(await confirmModal('Reset demo account?', 'All positions, orders and history are deleted and your balance returns to $100,000.', 'Reset account', true))) return;
    try {
      await api('/account/reset', { method: 'POST' });
      toast('Demo account reset', 'Balance restored to $100,000.', 'info');
    } catch (err) { toast('Could not reset', err.message, 'err'); }
    await refreshAccount();
  };
})();
