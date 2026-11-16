// Shared client helpers: API, live socket, formatting, auth modal, toasts.

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
  feeRate: 0.001,
  quotes: {},
};

export async function loadMarkets() {
  const data = await api('/markets');
  store.markets = data.markets;
  store.categories = data.categories;
  store.feeRate = data.feeRate;
  for (const m of data.markets) {
    store.bySymbol[m.symbol] = m;
    if (m.quote) store.quotes[m.symbol] = m.quote;
  }
  return store;
}

// ---------------------------------------------------------------- live socket
const quoteListeners = new Set();
const orderListeners = new Set();
let socket;
export function onQuotes(fn) { quoteListeners.add(fn); return () => quoteListeners.delete(fn); }
export function onOrder(fn) { orderListeners.add(fn); return () => orderListeners.delete(fn); }

export function connectLive() {
  if (socket && socket.readyState <= 1) socket.close();
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  socket = ws;
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
    } else if (msg.type === 'order') {
      orderListeners.forEach((fn) => fn(msg.data));
    }
  };
  ws.onclose = () => { if (socket === ws) setTimeout(connectLive, 2000); };
}

// ---------------------------------------------------------------- formatting
export function fmtPrice(symbol, v) {
  if (v == null || !Number.isFinite(v)) return '—';
  const d = store.bySymbol[symbol]?.priceDecimals ?? 2;
  return v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}
export function fmtUSD(v, d = 2) {
  if (v == null || !Number.isFinite(v)) return '—';
  const s = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  return `${v < 0 ? '-' : ''}$${s}`;
}
export function fmtSignedUSD(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${v >= 0 ? '+' : '-'}${fmtUSD(Math.abs(v))}`;
}
export function fmtPct(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
}
export function fmtQty(symbol, v) {
  if (v == null || !Number.isFinite(v)) return '—';
  const d = store.bySymbol[symbol]?.qtyDecimals ?? 4;
  return v.toLocaleString('en-US', { maximumFractionDigits: d });
}
export function fmtCompact(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  return v.toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 2 });
}
export const dirClass = (v) => (v > 0 ? 'up' : v < 0 ? 'down' : '');

/** Restart a CSS flash animation on el, depending on price direction. */
export function flash(el, prev, next) {
  if (!el || prev == null || next == null || prev === next) return;
  el.classList.remove('flash-up', 'flash-down');
  void el.offsetWidth;
  el.classList.add(next > prev ? 'flash-up' : 'flash-down');
}

// ---------------------------------------------------------------- asset icons
const ICON = {
  BTC: ['₿', '#f7931a'], ETH: ['Ξ', '#9fa8ff'], SOL: ['◎', '#14f195'], XRP: ['XRP', '#d6dbe6'],
  DOGE: ['Ð', '#d9b84a'], ADA: ['₳', '#4d7cff'], AVAX: ['AV', '#ff5a5f'], LINK: ['⬡', '#4a7dff'],
  XAU: ['Au', '#f4c55b'], XAG: ['Ag', '#d5dbe3'], XPT: ['Pt', '#b8c4cf'], XCU: ['Cu', '#e08a5b'],
  EUR: ['€', '#7ab8ff'], GBP: ['£', '#c39bff'], AUD: ['A$', '#66e0b5'],
  SPY: ['500', '#c8ff3d'], QQQ: ['100', '#8b6cff'],
};
export function assetIcon(symbol, small = false) {
  const [glyph, color] = ICON[symbol] || [symbol.slice(0, 2), '#c8ff3d'];
  const el = document.createElement('span');
  el.className = `asset-ic${small ? ' sm' : ''}`;
  el.style.background = `radial-gradient(circle at 30% 25%, #fff8, transparent 45%), ${color}`;
  el.textContent = glyph;
  el.setAttribute('aria-hidden', 'true');
  return el;
}

// ---------------------------------------------------------------- session
export async function currentUser() {
  try { return (await api('/me')).user; } catch { return null; }
}
export async function logout() {
  await api('/auth/logout', { method: 'POST' });
}

// ---------------------------------------------------------------- toasts
export function toast(title, body = '', kind = 'info') {
  let box = document.querySelector('.toasts');
  if (!box) {
    box = document.createElement('div');
    box.className = 'toasts';
    box.setAttribute('role', 'status');
    document.body.append(box);
  }
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  const s = document.createElement('strong');
  s.textContent = title;
  t.append(s);
  if (body) {
    const p = document.createElement('span');
    p.className = 'muted';
    p.textContent = body;
    t.append(p);
  }
  box.append(t);
  setTimeout(() => t.remove(), 4500);
}

// ---------------------------------------------------------------- auth modal
/** Opens login/signup modal. Resolves true when the user is signed in, false if dismissed. */
export function openAuth(mode = 'signup') {
  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'modal-backdrop';
    back.innerHTML = `
      <div class="modal glass" role="dialog" aria-modal="true" aria-labelledby="auth-title">
        <button class="close" type="button" aria-label="Close">×</button>
        <h2 id="auth-title"></h2>
        <p class="lead"></p>
        <form novalidate>
          <div class="field name-field"><label for="a-name">Name</label><input id="a-name" class="input" name="name" autocomplete="name" placeholder="Your name"></div>
          <div class="field"><label for="a-email">Email</label><input id="a-email" class="input" name="email" type="email" autocomplete="email" placeholder="you@example.com"></div>
          <div class="field"><label for="a-pass">Password</label><input id="a-pass" class="input" name="password" type="password" placeholder="At least 8 characters"></div>
          <div class="form-error" aria-live="polite"></div>
          <button class="btn btn-primary btn-lg submit" type="submit"></button>
          <div class="divider">or</div>
          <button class="btn btn-lg guest" type="button">Try instantly as a guest</button>
        </form>
        <div class="switch"></div>
      </div>`;
    const $ = (s) => back.querySelector(s);
    const render = () => {
      const signup = mode === 'signup';
      $('#auth-title').textContent = signup ? 'Open your demo account' : 'Welcome back';
      $('.lead').textContent = signup
        ? 'Get $100,000 in demo funds and trade crypto, metals, stocks and forex at live prices.'
        : 'Log in to your DSX demo account.';
      $('.name-field').classList.toggle('hidden', !signup);
      $('#a-pass').autocomplete = signup ? 'new-password' : 'current-password';
      $('.submit').textContent = signup ? 'Create demo account' : 'Log in';
      $('.switch').innerHTML = signup ? 'Already have an account? <a>Log in</a>' : 'New to DSX? <a>Create a demo account</a>';
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
    $('.switch').addEventListener('click', (e) => { if (e.target.tagName === 'A') { mode = mode === 'signup' ? 'login' : 'signup'; render(); } });
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
