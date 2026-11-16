// Shared client helpers: API, live socket, formatting, icons, sparklines, auth modal, toasts.

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { status: res.status });
  return data;
}

// ---------------------------------------------------------------- markets store
export const store = {
  markets: [],
  bySymbol: {},
  categories: [],
  trading: { feeRate: 0.0005, maintMarginRate: 0.005, maxLeverage: 20, minNotional: 5 },
  quotes: {},
  sparks: {},
};

export async function loadMarkets() {
  const data = await api('/markets');
  store.markets = data.markets;
  store.categories = data.categories;
  store.trading = data.trading;
  for (const m of data.markets) {
    store.bySymbol[m.symbol] = m;
    if (m.quote) store.quotes[m.symbol] = m.quote;
  }
  return store;
}

export async function loadSparklines() {
  try { store.sparks = await api('/sparklines'); } catch { /* sparklines are decorative */ }
  return store.sparks;
}

// ---------------------------------------------------------------- live socket
const quoteListeners = new Set();
const accountListeners = new Set();
const statusListeners = new Set();
let socket;
export function onQuotes(fn) { quoteListeners.add(fn); return () => quoteListeners.delete(fn); }
export function onAccount(fn) { accountListeners.add(fn); return () => accountListeners.delete(fn); }
export function onLiveStatus(fn) { statusListeners.add(fn); return () => statusListeners.delete(fn); }

export function connectLive() {
  if (socket && socket.readyState <= 1) { socket.onclose = null; socket.close(); }
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  socket = ws;
  ws.onopen = () => statusListeners.forEach((fn) => fn(true));
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'quotes') {
      const changed = [];
      for (const q of msg.data) {
        const prev = store.quotes[q.symbol];
        store.quotes[q.symbol] = q;
        changed.push({ q, prev });
      }
      quoteListeners.forEach((fn) => fn(changed));
    } else if (msg.type === 'account') {
      accountListeners.forEach((fn) => fn(msg.data));
    }
  };
  ws.onclose = () => {
    statusListeners.forEach((fn) => fn(false));
    if (socket === ws) setTimeout(connectLive, 2000);
  };
}

// ---------------------------------------------------------------- formatting
const nf = (min, max) => new Intl.NumberFormat('en-US', { minimumFractionDigits: min, maximumFractionDigits: max });
const nfCache = {};
const fmtN = (v, min, max = min) => (nfCache[`${min}:${max}`] ||= nf(min, max)).format(v);

export function fmtPrice(symbol, v) {
  if (v == null || !Number.isFinite(v)) return '—';
  const d = store.bySymbol[symbol]?.priceDecimals ?? 2;
  return fmtN(v, d);
}
export function fmtUSD(v, d = 2) {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${v < 0 ? '-' : ''}$${fmtN(Math.abs(v), d)}`;
}
export function fmtSignedUSD(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${v >= 0 ? '+' : '-'}$${fmtN(Math.abs(v), 2)}`;
}
export function fmtPct(v, d = 2) {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(d)}%`;
}
export function fmtQty(symbol, v) {
  if (v == null || !Number.isFinite(v)) return '—';
  const d = store.bySymbol[symbol]?.qtyDecimals ?? 4;
  return fmtN(v, 0, d);
}
export function fmtCompact(v, prefix = '') {
  if (v == null || !Number.isFinite(v)) return '—';
  return prefix + v.toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 2 });
}
export const dirClass = (v) => (v > 0 ? 'up' : v < 0 ? 'down' : '');

export function flash(el, prev, next) {
  if (!el || prev == null || next == null || prev === next) return;
  el.classList.remove('flash-up', 'flash-down');
  void el.offsetWidth;
  el.classList.add(next > prev ? 'flash-up' : 'flash-down');
}

export function timeAgo(ts) {
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return new Date(ts).toLocaleDateString();
}

// ---------------------------------------------------------------- asset icons
const SOL_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true"><defs><linearGradient id="solg" x1="3" y1="20" x2="21" y2="4" gradientUnits="userSpaceOnUse"><stop stop-color="#9945FF"/><stop offset=".5" stop-color="#5B6CFF"/><stop offset="1" stop-color="#14F195"/></linearGradient></defs>
<path fill="url(#solg)" d="M6.2 15.6a.6.6 0 0 1 .43-.18h14.1c.27 0 .4.32.21.51l-2.8 2.8a.6.6 0 0 1-.43.18H3.6a.3.3 0 0 1-.21-.51l2.8-2.8Zm0-10.45A.62.62 0 0 1 6.63 5h14.1c.27 0 .4.32.21.51l-2.8 2.8a.6.6 0 0 1-.43.18H3.6a.3.3 0 0 1-.21-.51l2.8-2.83Zm11.51 5.2a.6.6 0 0 0-.43-.18H3.18c-.27 0-.4.32-.21.51l2.8 2.8c.11.11.27.18.43.18h14.1c.27 0 .4-.32.21-.51l-2.8-2.8Z"/></svg>`;

const ICON = {
  SOL: [SOL_SVG, '#0d0f1a'], JTO: ['JTO', '#7ee3c4'], PYTH: ['PY', '#c7b2ff'], RAY: ['RAY', '#5ac4be'],
  ORCA: ['🐋', '#ffd15c'], RENDER: ['RN', '#ff4a4a'], HNT: ['HNT', '#474dff'], WIF: ['WIF', '#c9a074'],
  BONK: ['BNK', '#f7a531'], POPCAT: ['PC', '#f0e6d2'],
  BTC: ['₿', '#f7931a'], ETH: ['Ξ', '#9fa8ff'], XRP: ['XRP', '#d6dbe6'], DOGE: ['Ð', '#d9b84a'],
  ADA: ['₳', '#4d7cff'], AVAX: ['AV', '#ff5a5f'], LINK: ['⬡', '#4a7dff'],
  XAU: ['Au', '#f4c55b'], XAG: ['Ag', '#d5dbe3'], XPT: ['Pt', '#b8c4cf'], XCU: ['Cu', '#e08a5b'],
  EUR: ['€', '#7ab8ff'], GBP: ['£', '#c39bff'], AUD: ['A$', '#66e0b5'],
  SPY: ['500', '#9b7bff'], QQQ: ['100', '#22e3f0'],
  AAPL: ['AA', '#e8e8ea'], NVDA: ['NV', '#76b900'], TSLA: ['T', '#e82127'], MSFT: ['MS', '#00a4ef'],
  AMZN: ['a', '#ff9900'], GOOGL: ['G', '#4285f4'], META: ['∞', '#0866ff'],
};

export function assetIcon(symbol, size = '') {
  const [glyph, color] = ICON[symbol] || [symbol.slice(0, 2), '#9b7bff'];
  const el = document.createElement('span');
  const m = store.bySymbol[symbol];
  el.className = `asset-ic${size ? ` ${size}` : ''}${m?.category === 'solana' && symbol !== 'SOL' ? ' sol-eco' : ''}`;
  el.setAttribute('aria-hidden', 'true');
  if (glyph.startsWith('<svg')) {
    el.innerHTML = glyph.replaceAll('solg', `solg${++sparkId}`); // unique gradient id per icon
    el.style.background = color;
    el.style.boxShadow = 'inset 0 0 0 1px rgba(153,69,255,.5), 0 0 16px -2px rgba(153,69,255,.55)';
  } else {
    el.textContent = glyph;
    el.style.background = `radial-gradient(circle at 30% 25%, #fff9, transparent 48%), ${color}`;
  }
  return el;
}

// ---------------------------------------------------------------- sparkline
let sparkId = 0;
/** Returns an SVG sparkline for `values` (real hourly closes). */
export function sparkline(values, { width = 120, height = 36, fill = true } = {}) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('class', 'spark');
  svg.setAttribute('aria-hidden', 'true');
  if (!values || values.length < 2) return svg;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * width, height - 2 - ((v - min) / span) * (height - 4)]);
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const color = values[values.length - 1] >= values[0] ? '#16c784' : '#f6465d';
  const id = `sg${++sparkId}`;
  svg.innerHTML = `${fill ? `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".28"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
    <path d="${d} L${width} ${height} L0 ${height} Z" fill="url(#${id})"/>` : ''}
    <path d="${d}" fill="none" stroke="${color}" stroke-width="1.6" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"/>`;
  return svg;
}

// ---------------------------------------------------------------- brand
export function brandHTML() {
  return '<span class="brand"><img src="/img/dsx-mark.svg" alt="" width="34" height="34"><span class="brand-word"><b>DSX</b><span>EXCHANGE</span></span></span>';
}

// ---------------------------------------------------------------- session
export async function currentUser() {
  try { return (await api('/me')).user; } catch { return null; }
}
export async function logout() {
  await api('/auth/logout', { method: 'POST' });
}

// ---------------------------------------------------------------- toasts
const TOAST_ICON = { ok: '✓', err: '!', info: 'i', warn: '⚠' };
export function toast(title, body = '', kind = 'info') {
  let box = document.querySelector('.toasts');
  if (!box) {
    box = document.createElement('div');
    box.className = 'toasts';
    box.setAttribute('role', 'status');
    box.setAttribute('aria-live', 'polite');
    document.body.append(box);
  }
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  const i = document.createElement('i');
  i.textContent = TOAST_ICON[kind] || 'i';
  const s = document.createElement('strong');
  s.textContent = title;
  t.append(i, s);
  if (body) {
    const p = document.createElement('span');
    p.className = 'muted';
    p.textContent = body;
    t.append(p);
  }
  box.append(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 260); }, 5000);
}

// ---------------------------------------------------------------- auth modal
/** Opens login/signup modal. Resolves true when the user is signed in, false if dismissed. */
export function openAuth(mode = 'signup') {
  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'modal-backdrop';
    back.innerHTML = `
      <div class="modal card edge-glow" role="dialog" aria-modal="true" aria-labelledby="auth-title">
        <button class="close" type="button" aria-label="Close">×</button>
        ${brandHTML()}
        <h2 id="auth-title"></h2>
        <p class="lead"></p>
        <form novalidate>
          <div class="field name-field"><label for="a-name">Name</label><input id="a-name" class="input" name="name" autocomplete="name" placeholder="Your name"></div>
          <div class="field"><label for="a-email">Email</label><input id="a-email" class="input" name="email" type="email" autocomplete="email" placeholder="you@example.com"></div>
          <div class="field"><label for="a-pass">Password</label><input id="a-pass" class="input" name="password" type="password" placeholder="At least 8 characters"></div>
          <div class="form-error" aria-live="polite"></div>
          <button class="btn btn-primary btn-lg submit" type="submit"></button>
          <div class="divider">or</div>
          <button class="btn btn-lg guest" type="button">Continue as guest — instant demo</button>
        </form>
        <div class="switch"></div>
      </div>`;
    const $ = (s) => back.querySelector(s);
    const render = () => {
      const signup = mode === 'signup';
      $('#auth-title').textContent = signup ? 'Open your demo account' : 'Welcome back';
      $('.lead').textContent = signup
        ? 'Get $100,000 in demo funds. Trade crypto, Solana tokens, metals, stocks and forex at live prices with up to 20x leverage.'
        : 'Log in to your DSX account.';
      $('.name-field').classList.toggle('hidden', !signup);
      $('#a-pass').autocomplete = signup ? 'new-password' : 'current-password';
      $('.submit').textContent = signup ? 'Create account' : 'Log in';
      $('.switch').innerHTML = signup ? 'Already have an account? <button type="button">Log in</button>' : 'New to DSX? <button type="button">Create an account</button>';
      $('.form-error').textContent = '';
    };
    const close = (ok) => { back.remove(); document.removeEventListener('keydown', onKey); resolve(ok); };
    const onKey = (e) => { if (e.key === 'Escape') close(false); };
    const busy = async (btn, fn) => {
      btn.disabled = true;
      $('.form-error').textContent = '';
      try { await fn(); close(true); } catch (err) { $('.form-error').textContent = err.message; } finally { btn.disabled = false; }
    };

    $('.close').onclick = () => close(false);
    back.addEventListener('mousedown', (e) => { if (e.target === back) close(false); });
    $('.switch').addEventListener('click', (e) => { if (e.target.tagName === 'BUTTON') { mode = mode === 'signup' ? 'login' : 'signup'; render(); } });
    $('form').addEventListener('submit', (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      busy($('.submit'), () => api(mode === 'signup' ? '/auth/register' : '/auth/login', { method: 'POST', body: f }));
    });
    $('.guest').onclick = () => busy($('.guest'), () => api('/auth/guest', { method: 'POST' }));
    document.addEventListener('keydown', onKey);

    render();
    document.body.append(back);
    (mode === 'signup' ? $('#a-name') : $('#a-email')).focus();
  });
}

/** Adds .in to .reveal elements as they scroll into view. */
export function revealOnScroll() {
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }, { threshold: 0.12 });
  document.querySelectorAll('.reveal').forEach((el) => io.observe(el));
}
