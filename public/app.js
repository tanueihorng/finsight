/* ===========================================================================
   FINSIGHT // PERSONAL TERMINAL  —  frontend logic
   =========================================================================== */
'use strict';

// One-time migration of saved prefs from the old name (fincept-*) to finsight-*.
try {
  ['profile', 'base', 'cards', 'account'].forEach((k) => {
    const old = localStorage.getItem('fincept-' + k);
    if (old != null && localStorage.getItem('finsight-' + k) == null) localStorage.setItem('finsight-' + k, old);
  });
} catch {}

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
// A network error (server stopped) re-checks once, which shows the offline screen.
let netCheckPending = false;
const onNetError = (e) => {
  if (!netCheckPending && typeof checkAuth === 'function') { netCheckPending = true; setTimeout(() => { netCheckPending = false; checkAuth(); }, 1500); }
  throw e;
};
const api = (path, opts) => fetch(path, opts).catch(onNetError).then(async (r) => {
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && !path.startsWith('/api/auth')) showLock('enter'); // session expired -> re-lock
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
});

// ---- formatting helpers ----------------------------------------------------
const fmt = (n, d = 2) => (n == null || Number.isNaN(n)) ? '—'
  : Number(n).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtBig = (n) => {
  if (n == null || Number.isNaN(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1e12) return (n / 1e12).toFixed(2) + 'T';
  if (a >= 1e9)  return (n / 1e9).toFixed(2) + 'B';
  if (a >= 1e6)  return (n / 1e6).toFixed(2) + 'M';
  if (a >= 1e3)  return (n / 1e3).toFixed(2) + 'K';
  return fmt(n);
};
const signClass = (n) => n > 0 ? 'up' : n < 0 ? 'down' : '';
const signStr = (n, d = 2) => (n == null ? '—' : (n > 0 ? '+' : '') + fmt(n, d));

// ---- currency formatting ----
const CCY_SYM = { USD: '$', SGD: 'S$', EUR: '€', GBP: '£', JPY: '¥', HKD: 'HK$', AUD: 'A$', CNY: '¥', INR: '₹', CAD: 'C$', CHF: 'CHF ' };
const csym = (c) => CCY_SYM[(c || '').toUpperCase()] || ((c || '') + ' ');
const money = (c, n, d = 2) => (n == null || Number.isNaN(n)) ? '—' : csym(c) + fmt(n, d);
const moneyBig = (c, n) => (n == null || Number.isNaN(n)) ? '—' : csym(c) + fmtBig(n);
const moneySigned = (c, n, d = 2) => (n == null || Number.isNaN(n)) ? '—' : (n < 0 ? '-' : '+') + csym(c) + fmt(Math.abs(n), d);

// Reads always use the current store snapshot; top-level writes notify React.
const state = window.FinSight.legacyState;
let accountsCache = [];

// ===========================================================================
//  COMMAND BAR
// ===========================================================================
function setStatus(msg, kind = '') { const el = $('#cmd-status'); el.textContent = msg; el.className = 'cmd-status ' + kind; }
function setFooter(msg) { $('#footer-msg').textContent = msg; }

async function runCommand(raw) {
  const text = raw.trim();
  if (!text) return;
  const parts = text.split(/\s+/);
  const cmd = parts[0].toUpperCase();
  try {
    if (cmd === 'HELP' || cmd === '?') {
      setStatus('ADD <s> <qty> <px> [date] · SELL <s> <qty> [px] · DEL <s> · UNDO · LEDGER · CASH <ccy> <amt> · WHT <mkt> <%> · Q <s> · WATCH/UNWATCH <s> · ALERT <s> > <px> · NEWS [s] · MKT · CLEAR', 'ok');
      return;
    }
    if (cmd === 'ADD' || cmd === 'BUY') {
      const [, sym, qty, price, date] = parts; // date optional: ADD AAPL 10 195.50 2024-01-15
      if (!sym || !qty || !price) return setStatus('Usage: ADD <symbol> <qty> <avg price> [YYYY-MM-DD]   e.g. ADD AAPL 10 195.50', 'err');
      if (blockIfAll()) return;
      await api('/api/portfolio/buy' + baseQS(), { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: sym, quantity: qty, price, date: date || null }) });
      setStatus(`BOUGHT ${qty} ${sym.toUpperCase()} @ ${price}${date ? ' on ' + date : ''}`, 'ok');
      await afterWrite('buy'); return;
    }
    if (cmd === 'SELL') {
      const [, sym, qty, price] = parts;
      if (!sym || !qty) return setStatus('Usage: SELL <symbol> <qty> [price]   (price optional → uses market)', 'err');
      const res = await api('/api/portfolio/sell' + baseQS(), { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: sym, quantity: qty, price: price ?? null }) });
      const r = res.lastRealized;
      setStatus(`SOLD ${qty} ${sym.toUpperCase()}  ·  realized ${signStr(r)} `, r >= 0 ? 'ok' : 'err');
      await afterWrite('sell'); return;
    }
    if (cmd === 'DEL' || cmd === 'DELETE' || cmd === 'REMOVE') {
      const sym = parts[1];
      if (!sym) return setStatus('Usage: DEL <symbol>', 'err');
      await api('/api/portfolio/delete' + baseQS(), { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: sym }) });
      setStatus(`REMOVED ${sym.toUpperCase()} from portfolio`, 'ok');
      await afterWrite('delete'); return;
    }
    if (cmd === 'Q' || cmd === 'QUOTE') {
      const sym = parts[1];
      if (!sym) return setStatus('Usage: Q <symbol>', 'err');
      selectSymbol(sym.toUpperCase()); setStatus(`Loading ${sym.toUpperCase()}…`, 'ok'); return;
    }
    if (cmd === 'WATCH') {
      const sym = parts[1];
      if (!sym) return setStatus('Usage: WATCH <symbol>', 'err');
      await api('/api/watchlist/add', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ symbol: sym }) });
      setStatus(`Watching ${sym.toUpperCase()}`, 'ok'); afterWrite('watchlist-add'); return;
    }
    if (cmd === 'UNWATCH') {
      const sym = parts[1];
      if (!sym) return setStatus('Usage: UNWATCH <symbol>', 'err');
      await api('/api/watchlist/remove', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ symbol: sym }) });
      setStatus(`Unwatched ${sym.toUpperCase()}`, 'ok'); afterWrite('watchlist-remove'); return;
    }
    if (cmd === 'ALERT') {
      const sym = parts[1], op = parts[2], price = parts[3];
      if (!sym || !op || !price) return setStatus('Usage: ALERT <symbol> > <price>   (use > or <)', 'err');
      const o = (op.includes('<') || /below|under/i.test(op)) ? '<' : '>';
      await api('/api/alerts/add', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ symbol: sym, op: o, price }) });
      setStatus(`Alert set: ${sym.toUpperCase()} ${o} ${price}`, 'ok'); afterWrite('alerts-add'); requestNotify(); return;
    }
    if (cmd === 'NEWS') {
      const sym = parts[1];
      if (sym) { selectSymbol(sym.toUpperCase()); } else { loadNews(''); }
      setStatus('Loading news…', 'ok'); return;
    }
    if (cmd === 'UNDO') { await doUndo(); return; }
    if (cmd === 'LEDGER' || cmd === 'TRADES') { openLedger(); return; }
    if (cmd === 'CASH') {
      const [, ccy, amt] = parts;
      if (!ccy || amt == null) return setStatus('Usage: CASH <currency> <amount>   e.g. CASH USD 5000   (0 clears it)', 'err');
      if (blockIfAll()) return;
      await setCashBalance(ccy, amt); return;
    }
    if (cmd === 'WHT') {
      const [, mkt, pct] = parts;
      if (!mkt || pct == null) return setStatus('Usage: WHT <US|SG|HK|UK|EU|JP|AU|CA|OTHER> <percent>   e.g. WHT US 15', 'err');
      await api('/api/settings/withholding', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ market: mkt, pct }) });
      setStatus(`Dividend withholding for ${mkt.toUpperCase()} set to ${pct}%`, 'ok'); afterWrite('withholding'); return;
    }
    if (cmd === 'MKT' || cmd === 'MARKETS') { window.FinSight.bus.invalidate('markets'); setStatus('Refreshing world markets…', 'ok'); return; }
    if (cmd === 'CLEAR') { setStatus(''); return; }
    // Bare symbol → quote it
    selectSymbol(cmd); setStatus(`Loading ${cmd}…`, 'ok');
  } catch (e) {
    setStatus('ERROR: ' + e.message, 'err');
  }
}
$('#cmd-go').addEventListener('click', () => { runCommand($('#cmd').value); $('#cmd').value = ''; });
$('#cmd').addEventListener('keydown', (e) => { if (e.key === 'Enter') { runCommand($('#cmd').value); $('#cmd').value = ''; } });

// ===========================================================================
//  PORTFOLIO
// ===========================================================================
const baseQS = (extra = '') => `?base=${encodeURIComponent(state.base)}&account=${encodeURIComponent(state.account || '')}${extra}`;

// Holdings changes invalidate income and FX queries; their 120s polling is owned
// by Query. (Chart trade markers refresh on the 'chart-trades' key since E2.)
let dividendSig = ''; // B3: separate holdings refresh from Query's 120s timer
let portfolioRequest = 0;
async function loadPortfolio() {
  const request = ++portfolioRequest, query = baseQS();
  try {
    const data = await api('/api/portfolio' + query);
    if (request !== portfolioRequest || query !== baseQS()) return;
    renderPortfolio(data);
    const sig = state.account + '|' + state.base + '|' + (data.positions || []).map((p) => p.symbol + ':' + p.quantity).join(',') + '|' + JSON.stringify(data.cash || []);
    if (sig !== dividendSig) {
      const hadPrevious = !!dividendSig; dividendSig = sig;
      if (hadPrevious) { window.FinSight.bus.invalidate('dividends'); window.FinSight.bus.invalidate('fx-risk'); }
    }
  } catch (e) { if (request === portfolioRequest && query === baseQS()) setFooter('Portfolio load failed: ' + e.message); }
}

// Every completed write refreshes all readers of what it changed (COUPLING.md
// §A6, web/src/api/invalidation.ts). Islands refetch through Query; legacy
// readers registered here refresh themselves.
function afterWrite(kind) { return window.FinSight.bus.write(kind); }
window.FinSight.bus.on('portfolio', () => loadPortfolio());
window.FinSight.bus.on('accounts', () => loadAccounts());

function renderPortfolio(data) {
  const { positions } = data;
  const base = data.base || state.base;
  // FX coverage note
  if (data.fxMissing && data.fxMissing.length) setFooter(`Note: no FX rate for ${data.fxMissing.join(', ')} → shown unconverted.`);

  // Every panel is a React island now. The chart watch feed (chartWatchItems)
  // still reads the holdings from lastTableData until X1.
  lastTableData = { positions, base };
  pushChartWatch();
}

// FX risk is a React island (C2).

// Calendar is a React island (A3).

// ---- customizable summary cards --------------------------------------------
// Summary cards are a React island (web/src/features/summary, PILOT-2).
// ---- PEEK / UNPEEK: blur personal figures, keep public market data ----------
// Purely visual (CSS on body.unpeek) so screen-sharing is safe; nothing is removed from the page.

function applyPeek() {
  document.body.classList.toggle('unpeek', !state.peek);
  const b = $('#peek-btn');
  if (b) { b.textContent = !state.peek ? '◌ PEEK' : '◉ UNPEEK'; b.classList.toggle('active', !state.peek); }
}
$('#peek-btn').addEventListener('click', () => {
  state.peek = !state.peek;
  try { localStorage.setItem('finsight-unpeek', !state.peek ? '1' : '0'); } catch {}
  applyPeek();
});
applyPeek();

// ---- appearance: switchable theme + font (system fonts only, no downloads) ----
const THEMES = [
  { id: 'violet',   label: 'Violet',   accent: '#a78bfa' },
  { id: 'amber',    label: 'Amber',    accent: '#ff9e16' },
  { id: 'teal',     label: 'Teal',     accent: '#2dd4bf' },
  { id: 'phosphor', label: 'Phosphor', accent: '#4ade80' },
];
const FONTS = [
  { id: 'mono', label: 'Mono' },
  { id: 'sans', label: 'Sans' },
  { id: 'slab', label: 'Serif' },
];
let curTheme = localStorage.getItem('finsight-theme') || 'violet';
let curFont  = localStorage.getItem('finsight-font')  || 'mono';
function applyTheme() { document.documentElement.dataset.theme = curTheme; document.documentElement.dataset.font = curFont; }
function setTheme(id) {
  curTheme = id; localStorage.setItem('finsight-theme', id); applyTheme();
  renderAppearance(); allCharts().forEach((c) => c.render()); // repaint canvas charts with the new colours
}
function setFont(id) { curFont = id; localStorage.setItem('finsight-font', id); applyTheme(); renderAppearance(); }
function renderAppearance() {
  const tl = $('#theme-list'); if (tl) tl.innerHTML = THEMES.map((t) =>
    `<button class="swatch ${t.id === curTheme ? 'on' : ''}" data-theme="${t.id}"><span class="dot" style="background:${t.accent}"></span>${t.label}</button>`).join('');
  const fl = $('#font-list'); if (fl) fl.innerHTML = FONTS.map((f) =>
    `<button class="font-btn ${f.id === curFont ? 'on' : ''}" data-font="${f.id}">${f.label}</button>`).join('');
}
$('#theme-list')?.addEventListener('click', (e) => { const b = e.target.closest('[data-theme]'); if (b) setTheme(b.dataset.theme); });
$('#font-list')?.addEventListener('click', (e) => { const b = e.target.closest('[data-font]'); if (b) setFont(b.dataset.font); });
applyTheme(); // also re-assert on script load (head script already set it pre-paint)

$('#cards-btn').addEventListener('click', () => { renderAppearance(); renderPanelsEditor(); $('#cards-modal').classList.remove('hidden'); });
$('#cards-close').addEventListener('click', () => $('#cards-modal').classList.add('hidden'));
$('#cards-done').addEventListener('click', () => $('#cards-modal').classList.add('hidden'));
$('#cards-modal').addEventListener('click', (e) => { if (e.target.id === 'cards-modal') $('#cards-modal').classList.add('hidden'); });
// Card prefs, the card list and RESET TO DEFAULT belong to the summary islands (PILOT-2).

// ---- show / hide whole panels ----------------------------------------------
const PANELS = [
  ['perf-body', 'Performance'], ['alloc-body', 'Allocation'], ['heatmap-body', 'Sector Heatmap'],
  ['fxrisk', 'FX Risk'], ['dividends', 'Dividends'], ['watchlist', 'Watchlist'], ['alerts', 'Price Alerts'], ['activity', 'Recent Activity'],
  ['news', 'News'], ['markets', 'World Markets'], ['calendar', 'Econ Calendar'], ['wb-body', 'World Bank'], ['fred-body', 'US Fed (FRED)'], ['infl-body', 'US Inflation Gauges'],
];
let hiddenPanels = (() => { try { return new Set(JSON.parse(localStorage.getItem('finsight-panels')) || []); } catch { return new Set(); } })();
const panelEl = (id) => { const e = document.getElementById(id); return e ? e.closest('.panel') : null; };
function applyPanels() { PANELS.forEach(([id]) => { const el = panelEl(id); if (el) el.style.display = hiddenPanels.has(id) ? 'none' : ''; }); }
function renderPanelsEditor() {
  $('#panels-list').innerHTML = PANELS.map(([id, label]) => {
    const on = !hiddenPanels.has(id);
    return `<div class="card-edit-row ${on ? '' : 'off'}"><label><input type="checkbox" data-panel="${id}" ${on ? 'checked' : ''}> ${label}</label></div>`;
  }).join('');
}
$('#panels-list').addEventListener('change', (e) => {
  const cb = e.target.closest('input[data-panel]'); if (!cb) return;
  if (cb.checked) hiddenPanels.delete(cb.dataset.panel); else hiddenPanels.add(cb.dataset.panel);
  localStorage.setItem('finsight-panels', JSON.stringify([...hiddenPanels]));
  applyPanels(); renderPanelsEditor();
});

// ---- drag-to-rearrange panels ----------------------------------------------
// Each panel is tagged with a stable pid (via a known child element) so its
// position can be saved/restored; a ⠿ grip in the header is the drag handle.
const PANEL_PIDS = [
  ['#positions-view', 'positions'], ['#wealth-body', 'wealth'], ['#perf-body', 'performance'], ['#alloc-body', 'allocation'],
  ['#heatmap-body', 'heatmap'], ['#fxrisk', 'fxrisk'], ['#dividends', 'dividends'], ['#watchlist', 'watchlist'], ['#alerts', 'alerts'], ['#activity', 'activity'],
  ['#detail-panel', 'detail'], ['#agent-dock', 'kestrel'], ['#news', 'news'], ['#markets', 'markets'], ['#calendar', 'calendar'], ['#wb-body', 'worldbank'], ['#fred-body', 'fred'], ['#infl-body', 'inflation'],
];
let dragInited = false;
function initDragLayout() {
  if (dragInited) return; dragInited = true;
  PANEL_PIDS.forEach(([sel, pid]) => {
    const el = document.querySelector(sel); if (!el) return;
    const panel = el.classList.contains('panel') ? el : el.closest('.panel');
    const head = panel && panel.querySelector('.panel-head');
    if (!panel || !head) return;
    panel.dataset.pid = pid; panel.classList.add('draggable-block');
    if (head.querySelector('.drag-grip')) return;
    const grip = document.createElement('span');
    grip.className = 'drag-grip'; grip.textContent = '⠿'; grip.title = 'Drag to rearrange';
    grip.setAttribute('draggable', 'true');
    grip.addEventListener('dragstart', (e) => {
      panel.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', pid); e.dataTransfer.setDragImage(panel, 12, 12); } catch {}
    });
    grip.addEventListener('dragend', () => {
      panel.classList.remove('dragging');
      document.querySelectorAll('.drop-on').forEach((c) => c.classList.remove('drop-on'));
      saveLayout();
    });
    head.insertBefore(grip, head.firstChild);
  });
  ['.col-left', '.col-right'].forEach((csel) => {
    const col = document.querySelector(csel); if (!col) return;
    col.addEventListener('dragover', (e) => {
      const dragging = document.querySelector('.panel.dragging'); if (!dragging) return;
      e.preventDefault(); col.classList.add('drop-on');
      const after = dragAfter(col, e.clientY);
      if (after == null) col.appendChild(dragging); else col.insertBefore(dragging, after);
    });
    col.addEventListener('dragleave', (e) => { if (!col.contains(e.relatedTarget)) col.classList.remove('drop-on'); });
    col.addEventListener('drop', (e) => e.preventDefault());
  });
}
function dragAfter(col, y) {
  const els = [...col.querySelectorAll(':scope > .panel.draggable-block:not(.dragging)')].filter((el) => el.offsetParent !== null);
  let best = null, bestOff = -Infinity;
  for (const el of els) {
    const box = el.getBoundingClientRect();
    const off = y - box.top - box.height / 2;
    if (off < 0 && off > bestOff) { bestOff = off; best = el; }
  }
  return best;
}
function saveLayout() {
  const read = (csel) => [...document.querySelectorAll(`${csel} > .panel.draggable-block`)].map((p) => p.dataset.pid);
  localStorage.setItem('finsight-layout', JSON.stringify({ left: read('.col-left'), right: read('.col-right') }));
}
function applyLayout() {
  let saved; try { saved = JSON.parse(localStorage.getItem('finsight-layout')); } catch {}
  if (!saved) return;
  [['left', '.col-left'], ['right', '.col-right']].forEach(([side, csel]) => {
    const col = document.querySelector(csel); if (!col) return;
    (saved[side] || []).forEach((pid) => {
      const panel = document.querySelector(`.panel.draggable-block[data-pid="${pid}"]`);
      if (panel) col.appendChild(panel); // append in saved order (also moves across columns)
    });
  });
}
$('#layout-reset').addEventListener('click', () => { localStorage.removeItem('finsight-layout'); location.reload(); });

// ---- profile + first-launch setup wizard -----------------------------------
let profile = (() => { try { return JSON.parse(localStorage.getItem('finsight-profile')) || {}; } catch { return {}; } })();
function saveProfile() { localStorage.setItem('finsight-profile', JSON.stringify(profile)); }
function applyProfileName() { $('#profile-name').textContent = profile.name ? profile.name.split(' ')[0] : 'Profile'; }
function openSetup() {
  $('#setup-name').value = profile.name || '';
  $('#setup-base').value = state.base;
  $('#setup-modal').classList.remove('hidden');
  $('#setup-name').focus();
}
function commitSetup() {
  profile.name = $('#setup-name').value.trim();
  profile.base = $('#setup-base').value;
  profile.setupDone = true;
  saveProfile();
  if (profile.base && profile.base !== state.base) {
    state.base = profile.base; localStorage.setItem('finsight-base', state.base); $('#base-ccy').value = state.base;
    loadPortfolio();
  }
  applyProfileName();
}
$('#profile-btn').addEventListener('click', openSetup);
$('#setup-skip').addEventListener('click', () => { profile.setupDone = true; saveProfile(); $('#setup-modal').classList.add('hidden'); });
$('#setup-save').addEventListener('click', () => { commitSetup(); $('#setup-modal').classList.add('hidden'); });
document.querySelector('.setup-choices').addEventListener('click', (e) => {
  const c = e.target.closest('.setup-choice'); if (!c) return;
  commitSetup();
  $('#setup-modal').classList.add('hidden');
  const a = c.dataset.action;
  if (a === 'import') state.importOpen = true; // the D4 island opens the import modal
  else if (a === 'manual') state.addFormOpen = true; // the D2 island opens and focuses the form
  setStatus(profile.name ? `Welcome, ${profile.name}.` : 'Terminal ready.', 'ok');
});

// ---- POSITIONS TABLE: React island (D1, web/src/features/positions) ----------
// lastTableData feeds the chart watch list (chartWatchItems) until X1.
let lastTableData = { positions: [], base: 'SGD' };

// ===========================================================================
//  UNDO + CASH
// ===========================================================================
// Undo, CASH and the cash editor are TypeScript (D3, web/src/features/cash).
// These names stay for the command bar and the ledger's ↶ until F7/D4.
function doUndo() { return window.FinSight.actions.undo(); }
function setCashBalance(ccy, amt) { return window.FinSight.actions.setCashBalance(ccy, amt); }
function openCashEditor() { state.cashEditorOpen = true; }
$('#undo-btn').addEventListener('click', doUndo);
$('#undo-btn').addEventListener('mouseenter', async () => {
  const title = await window.FinSight.actions.undoTitle(); if (title) $('#undo-btn').title = title;
});
$('#cash-btn').addEventListener('click', openCashEditor);
$('#wealth-cash-btn').addEventListener('click', openCashEditor);
// The NET WORTH / CASH cards open the editor too.
$('#summary').addEventListener('click', (e) => {
  if (e.target.closest('[data-cash-card]')) openCashEditor();
});

// ===========================================================================
//  LEDGER — every trade; fix buys; realized gains by year
// ===========================================================================
// The ledger modal is a React island (D4, web/src/features/ledger). openLedger
// stays for the LEDGER/TRADES commands until F7.
function openLedger() { state.ledgerOpen = true; }
$('#ledger-btn').addEventListener('click', openLedger);

// ===========================================================================
//  ADD FORM + SYMBOL SEARCH
// ===========================================================================
// The add form and symbol search are a React island (D2, web/src/features/addform).
$('#add-toggle').addEventListener('click', () => { state.addFormOpen = !state.addFormOpen; });

// ===========================================================================
//  SECURITY DETAIL + CHART
// ===========================================================================
// The detail header, stats, ranges and chart host are a React island (E1+E2,
// web/src/features/detail, web/src/legacy/ChartHost.tsx). selectSymbol stays
// global for its callers; the island follows store.selected.
function selectSymbol(symbol) {
  state.selected = symbol; // the positions island highlights the row from the store
  // A2 bridge: same-symbol selection exits NEWS's market override and refreshes.
  // Keep this notification through E1 until F7 owns the command callers.
  window.FinSight.bus.invalidate('news-selected');
  window.FinSight.bus.invalidate('detail'); // the same symbol again refreshes the detail
}
// ---- chart host hooks: ledger trades, watchlist feed, multi-chart grid ----
let lastWatch = [];
// B1 adapter: E2 replaces this legacy chart feed after the lanes integrate.
window.FinSightLegacy = { ...window.FinSightLegacy, setChartWatch(list) { lastWatch = list || []; pushChartWatch(); } };
function chartWatchItems() {
  const held = (lastTableData.positions || []).filter((p) => p.quoted !== false);
  const seen = new Set();
  const items = [];
  held.forEach((p) => { if (seen.has(p.symbol)) return; seen.add(p.symbol); items.push({ symbol: p.symbol, name: p.name, price: p.last, changePct: p.changePct, group: 'Holdings' }); });
  (lastWatch || []).forEach((w) => { if (w.error || seen.has(w.symbol)) return; seen.add(w.symbol); items.push({ symbol: w.symbol, name: w.name, price: w.price, changePct: w.changePct, group: 'Watchlist' }); });
  return items;
}
function allCharts() { return chartGrid && chartGrid.active() ? chartGrid.charts() : (detailChart ? [detailChart] : []); }
function pushChartWatch() { const items = chartWatchItems(); allCharts().forEach((c) => c.setWatchlist(items)); }
async function loadChartTrades(chart, symbol) {
  try {
    const d = await api(`/api/chart-trades?symbol=${encodeURIComponent(symbol)}&account=${encodeURIComponent(state.account || '')}`);
    chart.setTrades(symbol, d);
  } catch { /* trades are an overlay; the chart works without them */ }
}
function setupChartHost(chart) {
  chart.onTrades = (sym) => loadChartTrades(chart, sym);
  chart.setWatchlist(chartWatchItems());
}
const chartGrid = window.ChartGrid ? new ChartGrid({
  loader: (sym, iv, range) => api(`/api/history?symbol=${encodeURIComponent(sym)}&range=${range}&interval=${iv}`),
  onMainSymbol: (sym) => selectSymbol(sym),
  setupChart: (c) => setupChartHost(c),
}) : null;

// ChartHost (the detail island) calls these: the watch feed (B1), trade
// markers and the multi-chart grid stay here, on window.detailChart. It is
// null until the island mounts; allCharts() reads it by its bare name.
window.detailChart = null;
window.FinSightChartHooks = {
  attached(chart) { setupChartHost(chart); if (chartGrid) chartGrid.attach(chart); },
  loaded() { if (chartGrid) chartGrid.syncSymbols(); },
  trades(chart, symbol) { return loadChartTrades(chart, symbol); },
  detached() { if (chartGrid && chartGrid.active()) chartGrid.set({ n: 1 }); },
};


// ===========================================================================
//  WORLD MARKETS
// ===========================================================================
// World Markets is a React island (web/src/features/markets, PILOT-1).

// ===========================================================================
//  WORLD BANK MACRO
// ===========================================================================
// World Bank, FRED and inflation are React islands (A3).

// ===========================================================================
//  DIVIDENDS (income received, from broker imports)
// ===========================================================================
// Command/test adapter until F7; B3 owns the account-keyed query.
function loadDividends() { return window.FinSight.bus.invalidate('dividends'); }

// ===========================================================================
//  WATCHLIST
// ===========================================================================
// Command adapter until F7; the watchlist query owns loading and polling.
function loadWatchlist() { return window.FinSight.bus.invalidate('watchlist'); }

// ===========================================================================
//  PRICE ALERTS + NOTIFICATIONS
// ===========================================================================
// Alerts are a React island. Keep command permission/refresh adapters until F7.
function loadAlerts() { return window.FinSight.bus.invalidate('alerts'); }
function requestNotify() {
  if ('Notification' in window && Notification.permission === 'default') { try { Notification.requestPermission(); } catch {} }
}

// ===========================================================================
//  NEWS
// ===========================================================================
// Command-bar adapter until F7; the island owns rendering and requests.
function loadNews(symbol) {
  return window.FinSight.bus.invalidate(symbol ? 'news-selected' : 'news-market');
}

// ===========================================================================
//  CSV IMPORT / EXPORT
// ===========================================================================
// The import modal is a React island and EXPORT a TypeScript action (D4).
$('#import-btn').addEventListener('click', () => { state.importOpen = true; });
$('#export-btn').addEventListener('click', () => window.FinSight.actions.exportPortfolio());


// ===========================================================================
//  PORTFOLIO ANALYTICS: performance, net worth, allocation and heatmap are
//  React islands (C3, web/src/features/analytics).
// ===========================================================================

// ===========================================================================
//  UTIL + BOOT + POLLING
// ===========================================================================
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// CSV cell: quote when needed and neutralise spreadsheet formula characters
// (= + - @) the same way the journal CSV export does (lib/journal.js toCsv).
const csvCell = (v) => { if (typeof v === 'number') return String(v); const s = v == null ? '' : String(v); return /[",\n]/.test(s) || /^[=+\-@]/.test(s) ? '"' + s.replace(/"/g, '""').replace(/^([=+\-@])/, "'$1") + '"' : s; };

// base-currency selector
function initBaseSelector() {
  const sel = $('#base-ccy');
  sel.value = state.base;
  sel.addEventListener('change', () => {
    state.base = sel.value.toUpperCase();
    localStorage.setItem('finsight-base', state.base);
    setStatus(`Base currency → ${state.base}. Converting…`, 'ok');
    loadPortfolio();
  });
}

// ===========================================================================
//  ACCOUNTS (multiple portfolios)
// ===========================================================================
function blockIfAll() {
  if (state.account === 'ALL') { setStatus('Switch from "All Accounts" to a specific account to add or trade.', 'err'); return true; }
  return false;
}
async function loadAccounts(selectId) {
  try {
    const d = await api('/api/accounts');
    accountsCache = d.accounts || [];
    if (selectId) state.account = selectId;
    const exists = (id) => id === 'ALL' || accountsCache.some((a) => a.id === id);
    if (!exists(state.account)) state.account = exists(localStorage.getItem('finsight-account')) ? localStorage.getItem('finsight-account') : d.activeId;
    localStorage.setItem('finsight-account', state.account);
    renderAccountSelector();
    state.accountReady = true;
  } catch {}
}
function renderAccountSelector() {
  const sel = $('#account-sel');
  if (!sel) return;
  sel.innerHTML = ['<option value="ALL">All Accounts</option>']
    .concat(accountsCache.map((a) => `<option value="${esc(a.id)}">${esc(a.name)}${a.count ? ` (${a.count})` : ''}</option>`))
    .concat(['<option value="__new">＋ New account…</option>', '<option value="__manage">⚙ Manage…</option>'])
    .join('');
  sel.value = state.account;
}
$('#account-sel').addEventListener('change', async () => {
  const v = $('#account-sel').value;
  if (v === '__new') { $('#account-sel').value = state.account; return newAccountPrompt(); }
  if (v === '__manage') { $('#account-sel').value = state.account; renderAccountsList(); return $('#accounts-modal').classList.remove('hidden'); }
  state.account = v; localStorage.setItem('finsight-account', v);
  await loadPortfolio();
});
async function newAccountPrompt() {
  const name = (prompt('New account name (e.g. Crypto, SGX, IBKR):') || '').trim();
  if (!name) return;
  try {
    const d = await api('/api/accounts/add', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
    accountsCache = d.accounts; state.account = d.newId; localStorage.setItem('finsight-account', d.newId);
    renderAccountSelector(); await loadPortfolio(); setStatus(`Account "${name}" created.`, 'ok');
  } catch (e) { setStatus('Create failed: ' + e.message, 'err'); }
}
function setAccountsStatus(m, k) { const el = $('#accounts-status'); el.textContent = m; el.className = 'cmd-status ' + (k || ''); }
function renderAccountsList() {
  $('#accounts-list').innerHTML = accountsCache.map((a) => `<div class="card-edit-row">
    <label>${esc(a.name)} <span class="muted small">${a.type ? esc(a.type) + ' · ' : ''}${a.count} holdings</span></label>
    <span class="ce-move"><button class="acct-rename" data-id="${esc(a.id)}">Rename</button><button class="acct-del" data-id="${esc(a.id)}">Delete</button></span>
  </div>`).join('');
}
$('#accounts-close').addEventListener('click', () => $('#accounts-modal').classList.add('hidden'));
$('#accounts-done').addEventListener('click', () => $('#accounts-modal').classList.add('hidden'));
$('#accounts-modal').addEventListener('click', (e) => { if (e.target.id === 'accounts-modal') $('#accounts-modal').classList.add('hidden'); });
$('#account-add-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('#account-new-name').value.trim(); if (!name) return;
  try {
    const d = await api('/api/accounts/add', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, type: $('#account-new-type').value.trim() }) });
    accountsCache = d.accounts; $('#account-new-name').value = ''; $('#account-new-type').value = '';
    renderAccountsList(); renderAccountSelector(); setAccountsStatus(`Added "${name}".`, 'ok');
  } catch (err) { setAccountsStatus(err.message, 'err'); }
});
$('#accounts-list').addEventListener('click', async (e) => {
  const ren = e.target.closest('.acct-rename'), del = e.target.closest('.acct-del');
  if (ren) {
    const a = accountsCache.find((x) => x.id === ren.dataset.id);
    const name = prompt('Rename account:', a ? a.name : ''); if (name == null) return;
    try { const d = await api('/api/accounts/rename', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: ren.dataset.id, name }) }); accountsCache = d.accounts; renderAccountsList(); renderAccountSelector(); }
    catch (err) { setAccountsStatus(err.message, 'err'); }
  } else if (del) {
    const a = accountsCache.find((x) => x.id === del.dataset.id);
    if (!confirm(`Delete account "${a ? a.name : ''}" and all its holdings?`)) return;
    try {
      const d = await api('/api/accounts/remove', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: del.dataset.id }) });
      accountsCache = d.accounts;
      if (state.account === del.dataset.id) { state.account = d.activeId; localStorage.setItem('finsight-account', state.account); }
      renderAccountsList(); renderAccountSelector(); await afterWrite('account-remove');
    } catch (err) { setAccountsStatus(err.message, 'err'); }
  }
});

async function boot() {
  initBaseSelector();
  initDragLayout();
  applyLayout();
  applyPanels();
  await loadAccounts();
  applyProfileName();
  if (!profile.setupDone) openSetup(); // first-launch wizard
  await loadPortfolio();
  setFooter(`READY · base ${state.base} · live data refreshing every 15s`);
  startPolling();
}
// Live polling, startable/stoppable so it pauses while the app is locked (otherwise
// each poll 401s and re-triggers the lock screen, wiping the PIN being typed).
let pollTimers = [];
// Polling also pauses while the tab or installed app is hidden and catches up
// on return; price alerts keep firing from the server's own timer meanwhile.
let pollWanted = false, hiddenAt = 0;
function startPolling() {
  pollWanted = true;
  stopTimers();
  if (document.hidden) return;
  pollTimers.push(
    setInterval(loadPortfolio, 15000),
    // macro panels change slowly — auto-refresh every 15 min (the LOAD buttons still work)
  );
}
function stopTimers() { pollTimers.forEach(clearInterval); pollTimers = []; }
function stopPolling() { pollWanted = false; stopTimers(); }
document.addEventListener('visibilitychange', () => {
  if (!pollWanted) return;
  if (document.hidden) { hiddenAt = Date.now(); stopTimers(); return; }
  // back in view: refresh what went stale, then resume the timers
  if (Date.now() - hiddenAt > 10000) {
    loadPortfolio(); window.FinSight.bus.invalidate('markets'); window.FinSight.bus.invalidate('watchlist'); window.FinSight.bus.invalidate('alerts');
    window.FinSight.bus.invalidate('quote'); // the detail island re-reads the quote
    if (Date.now() - hiddenAt > 15 * 60000) { window.FinSight.bus.invalidate('worldbank'); window.FinSight.bus.invalidate('fred'); window.FinSight.bus.invalidate('calendar'); window.FinSight.bus.invalidate('events'); }
  }
  startPolling();
});
// ===========================================================================
//  PIN LOCK
// ===========================================================================
let booted = false, lockMode = 'enter';
function showLock(mode) {
  const wasLocked = document.body.classList.contains('locked');
  lockMode = mode;
  document.body.classList.add('locked');
  stopPolling(); // no background 401s while locked
  window.FinSight.auth.lock();
  $('#lock-title').textContent = mode === 'create' ? 'Create a PIN (4–12 digits)' : 'Enter your PIN';
  $('#lock-pin2').classList.toggle('hidden', mode !== 'create');
  $('#lock-go').textContent = mode === 'create' ? 'SET PIN' : 'UNLOCK';
  // Only reset the field on a fresh lock — a re-entrant 401 mustn't wipe a PIN being typed.
  if (!wasLocked) {
    $('#lock-pin').value = ''; $('#lock-pin2').value = ''; $('#lock-msg').textContent = '';
    setTimeout(() => $('#lock-pin').focus(), 60);
  }
}
function showApp() {
  document.body.classList.remove('locked');
  window.FinSight.auth.unlock();
  if (!booted) { booted = true; boot(); }
  else startPolling(); // resume polling after unlocking
}
window.addEventListener('finsight:locked', () => { if (!document.body.classList.contains('locked')) showLock('enter'); });
window.addEventListener('finsight:unlocked', () => { if (document.body.classList.contains('locked')) showApp(); });
function lockMsg(m) { $('#lock-msg').textContent = m || ''; }
async function submitPin() {
  const pin = $('#lock-pin').value.trim();
  if (!/^\d{4,12}$/.test(pin)) return lockMsg('PIN must be 4–12 digits');
  try {
    if (lockMode === 'create') {
      if (pin !== $('#lock-pin2').value.trim()) { lockMsg('PINs do not match'); return; }
      await api('/api/auth/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin }) });
    } else {
      await api('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin }) });
    }
    showApp();
  } catch (e) { lockMsg(e.message); $('#lock-pin').value = ''; $('#lock-pin').focus(); }
}
$('#lock-go').addEventListener('click', submitPin);
$('#lock-pin').addEventListener('keydown', (e) => { if (e.key === 'Enter') { if (lockMode === 'create') $('#lock-pin2').focus(); else submitPin(); } });
$('#lock-pin2').addEventListener('keydown', (e) => { if (e.key === 'Enter') submitPin(); });
$('#lock-btn').addEventListener('click', async () => { try { await api('/api/auth/logout', { method: 'POST' }); } catch {} showLock('enter'); });

// Server unreachable (not started, or stopped): say so instead of offering to
// "create a PIN", and keep retrying so the app comes back by itself.
let offlineTimer = null;
function showOffline() {
  document.body.classList.add('locked');
  stopPolling();
  $('#lock-title').textContent = "Can't reach the FinSight server";
  $('#lock-pin').classList.add('hidden'); $('#lock-pin2').classList.add('hidden'); $('#lock-go').classList.add('hidden');
  lockMsg('Start it with  node server.js  (or start.command). Retrying…');
  clearTimeout(offlineTimer);
  offlineTimer = setTimeout(checkAuth, 5000);
}
async function checkAuth() {
  let st;
  try {
    const r = await fetch('/api/auth/status');
    if (!r.ok) throw new Error();
    st = await r.json();
  } catch { return showOffline(); }
  $('#lock-pin').classList.remove('hidden'); $('#lock-go').classList.remove('hidden');
  if (st.authed) showApp();
  else { lockMsg(''); showLock(st.pinSet ? 'enter' : 'create'); }
}
checkAuth();
// Installable app + instant shell (static files only — see sw.js).
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
