import {
  api, store, loadMarkets, loadSparklines, connectLive, onQuotes, openAuth, currentUser, logout,
  fmtPrice, fmtPct, fmtUSD, fmtCompact, dirClass, assetIcon, flash, sparkline, revealOnScroll,
} from './common.js';

const $ = (id) => document.getElementById(id);
$('year').textContent = new Date().getFullYear();

const ECO_TAG = {
  SOL: 'Layer 1', JTO: 'Liquid staking', PYTH: 'Oracle network', RAY: 'DEX · AMM', ORCA: 'DEX',
  RENDER: 'GPU network', HNT: 'Wireless network', WIF: 'Meme', BONK: 'Meme', POPCAT: 'Meme',
};
const SPOT = ['BTC', 'ETH', 'XAU', 'NVDA', 'SPY', 'EUR'];

// ---------------------------------------------------------------- nav + auth
window.addEventListener('scroll', () => $('nav').classList.toggle('scrolled', scrollY > 8), { passive: true });

async function renderNav() {
  const user = await currentUser();
  if (!user) return;
  const box = $('nav-cta');
  box.innerHTML = '';
  const name = document.createElement('span');
  name.className = 'nav-user hide-sm';
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
  if (btn) {
    if (btn.dataset.auth === 'go') { location.href = '/trade'; return; }
    if (await openAuth(btn.dataset.auth)) location.href = '/trade';
    return;
  }
  const filter = e.target.closest('[data-filter]');
  if (filter) { mkCategory = filter.dataset.filter; renderTabs(); renderTable(); }
});

// ---------------------------------------------------------------- hero SOL card
let heroChart;
let heroSeries;
let heroTf = '1h';
let heroData = [];
const TZ = -new Date().getTimezoneOffset() * 60;

function initHero() {
  $('hc-ic').replaceChildren(assetIcon('SOL', 'lg'));
  $('hero-sol-glyph').replaceChildren(assetIcon('SOL', 'sm'));
  heroChart = LightweightCharts.createChart($('hc-chart'), {
    autoSize: true,
    layout: { background: { type: 'solid', color: 'transparent' }, textColor: '#596079', fontFamily: 'JetBrains Mono, monospace', fontSize: 10 },
    grid: { vertLines: { visible: false }, horzLines: { color: 'rgba(255,255,255,0.04)' } },
    rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.15, bottom: 0.05 } },
    timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
    crosshair: { vertLine: { color: 'rgba(153,69,255,.4)', labelBackgroundColor: '#1d1640' }, horzLine: { color: 'rgba(153,69,255,.4)', labelBackgroundColor: '#1d1640' } },
    handleScroll: false, handleScale: false,
  });
  heroSeries = heroChart.addAreaSeries({
    lineColor: '#14f195', lineWidth: 2,
    topColor: 'rgba(153,69,255,0.45)', bottomColor: 'rgba(153,69,255,0.02)',
    priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
  });
  document.querySelectorAll('#hc-tf .pill').forEach((b) => {
    b.onclick = () => {
      heroTf = b.dataset.tf;
      document.querySelectorAll('#hc-tf .pill').forEach((p) => p.classList.toggle('active', p === b));
      loadHeroChart();
    };
  });
  const lev = $('hc-lev');
  lev.addEventListener('input', updateCalc);
  updateCalc();
  loadHeroChart();
  updateHero();
}

async function loadHeroChart() {
  try {
    const candles = await api(`/candles/SOL?tf=${heroTf}`);
    heroData = candles.map((c) => ({ time: c.time + TZ, value: c.close }));
    heroSeries.setData(heroData);
    heroChart.timeScale().fitContent();
  } catch { /* leave chart empty */ }
}

function updateHero(prev) {
  const q = store.quotes.SOL;
  if (!q) return;
  const p = $('hc-price');
  p.textContent = `$${fmtPrice('SOL', q.price)}`;
  flash(p, prev?.price, q.price);
  const c = $('hc-chg');
  c.textContent = fmtPct(q.changePct);
  c.className = `chg num ${dirClass(q.changePct)}`;
  $('hc-high').textContent = fmtPrice('SOL', q.high);
  $('hc-low').textContent = fmtPrice('SOL', q.low);
  $('hc-vol').textContent = q.volume ? `${fmtCompact(q.volume)} SOL` : '—';
  $('hc-spread').textContent = q.ask && q.bid ? fmtPrice('SOL', q.ask - q.bid) : '—';
  if (heroData.length) {
    const last = heroData[heroData.length - 1];
    last.value = q.price;
    heroSeries.update(last);
  }
  updateCalc();
}

function updateCalc() {
  const lev = Number($('hc-lev').value);
  const mmr = store.trading.maintMarginRate;
  $('hc-lev').style.setProperty('--fill', `${((lev - 1) / 19) * 100}%`);
  $('hc-lev-val').textContent = `${lev}x`;
  $('hc-size').textContent = fmtUSD(1000 * lev, 0);
  const price = store.quotes.SOL?.price;
  if (price) {
    $('hc-liq-long').textContent = `$${fmtPrice('SOL', price * (1 - 1 / lev + mmr))}`;
    $('hc-liq-short').textContent = `$${fmtPrice('SOL', price * (1 + 1 / lev - mmr))}`;
  }
  $('hc-long').href = `/trade?s=SOL&side=long&lev=${lev}`;
  $('hc-short').href = `/trade?s=SOL&side=short&lev=${lev}`;
}

// ---------------------------------------------------------------- ticker
function renderTicker() {
  const make = () => store.markets.map((m) => {
    const el = document.createElement('a');
    el.className = 'tk';
    el.href = `/trade?s=${m.symbol}`;
    el.dataset.symbol = m.symbol;
    el.append(assetIcon(m.symbol, 'sm'));
    el.insertAdjacentHTML('beforeend', '<b></b><span class="num p"></span><span class="num c"></span>');
    el.querySelector('b').textContent = m.symbol;
    return el;
  });
  $('ticker').replaceChildren(...make(), ...make());
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

// ---------------------------------------------------------------- movers + spot cards
let moversMode = 'gainers';
function renderMovers() {
  const list = store.markets
    .map((m) => ({ m, q: store.quotes[m.symbol] }))
    .filter((x) => x.q && Number.isFinite(x.q.changePct))
    .sort((a, b) => (moversMode === 'gainers' ? b.q.changePct - a.q.changePct : a.q.changePct - b.q.changePct))
    .slice(0, 6);
  const ol = $('movers');
  ol.replaceChildren(...list.map(({ m, q }, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<a href="/trade?s=${m.symbol}"><span class="rank num">${i + 1}</span><span class="ic"></span><span class="nm"><b></b><span></span></span><span class="px num"><span class="p"></span><span class="c"></span></span></a>`;
    li.querySelector('.ic').replaceWith(assetIcon(m.symbol, 'sm'));
    li.querySelector('.nm b').textContent = m.symbol;
    li.querySelector('.nm span').textContent = m.name;
    li.querySelector('.p').textContent = fmtPrice(m.symbol, q.price);
    const c = li.querySelector('.c');
    c.textContent = fmtPct(q.changePct);
    c.className = `c ${dirClass(q.changePct)}`;
    return li;
  }));
}
document.querySelectorAll('[data-movers]').forEach((b) => {
  b.onclick = () => {
    moversMode = b.dataset.movers;
    document.querySelectorAll('[data-movers]').forEach((x) => x.classList.toggle('active', x === b));
    renderMovers();
  };
});

function renderSpot() {
  $('spot-cards').replaceChildren(...SPOT.map((s) => {
    const m = store.bySymbol[s];
    const a = document.createElement('a');
    a.className = 'card spot reveal in';
    a.href = `/trade?s=${s}`;
    a.dataset.symbol = s;
    a.innerHTML = '<div class="spot-top"><span class="ic"></span><span class="nm"><b></b><span></span></span><span class="chg num"></span></div><div class="spot-price num"></div><div class="spot-chart"></div>';
    a.querySelector('.ic').replaceWith(assetIcon(s));
    a.querySelector('.nm b').textContent = m.name;
    a.querySelector('.nm span').textContent = `${s}/USD`;
    a.querySelector('.spot-chart').append(sparkline(store.sparks[s], { width: 240, height: 48 }));
    return a;
  }));
  SPOT.forEach((s) => updateSpot(s));
}
function updateSpot(symbol, prev) {
  const el = document.querySelector(`.spot[data-symbol="${symbol}"]`);
  const q = store.quotes[symbol];
  if (!el || !q) return;
  const p = el.querySelector('.spot-price');
  p.textContent = `$${fmtPrice(symbol, q.price)}`;
  flash(p, prev?.price, q.price);
  const c = el.querySelector('.chg');
  c.textContent = fmtPct(q.changePct);
  c.className = `chg num ${dirClass(q.changePct)}`;
}

// ---------------------------------------------------------------- solana
function solMarkets() { return store.markets.filter((m) => m.category === 'solana'); }

function renderEco() {
  $('eco-grid').replaceChildren(...solMarkets().map((m) => {
    const a = document.createElement('a');
    a.className = 'eco reveal in';
    a.href = `/trade?s=${m.symbol}`;
    a.dataset.symbol = m.symbol;
    a.innerHTML = '<div class="eco-top"><span class="ic"></span><span class="nm"><b></b><span></span></span></div><div class="eco-price"><b class="num"></b><span class="chg num"></span></div><div class="eco-chart"></div>';
    a.querySelector('.ic').replaceWith(assetIcon(m.symbol));
    a.querySelector('.nm b').textContent = m.symbol;
    a.querySelector('.nm span').textContent = ECO_TAG[m.symbol] || m.name;
    a.querySelector('.eco-chart').append(sparkline(store.sparks[m.symbol], { width: 200, height: 34 }));
    return a;
  }));
  solMarkets().forEach((m) => updateEco(m.symbol));
  $('sol-stat-count').textContent = solMarkets().length;
  updateSolStats();
}
function updateEco(symbol, prev) {
  const el = document.querySelector(`.eco[data-symbol="${symbol}"]`);
  const q = store.quotes[symbol];
  if (!el || !q) return;
  const p = el.querySelector('.eco-price b');
  p.textContent = `$${fmtPrice(symbol, q.price)}`;
  flash(p, prev?.price, q.price);
  const c = el.querySelector('.chg');
  c.textContent = fmtPct(q.changePct);
  c.className = `chg num ${dirClass(q.changePct)}`;
}
function updateSolStats() {
  const q = store.quotes.SOL;
  if (q) {
    $('sol-stat-price').textContent = `$${fmtPrice('SOL', q.price)}`;
    const c = $('sol-stat-chg');
    c.textContent = fmtPct(q.changePct);
    c.className = `num ${dirClass(q.changePct)}`;
  }
  const chg = solMarkets().map((m) => store.quotes[m.symbol]?.changePct).filter(Number.isFinite);
  if (chg.length) {
    const avg = chg.reduce((a, b) => a + b, 0) / chg.length;
    const e = $('sol-stat-eco');
    e.textContent = fmtPct(avg);
    e.className = `num ${dirClass(avg)}`;
  }
}

// ---------------------------------------------------------------- markets table
let mkCategory = 'all';
let mkSearch = '';
const mkRows = new Map();

function renderTabs() {
  const box = $('mk-tabs');
  box.replaceChildren(...[{ id: 'all', label: 'All' }, ...store.categories].map((c) => {
    const b = document.createElement('button');
    b.className = `pill${c.id === 'solana' ? ' sol' : ''}${c.id === mkCategory ? ' active' : ''}`;
    b.textContent = c.label;
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(c.id === mkCategory));
    b.onclick = () => { mkCategory = c.id; renderTabs(); renderTable(); };
    return b;
  }));
}

function renderTable() {
  const body = $('mk-body');
  mkRows.clear();
  const term = mkSearch.trim().toLowerCase();
  const items = store.markets.filter((m) => (mkCategory === 'all' || m.category === mkCategory)
    && (!term || m.symbol.toLowerCase().includes(term) || m.name.toLowerCase().includes(term)));
  if (!items.length) { body.innerHTML = '<div class="mk-empty">No markets match your search.</div>'; return; }
  body.replaceChildren(...items.map((m) => {
    const row = document.createElement('a');
    row.className = 'mk-row';
    row.href = `/trade?s=${m.symbol}`;
    row.innerHTML = `
      <span class="mk-asset"><span class="ic"></span><span class="nm"><b></b><span></span></span></span>
      <span class="r num mk-price"></span>
      <span class="r"><span class="chg num"></span></span>
      <span class="r hide-md"><span class="mk-spark"></span></span>
      <span class="r hide-sm"><span class="range"><span class="range-bar"><i></i></span><span class="range-lbl num"><span class="lo"></span><span class="hi"></span></span></span></span>
      <span class="r hide-sm"><span class="badge lev">${store.trading.maxLeverage}x</span></span>
      <span class="r"><span class="btn btn-sm">Trade</span></span>`;
    row.querySelector('.ic').replaceWith(assetIcon(m.symbol));
    row.querySelector('.nm b').textContent = m.name;
    row.querySelector('.nm span').textContent = `${m.symbol}/USD${m.unit ? ` · per ${m.unit}` : ''}`;
    row.querySelector('.mk-spark').append(sparkline(store.sparks[m.symbol], { width: 110, height: 32, fill: false }));
    mkRows.set(m.symbol, row);
    updateRow(m.symbol);
    return row;
  }));
}

function updateRow(symbol, prev) {
  const row = mkRows.get(symbol);
  const q = store.quotes[symbol];
  if (!row || !q) return;
  const price = row.querySelector('.mk-price');
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
}
$('mk-search').addEventListener('input', (e) => { mkSearch = e.target.value; renderTable(); });

// ---------------------------------------------------------------- boot
(async () => {
  renderNav();
  await loadMarkets();
  $('stat-markets').textContent = store.markets.length;
  initHero();
  renderTicker();
  renderMovers();
  renderTabs();
  await loadSparklines();
  renderSpot();
  renderEco();
  renderTable();
  revealOnScroll();
  connectLive();

  let moversDue = false;
  onQuotes((changes) => {
    for (const { q, prev } of changes) {
      updateRow(q.symbol, prev);
      updateTicker(q.symbol);
      updateSpot(q.symbol, prev);
      updateEco(q.symbol, prev);
      if (q.symbol === 'SOL') updateHero(prev);
    }
    updateSolStats();
    moversDue = true;
  });
  setInterval(() => { if (moversDue) { moversDue = false; renderMovers(); } }, 3000);

  // sparklines arrive in the background on a fresh server start: retry once if empty
  if (!Object.keys(store.sparks).length) {
    setTimeout(async () => { await loadSparklines(); renderSpot(); renderEco(); renderTable(); }, 8000);
  }
})();

// 3D Solana scene — lazy-load when the section approaches the viewport.
const stage = $('sol-stage');
new IntersectionObserver(async ([e], io) => {
  if (!e.isIntersecting) return;
  io.disconnect();
  try {
    await document.fonts.ready;
    const { mountSolanaScene } = await import('./solana3d.js');
    mountSolanaScene(stage);
  } catch (err) {
    console.warn('3D scene unavailable', err);
  }
}, { rootMargin: '400px' }).observe(stage);
