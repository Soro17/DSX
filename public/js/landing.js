import {
  store, loadMarkets, connectLive, onQuotes, openAuth, currentUser, logout,
  fmtPrice, fmtPct, dirClass, assetIcon, flash,
} from './common.js';

document.getElementById('year').textContent = new Date().getFullYear();

// ---------------------------------------------------------------- auth CTAs
async function renderNav() {
  const user = await currentUser();
  const box = document.getElementById('nav-cta');
  if (!user) return;
  box.innerHTML = '';
  const name = document.createElement('span');
  name.className = 'muted hide-sm';
  name.textContent = user.name;
  const out = document.createElement('button');
  out.className = 'btn btn-ghost';
  out.textContent = 'Log out';
  out.onclick = async () => { await logout(); location.reload(); };
  const go = document.createElement('a');
  go.className = 'btn btn-primary';
  go.href = '/trade';
  go.textContent = 'Open terminal';
  box.append(name, out, go);
  document.querySelectorAll('[data-auth="signup"]').forEach((b) => { b.dataset.auth = 'go'; });
}

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-auth]');
  if (!btn) return;
  if (btn.dataset.auth === 'go') { location.href = '/trade'; return; }
  if (await openAuth(btn.dataset.auth)) location.href = '/trade';
});

// ---------------------------------------------------------------- markets table
let category = 'crypto';
const rows = new Map();

function renderPills() {
  const box = document.getElementById('cat-pills');
  box.innerHTML = '';
  for (const c of store.categories) {
    const b = document.createElement('button');
    b.className = `pill${c.id === category ? ' active' : ''}`;
    b.textContent = c.label;
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(c.id === category));
    b.onclick = () => { category = c.id; renderPills(); renderTable(); };
    box.append(b);
  }
}

function renderTable() {
  const body = document.getElementById('markets-body');
  body.innerHTML = '';
  rows.clear();
  for (const m of store.markets.filter((x) => x.category === category)) {
    const row = document.createElement('a');
    row.className = 'mt-row';
    row.href = `/trade?s=${m.symbol}`;
    row.innerHTML = `
      <span class="mt-asset"><span class="ic"></span><span><div class="nm"></div><div class="sym"></div></span></span>
      <span class="r num mt-price"></span>
      <span class="r"><span class="chg num"></span></span>
      <span class="r hide-sm"><span class="range"><span class="range-bar"><i></i></span><span class="range-lbl num"><span class="lo"></span><span class="hi"></span></span></span></span>
      <span class="r hide-sm"><span class="badge st"></span></span>
      <span class="r"><span class="btn btn-sm">Trade</span></span>`;
    row.querySelector('.ic').replaceWith(assetIcon(m.symbol));
    row.querySelector('.nm').textContent = m.name;
    row.querySelector('.sym').textContent = `${m.symbol}/USD${m.unit ? ` · per ${m.unit}` : ''}`;
    body.append(row);
    rows.set(m.symbol, row);
    updateRow(m.symbol);
  }
}

function updateRow(symbol, prev) {
  const row = rows.get(symbol);
  const q = store.quotes[symbol];
  if (!row || !q) return;
  const price = row.querySelector('.mt-price');
  price.textContent = fmtPrice(symbol, q.price);
  flash(price, prev?.price, q.price);
  const chg = row.querySelector('.chg');
  chg.textContent = fmtPct(q.changePct);
  chg.className = `chg num ${dirClass(q.changePct)}`;
  if (q.high != null && q.low != null) {
    const pos = q.high > q.low ? ((q.price - q.low) / (q.high - q.low)) * 100 : 50;
    row.querySelector('.range-bar i').style.left = `${Math.max(0, Math.min(100, pos))}%`;
    row.querySelector('.lo').textContent = fmtPrice(symbol, q.low);
    row.querySelector('.hi').textContent = fmtPrice(symbol, q.high);
  }
  const st = row.querySelector('.st');
  st.className = `badge st ${q.marketOpen === false ? 'closed' : 'live'}`;
  st.textContent = q.marketOpen === false ? 'Closed' : 'Live';
}

// ---------------------------------------------------------------- ticker + hero cards
function renderTicker() {
  const track = document.getElementById('ticker');
  const make = () => store.markets.map((m) => {
    const el = document.createElement('a');
    el.className = 'tk';
    el.href = `/trade?s=${m.symbol}`;
    el.dataset.symbol = m.symbol;
    el.append(assetIcon(m.symbol, true));
    el.insertAdjacentHTML('beforeend', '<b></b><span class="num p"></span><span class="num c"></span>');
    el.querySelector('b').textContent = m.symbol;
    return el;
  });
  track.innerHTML = '';
  track.append(...make(), ...make()); // duplicated for a seamless loop
  store.markets.forEach((m) => updateTicker(m.symbol));
}

function updateTicker(symbol) {
  const q = store.quotes[symbol];
  if (!q) return;
  for (const el of document.querySelectorAll(`.tk[data-symbol="${symbol}"]`)) {
    el.querySelector('.p').textContent = fmtPrice(symbol, q.price);
    const c = el.querySelector('.c');
    c.textContent = fmtPct(q.changePct);
    c.className = `num c ${dirClass(q.changePct)}`;
  }
}

function initCards() {
  for (const card of document.querySelectorAll('.float-card')) {
    const m = store.bySymbol[card.dataset.symbol];
    card.innerHTML = '';
    card.append(assetIcon(m.symbol));
    card.insertAdjacentHTML('beforeend', '<div><span class="fc-name"></span> <span class="chg num"></span></div><div class="fc-price num"></div>');
    card.querySelector('.fc-name').textContent = m.name;
    updateCard(m.symbol);
  }
}

function updateCard(symbol, prev) {
  const card = document.querySelector(`.float-card[data-symbol="${symbol}"]`);
  const q = store.quotes[symbol];
  if (!card || !q) return;
  const p = card.querySelector('.fc-price');
  p.textContent = `$${fmtPrice(symbol, q.price)}`;
  flash(p, prev?.price, q.price);
  const c = card.querySelector('.chg');
  c.textContent = fmtPct(q.changePct);
  c.className = `chg num ${dirClass(q.changePct)}`;
}

// ---------------------------------------------------------------- boot
(async () => {
  renderNav();
  await loadMarkets();
  document.getElementById('stat-markets').textContent = store.markets.length;
  renderPills();
  renderTable();
  renderTicker();
  initCards();
  connectLive();
  onQuotes((changes) => {
    for (const { q, prev } of changes) {
      updateRow(q.symbol, prev);
      updateTicker(q.symbol);
      updateCard(q.symbol, prev);
    }
  });
})();

// 3D scene — load after fonts so the coin faces render with the display font.
(async () => {
  try {
    await document.fonts.ready;
    const { mountCoinScene } = await import('./coin3d.js');
    mountCoinScene(document.getElementById('coin-stage'));
  } catch (err) {
    console.warn('3D scene unavailable', err);
  }
})();
