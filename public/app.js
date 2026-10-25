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

// ===========================================================================
//  COMMAND BAR
// ===========================================================================
// The command bar is a React island (F7, web/src/features/command). These two
// stay global for legacy callers and write the store the status/footer islands read.
function setStatus(msg, kind = '') { state.status = { msg, kind }; }
function setFooter(msg) { state.footer = msg; }

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
// Peek is a React island (F8); bootstrap applies body.unpeek from the store.

// ---- appearance: switchable theme + font (system fonts only, no downloads) ----
// Theme and font are the appearance island (F8); the head script applies them pre-paint.

$('#cards-btn').addEventListener('click', () => { renderPanelsEditor(); $('#cards-modal').classList.remove('hidden'); });
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
// Profile and the setup wizard are React islands (F8, web/src/features/topbar).

// ---- POSITIONS TABLE: React island (D1, web/src/features/positions) ----------
// lastTableData feeds the chart watch list (chartWatchItems) until X1.
let lastTableData = { positions: [], base: 'SGD' };

// ===========================================================================
//  UNDO + CASH
// ===========================================================================
// Undo, CASH and the cash editor are TypeScript (D3, web/src/features/cash).
// doUndo and openCashEditor stay for the legacy buttons that open them until X1.
function doUndo() { return window.FinSight.actions.undo(); }
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
  repaint() { allCharts().forEach((c) => c.render()); },
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
// Test hook (B3 spec) until X1; B3 owns the account-keyed query.
function loadDividends() { return window.FinSight.bus.invalidate('dividends'); }

// ===========================================================================
//  WATCHLIST
// ===========================================================================
// Test hook (session, PILOT-1, D1 specs) until X1; the watchlist query owns loading and polling.
function loadWatchlist() { return window.FinSight.bus.invalidate('watchlist'); }

// ===========================================================================
//  PRICE ALERTS + NOTIFICATIONS
// ===========================================================================
// Alerts are a React island. requestNotify stays global for it (and the ALERT command) until X1.
function requestNotify() {
  if ('Notification' in window && Notification.permission === 'default') { try { Notification.requestPermission(); } catch {} }
}

// ===========================================================================
//  NEWS
// ===========================================================================
// News is a React island (A2); the NEWS command invalidates its keys (F7).

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


// ===========================================================================
//  ACCOUNTS (multiple portfolios)
// ===========================================================================
function blockIfAll() {
  if (state.account === 'ALL') { setStatus('Switch from "All Accounts" to a specific account to add or trade.', 'err'); return true; }
  return false;
}
// Startup account resolution stays here until X1: every query waits for
// accountReady, and boot needs the account before the first portfolio load.
// The selector and MANAGE ACCOUNTS are React islands (F8).
async function loadAccounts() {
  try {
    const d = await api('/api/accounts');
    const accounts = d.accounts || [];
    const exists = (id) => id === 'ALL' || accounts.some((a) => a.id === id);
    if (!exists(state.account)) state.account = exists(localStorage.getItem('finsight-account')) ? localStorage.getItem('finsight-account') : d.activeId;
    localStorage.setItem('finsight-account', state.account);
    state.accounts = accounts; // the selector and MANAGE ACCOUNTS render this
    state.accountReady = true;
  } catch {}
}

async function boot() {
  initDragLayout();
  applyLayout();
  applyPanels();
  await loadAccounts();
  // the setup island opens the first-launch wizard once accountReady is set (F8)
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
// Startup and lock orchestration stay here until X1 (they drive boot and
// polling). The lock screen's form and the 🔒 button are React islands (F9),
// which render store.lock; unlocking goes through FinSight.auth.
let booted = false;
function showLock(mode) {
  const wasLocked = document.body.classList.contains('locked');
  document.body.classList.add('locked');
  stopPolling(); // no background 401s while locked
  window.FinSight.auth.lock();
  // Only a fresh lock clears the fields: a re-entrant 401 mustn't wipe a PIN being typed.
  const l = state.lock;
  state.lock = { mode, msg: wasLocked ? l.msg : '', fresh: wasLocked ? l.fresh : l.fresh + 1 };
}
function showApp() {
  document.body.classList.remove('locked');
  window.FinSight.auth.unlock();
  if (!booted) { booted = true; boot(); }
  else startPolling(); // resume polling after unlocking
}
window.addEventListener('finsight:locked', () => { if (!document.body.classList.contains('locked')) showLock('enter'); });
window.addEventListener('finsight:unlocked', () => { if (document.body.classList.contains('locked')) showApp(); });

// Server unreachable (not started, or stopped): say so instead of offering to
// "create a PIN", and keep retrying so the app comes back by itself.
let offlineTimer = null;
function showOffline() {
  document.body.classList.add('locked');
  stopPolling();
  state.lock = { ...state.lock, mode: 'offline', msg: 'Start it with  node server.js  (or start.command). Retrying…' };
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
  if (st.authed) showApp();
  else { state.lock = { ...state.lock, msg: '' }; showLock(st.pinSet ? 'enter' : 'create'); }
}
checkAuth();
// Installable app + instant shell (static files only — see sw.js).
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
