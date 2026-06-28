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
const api = (path, opts) => fetch(path, opts).then(async (r) => {
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

let state = {
  selected: null,
  detailRange: { range: '1mo', interval: '1d' },
  lastPrices: {},
  base: (localStorage.getItem('finsight-base') || 'SGD').toUpperCase(),
  account: localStorage.getItem('finsight-account') || '',
};
let accountsCache = [];

// ===========================================================================
//  CLOCK
// ===========================================================================
function tick() {
  const d = new Date();
  $('#clock').textContent = d.toLocaleTimeString('en-US', { hour12: false }) + ' ' +
    d.toLocaleDateString('en-US', { month: 'short', day: '2-digit' }).toUpperCase();
}
setInterval(tick, 1000); tick();

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
      setStatus('ADD <s> <qty> <px> · SELL <s> <qty> [px] · DEL <s> · Q <s> · WATCH/UNWATCH <s> · ALERT <s> > <px> · NEWS [s] · MKT · CLEAR', 'ok');
      return;
    }
    if (cmd === 'ADD' || cmd === 'BUY') {
      const [, sym, qty, price, date] = parts; // date optional: ADD AAPL 10 195.50 2024-01-15
      if (!sym || !qty || !price) return setStatus('Usage: ADD <symbol> <qty> <avg price> [YYYY-MM-DD]   e.g. ADD AAPL 10 195.50', 'err');
      if (blockIfAll()) return;
      await api('/api/portfolio/buy' + baseQS(), { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: sym, quantity: qty, price, date: date || null }) });
      setStatus(`BOUGHT ${qty} ${sym.toUpperCase()} @ ${price}${date ? ' on ' + date : ''}`, 'ok');
      await loadPortfolio(); return;
    }
    if (cmd === 'SELL') {
      const [, sym, qty, price] = parts;
      if (!sym || !qty) return setStatus('Usage: SELL <symbol> <qty> [price]   (price optional → uses market)', 'err');
      const res = await api('/api/portfolio/sell' + baseQS(), { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: sym, quantity: qty, price: price ?? null }) });
      const r = res.lastRealized;
      setStatus(`SOLD ${qty} ${sym.toUpperCase()}  ·  realized ${signStr(r)} `, r >= 0 ? 'ok' : 'err');
      renderPortfolio(res); return;
    }
    if (cmd === 'DEL' || cmd === 'DELETE' || cmd === 'REMOVE') {
      const sym = parts[1];
      if (!sym) return setStatus('Usage: DEL <symbol>', 'err');
      await api('/api/portfolio/delete' + baseQS(), { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: sym }) });
      setStatus(`REMOVED ${sym.toUpperCase()} from portfolio`, 'ok');
      await loadPortfolio(); return;
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
      setStatus(`Watching ${sym.toUpperCase()}`, 'ok'); loadWatchlist(); return;
    }
    if (cmd === 'UNWATCH') {
      const sym = parts[1];
      if (!sym) return setStatus('Usage: UNWATCH <symbol>', 'err');
      await api('/api/watchlist/remove', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ symbol: sym }) });
      setStatus(`Unwatched ${sym.toUpperCase()}`, 'ok'); loadWatchlist(); return;
    }
    if (cmd === 'ALERT') {
      const sym = parts[1], op = parts[2], price = parts[3];
      if (!sym || !op || !price) return setStatus('Usage: ALERT <symbol> > <price>   (use > or <)', 'err');
      const o = (op.includes('<') || /below|under/i.test(op)) ? '<' : '>';
      await api('/api/alerts/add', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ symbol: sym, op: o, price }) });
      setStatus(`Alert set: ${sym.toUpperCase()} ${o} ${price}`, 'ok'); loadAlerts(); requestNotify(); return;
    }
    if (cmd === 'NEWS') {
      const sym = parts[1];
      if (sym) { selectSymbol(sym.toUpperCase()); } else { loadNews(''); }
      setStatus('Loading news…', 'ok'); return;
    }
    if (cmd === 'MKT' || cmd === 'MARKETS') { loadMarkets(); setStatus('Refreshing world markets…', 'ok'); return; }
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

async function loadPortfolio() {
  try {
    const data = await api('/api/portfolio' + baseQS());
    renderPortfolio(data);
    loadDividends(); // keep dividend panel in sync with the active account/base
    loadFxRisk();    // keep FX-risk panel + exposure card in sync too
  } catch (e) { setFooter('Portfolio load failed: ' + e.message); }
}

function renderPortfolio(data) {
  const { positions, summary, transactions } = data;
  const base = data.base || state.base;
  lastSummary = summary; // for live card re-render
  renderSummary(summary, positions, base);
  // FX coverage note
  if (data.fxMissing && data.fxMissing.length) setFooter(`Note: no FX rate for ${data.fxMissing.join(', ')} → shown unconverted.`);

  // positions table
  const body = $('#positions-body');
  if (!positions.length) {
    body.innerHTML = `<tr><td colspan="11" class="empty">No positions yet — add one above or type <b>ADD AAPL 10 195.50</b> in the command bar.</td></tr>`;
  } else {
    body.innerHTML = positions.map((p) => {
      const flash = priceFlash(p.symbol, p.last);
      return `<tr class="clickable ${state.selected === p.symbol ? 'selected' : ''} ${flash}" data-sym="${p.symbol}">
        <td><span class="sym">${p.symbol}</span><div class="name">${esc(p.name).slice(0, 20)} · <span class="ccy">${p.currency}</span></div></td>
        <td class="r">${fmt(p.quantity, p.quantity % 1 ? 4 : 0)}</td>
        <td class="r">${fmt(p.avgCost)}</td>
        <td class="r">${fmt(p.last)}</td>
        <td class="r ${signClass(p.changePct)}">${signStr(p.changePct)}%</td>
        <td class="r">${money(base, p.marketValue)}</td>
        <td class="r ${signClass(p.unrealized)}">${moneySigned(base, p.unrealized)}</td>
        <td class="r ${signClass(p.unrealizedPct)}">${signStr(p.unrealizedPct)}%</td>
        <td class="r ${signClass(p.fxPnl)}">${p.currency === base ? '<span class="dim">—</span>' : moneySigned(base, p.fxPnl)}</td>
        <td class="r">${fmt(p.weight, 1)}</td>
        <td><div class="row-actions">
          <button class="x-btn sell" data-act="sell" data-sym="${p.symbol}" data-qty="${p.quantity}">S</button>
          <button class="x-btn del"  data-act="del"  data-sym="${p.symbol}">✕</button>
        </div></td></tr>`;
    }).join('');
  }
  // activity
  $('#activity').innerHTML = (transactions || []).map((t) => {
    const cls = t.type === 'BUY' ? 't-buy' : t.type === 'SELL' ? 't-sell' : 't-del';
    const when = new Date(t.time).toLocaleString('en-US', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    let detail = t.type === 'DELETE' ? 'removed'
      : `${fmt(t.quantity, t.quantity % 1 ? 4 : 0)} @ ${fmt(t.price)}` + (t.realized != null ? `  ·  P&L ${signStr(t.realized)}` : '');
    return `<div class="line"><span class="ts">${when}</span><span class="${cls}">${t.type}</span><span class="sym amber">${t.symbol}</span><span class="muted">${detail}</span></div>`;
  }).join('') || '<div class="muted small">No transactions yet.</div>';

  // charts + heatmap
  renderAnalytics(positions);

  // re-select detail if needed
  if (!state.selected && positions.length) selectSymbol(positions[0].symbol);
}

// ---- FX RISK panel ---------------------------------------------------------
async function loadFxRisk() {
  try {
    const data = await api('/api/fx-risk' + baseQS());
    lastFxRisk = data;
    renderFxRisk(data);
    applyCards(); // refresh the FX EXPOSURE card now that exposure data is in
  } catch (e) { /* non-fatal — panel just keeps its last state */ }
}

function renderFxRisk(data) {
  const box = $('#fxrisk'); if (!box) return;
  const base = data.base || state.base;
  const exposures = data.exposures || [];
  const head = $('#fxr-spot');
  if (!exposures.length) {
    if (head) head.textContent = '';
    box.classList.add('muted');
    box.innerHTML = (data.totalValue > 0)
      ? `No foreign-currency holdings — your book is all in ${base}, so there's no FX risk to track.`
      : `No positions yet — add holdings (in a foreign currency) to track FX risk.`;
    return;
  }
  box.classList.remove('muted');
  const dom = exposures[0];               // dominant currency (sorted by exposure)
  const multi = exposures.length > 1;     // >1 foreign currency: label rates per-row, not by dom
  if (head) head.textContent = `${dom.ccy}/${base} ${fmt(dom.nowRate, 4)}`;

  // header strip — one block per foreign currency
  const strip = exposures.map((e) => `
    <div class="fxr-cell"><span class="k">${e.ccy} EXPOSURE</span><span class="v">${moneyBig(base, e.notionalBase)}</span><span class="s">${fmt(e.pct, 0)}% of book · ${money(e.ccy, e.notionalNative, 0)}</span></div>
    <div class="fxr-cell"><span class="k">BLENDED ENTRY</span><span class="v">${fmt(e.blendedEntry, 4)}</span><span class="s">avg ${e.ccy}/${base} cost</span></div>
    <div class="fxr-cell"><span class="k">SPOT</span><span class="v ${signClass(e.driftPct)}">${fmt(e.nowRate, 4)}</span><span class="s ${signClass(e.driftPct)}">${signStr(e.driftPct)}% vs entry</span></div>
    <div class="fxr-cell"><span class="k">FX P&L</span><span class="v ${signClass(e.fxPnl)}">${moneySigned(base, e.fxPnl)}</span><span class="s ${signClass(e.fxPnl)}">${signStr(e.fxPnlPct)}% · currency only</span></div>`).join('');

  // Realized FX from closed trades (portfolio-wide; from the latest /api/portfolio summary).
  const rfx = lastSummary ? lastSummary.realizedFxPnl : null;
  const legacySells = lastSummary ? (lastSummary.realizedLegacy || 0) : 0;
  const realizedSub = legacySells ? `closed · excl. ${legacySells} pre-FX-tracking` : 'closed trades · currency';
  const realizedCell = (rfx != null && (rfx || (lastSummary && lastSummary.realizedStockPnl)))
    ? `<div class="fxr-cell"><span class="k">REALIZED FX</span><span class="v ${signClass(rfx)}">${moneySigned(base, rfx)}</span><span class="s">${realizedSub}</span></div>`
    : '';

  // 1-week parametric FX VaR from the currency's weekly volatility.
  const v = data.vol || {};
  const volCell = v.oneSigmaBase
    ? `<div class="fxr-cell"><span class="k">1σ MOVE / WK</span><span class="v">±${money(base, v.oneSigmaBase, 0)}</span><span class="s">σ ${fmt(v.sigmaWeeklyPct, 2)}%/wk · 95% ${money(base, v.var95Base, 0)}</span></div>`
    : '';

  // per-buy FX history
  const rows = (data.lots || []).map((l) => {
    const when = l.t ? new Date(l.t).toLocaleDateString('en-US', { year: '2-digit', month: 'short', day: '2-digit' }) : '—';
    const note = !l.dated ? '<span class="dim"> no date</span>' : (l.recent ? '<span class="dim"> settling</span>' : '');
    const pair = multi ? `<span class="dim">${l.currency}/${base} </span>` : '';
    return `<tr>
      <td>${when}</td><td class="sym">${l.symbol}</td>
      <td class="r">${pair}${fmt(l.entryRate, 4)}</td><td class="r">${fmt(l.nowRate, 4)}</td>
      <td class="r ${signClass(l.fxPnl)}">${moneySigned(base, l.fxPnl)}${note}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="5" class="muted small">No purchases recorded yet.</td></tr>';

  const totalExp = data.foreignBase || 0;
  box.innerHTML = `
    <div class="fxr-strip">${strip}${realizedCell}${volCell}</div>
    <div class="fxr-sub">PER-BUY FX HISTORY · gain/loss from currency alone</div>
    <table class="tbl fxr-tbl">
      <thead><tr><th>DATE</th><th>SYM</th><th class="r">${multi ? 'FX' : dom.ccy + '/' + base} @BUY</th><th class="r">NOW</th><th class="r">FX P&L</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="fxr-whatif">
      <div class="fxr-wi-head"><span class="fxr-sub">WHAT-IF · ${multi ? 'foreign-FX' : dom.ccy + '/' + base} shock</span><span id="fxr-shock" class="cyan">0.0%</span></div>
      <input id="fxr-slider" type="range" min="-15" max="15" value="0" step="0.5">
      <div class="fxr-wi-out"><span class="muted">impact on book <b id="fxr-impact">—</b></span><span class="muted">new value <b id="fxr-newval">${money(base, totalExp)}</b></span></div>
    </div>
    <div class="fxr-note">Currency risk adds volatility with little long-run expected return — it bites most over short horizons and drawdowns. Informational only; no trades are placed.</div>`;

  const slider = $('#fxr-slider');
  const upd = () => {
    const pct = parseFloat(slider.value);
    const impact = totalExp * pct / 100;
    $('#fxr-shock').textContent = (pct > 0 ? '+' : '') + pct.toFixed(1) + '%';
    const imp = $('#fxr-impact'); imp.textContent = moneySigned(base, impact); imp.className = signClass(impact);
    $('#fxr-newval').textContent = money(base, totalExp + impact);
  };
  slider.addEventListener('input', upd); upd();
}

// ---- ECON CALENDAR panel ---------------------------------------------------
async function loadCalendar() {
  try { renderCalendar(await api('/api/calendar')); }
  catch (e) { const b = $('#calendar'); if (b) { b.classList.add('muted'); b.textContent = 'Calendar unavailable right now.'; } }
}
function renderCalendar(data) {
  const box = $('#calendar'); if (!box) return;
  box.classList.remove('muted');
  const dayShort = (s) => new Date(s + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: '2-digit' });
  const daysTo = (ms) => Math.max(0, Math.round((ms - Date.now()) / 86400000));

  // FOMC anchor — next rate decision + next dot plot, always known.
  let anchor = '';
  const f = data.nextFomc, sep = data.nextSep;
  if (f) {
    const dd = daysTo(f.decisionMs);
    const sepCell = sep
      ? `<div class="cal-a"><span class="k">NEXT DOT PLOT</span><span class="v">${dayShort(sep.start)}</span><span class="s"><a href="${data.sepUrl}" target="_blank" rel="noopener">FOMC projections ↗</a></span></div>`
      : '';
    anchor = `<div class="cal-anchor">
      <div class="cal-a"><span class="k">NEXT FED DECISION</span><span class="v amber">${dayShort(f.end)}</span><span class="s">${dd}d · rate + statement${f.sep ? ' + dot plot' : ''}</span></div>
      ${sepCell}
    </div>`;
  }

  // This-week high-impact releases (CPI, PCE, NFP, the rate decision…).
  const dt = (s) => new Date(s).toLocaleString('en-US', { weekday: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const rows = (data.events || []).map((e) => {
    const ms = Date.parse(e.time);
    const past = !isNaN(ms) && ms < Date.now();
    const when = isNaN(ms) ? esc(e.time || '—') : dt(e.time); // tolerate a malformed feed time
    const fp = (e.forecast || e.previous) ? `<span class="cal-fp">f ${esc(e.forecast || '—')} · p ${esc(e.previous || '—')}</span>` : '';
    return `<div class="cal-row ${past ? 'cal-past' : ''}">
      <span class="cal-when">${when}</span>
      <span class="ccy">${esc(e.country)}</span>
      <span class="cal-title">${esc(e.title)}</span>${fp}
    </div>`;
  }).join('') || `<div class="muted small">${data.eventsOk ? 'No high-impact USD/SGD events this week.' : 'Live feed unavailable — Fed schedule shown above.'}</div>`;

  box.innerHTML = anchor + `<div class="fxr-sub">THIS WEEK · high-impact (USD/SGD)</div>` + rows;
}

function card(label, value, sub, signVal) {
  const cls = signVal != null ? signClass(signVal) : '';
  return `<div class="card"><div class="label">${label}</div>
    <div class="value ${cls}">${value}</div><div class="sub ${cls}">${sub}</div></div>`;
}

// ---- customizable summary cards --------------------------------------------
let lastSummary = null;
let lastFxRisk = null; // populated by loadFxRisk(); feeds the FX EXPOSURE card
const CARD_DEFS = {
  total_value:  { label: 'TOTAL VALUE',    render: (s, b) => ({ value: moneyBig(b, s.totalValue), sub: 'cost ' + moneyBig(b, s.totalCost) }) },
  day_pnl:      { label: 'DAY P&L',        render: (s, b) => ({ value: moneySigned(b, s.dayPnl), sub: 'today', signVal: s.dayPnl }) },
  unrealized:   { label: 'UNREALIZED P&L', render: (s, b) => ({ value: moneySigned(b, s.totalUnrealized), sub: signStr(s.totalUnrealizedPct) + '%', signVal: s.totalUnrealized }) },
  stock_pnl:    { label: 'STOCK P&L',      render: (s, b) => ({ value: moneySigned(b, s.totalStockPnl), sub: 'price move', signVal: s.totalStockPnl }) },
  fx_pnl:       { label: 'FX P&L',         render: (s, b) => ({ value: moneySigned(b, s.totalFxPnl), sub: 'currency move', signVal: s.totalFxPnl }) },
  fx_exposure:  { label: 'FX EXPOSURE',    render: (s, b) => {
    const r = lastFxRisk;
    if (!r || !r.exposures || !r.exposures.length) return { value: '—', sub: 'foreign currency' };
    const pct = r.totalValue ? (r.foreignBase / r.totalValue) * 100 : 0;
    return { value: moneyBig(b, r.foreignBase), sub: fmt(pct, 0) + '% in ' + r.exposures.map((e) => e.ccy).join('/') };
  } },
  realized:     { label: 'REALIZED P&L',   render: (s, b) => ({ value: moneySigned(b, s.realizedPnl), sub: 'lifetime', signVal: s.realizedPnl }) },
  realized_fx:  { label: 'REALIZED FX',     render: (s, b) => ({ value: moneySigned(b, s.realizedFxPnl || 0), sub: 'closed · currency', signVal: s.realizedFxPnl || 0 }) },
  cost_basis:   { label: 'COST BASIS',     render: (s, b) => ({ value: moneyBig(b, s.totalCost), sub: b }) },
  day_pct:      { label: 'DAY %',          render: (s) => { const pct = s.dayPct ?? 0; return { value: signStr(pct) + '%', sub: 'today', signVal: pct }; } },
  positions:    { label: 'POSITIONS',      render: (s, b, ps) => ({ value: String(ps.length), sub: 'holdings' }) },
  best:         { label: 'BEST TODAY',     render: (s, b, ps) => { const x = ps.filter(p => p.changePct != null).sort((a, b) => b.changePct - a.changePct)[0]; return x ? { value: x.symbol, sub: signStr(x.changePct) + '%', signVal: x.changePct } : { value: '—', sub: '' }; } },
  worst:        { label: 'WORST TODAY',    render: (s, b, ps) => { const x = ps.filter(p => p.changePct != null).sort((a, b) => a.changePct - b.changePct)[0]; return x ? { value: x.symbol, sub: signStr(x.changePct) + '%', signVal: x.changePct } : { value: '—', sub: '' }; } },
};
const ALL_CARDS = Object.keys(CARD_DEFS);
const DEFAULT_CARDS = ['total_value', 'day_pnl', 'unrealized', 'stock_pnl', 'fx_pnl', 'fx_exposure', 'realized'];
const DEFAULT_ORDER = [...DEFAULT_CARDS, ...ALL_CARDS.filter((id) => !DEFAULT_CARDS.includes(id))];
let cardPrefs = (() => {
  try {
    const p = JSON.parse(localStorage.getItem('finsight-cards'));
    if (p && Array.isArray(p.order) && Array.isArray(p.enabled)) {
      ALL_CARDS.forEach((id) => { if (!p.order.includes(id)) p.order.push(id); });
      p.order = p.order.filter((id) => CARD_DEFS[id]);
      p.enabled = p.enabled.filter((id) => CARD_DEFS[id]);
      if (!p.enabled.length) p.enabled = [...DEFAULT_CARDS]; // never render an empty summary
      return p;
    }
  } catch {}
  return { order: [...DEFAULT_ORDER], enabled: [...DEFAULT_CARDS] };
})();
function saveCardPrefs() { localStorage.setItem('finsight-cards', JSON.stringify(cardPrefs)); }
function renderSummary(summary, positions, base) {
  const enabled = cardPrefs.order.filter((id) => cardPrefs.enabled.includes(id));
  $('#summary').innerHTML = enabled.map((id) => {
    const r = CARD_DEFS[id].render(summary, base, positions || []);
    return card(CARD_DEFS[id].label, r.value, r.sub || '', r.signVal);
  }).join('');
}
function applyCards() { if (lastSummary) renderSummary(lastSummary, lastPositions, state.base); }

// cards customiser modal
function renderCardsEditor() {
  $('#cards-list').innerHTML = cardPrefs.order.map((id) => {
    const on = cardPrefs.enabled.includes(id);
    return `<div class="card-edit-row ${on ? '' : 'off'}">
      <label><input type="checkbox" data-id="${id}" ${on ? 'checked' : ''}> ${CARD_DEFS[id].label}</label>
      <span class="ce-move"><button data-dir="up" data-id="${id}">▲</button><button data-dir="down" data-id="${id}">▼</button></span>
    </div>`;
  }).join('');
}
$('#cards-btn').addEventListener('click', () => { renderCardsEditor(); renderPanelsEditor(); $('#cards-modal').classList.remove('hidden'); });
$('#cards-close').addEventListener('click', () => $('#cards-modal').classList.add('hidden'));
$('#cards-done').addEventListener('click', () => $('#cards-modal').classList.add('hidden'));
$('#cards-modal').addEventListener('click', (e) => { if (e.target.id === 'cards-modal') $('#cards-modal').classList.add('hidden'); });
$('#cards-reset').addEventListener('click', () => { cardPrefs = { order: [...DEFAULT_ORDER], enabled: [...DEFAULT_CARDS] }; saveCardPrefs(); applyCards(); renderCardsEditor(); });
$('#cards-list').addEventListener('change', (e) => {
  const cb = e.target.closest('input[type=checkbox]'); if (!cb) return;
  const id = cb.dataset.id;
  if (cb.checked) { if (!cardPrefs.enabled.includes(id)) cardPrefs.enabled.push(id); }
  else cardPrefs.enabled = cardPrefs.enabled.filter((x) => x !== id);
  saveCardPrefs(); applyCards(); renderCardsEditor();
});
$('#cards-list').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-dir]'); if (!b) return;
  const id = b.dataset.id, i = cardPrefs.order.indexOf(id), j = b.dataset.dir === 'up' ? i - 1 : i + 1;
  if (j < 0 || j >= cardPrefs.order.length) return;
  [cardPrefs.order[i], cardPrefs.order[j]] = [cardPrefs.order[j], cardPrefs.order[i]];
  saveCardPrefs(); applyCards(); renderCardsEditor();
});

// ---- show / hide whole panels ----------------------------------------------
const PANELS = [
  ['perf-body', 'Performance'], ['alloc-body', 'Allocation'], ['heatmap-body', 'Sector Heatmap'],
  ['fxrisk', 'FX Risk'], ['dividends', 'Dividends'], ['watchlist', 'Watchlist'], ['alerts', 'Price Alerts'], ['activity', 'Recent Activity'],
  ['news', 'News'], ['markets', 'World Markets'], ['calendar', 'Econ Calendar'], ['wb-body', 'World Bank'], ['fred-body', 'US Fed (FRED)'],
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
  ['#positions', 'positions'], ['#perf-ranges', 'performance'], ['#alloc-mode', 'allocation'],
  ['#heat-metric', 'heatmap'], ['#fxrisk', 'fxrisk'], ['#dividends', 'dividends'], ['#watchlist', 'watchlist'], ['#alerts', 'alerts'], ['#activity', 'activity'],
  ['#detail-panel', 'detail'], ['#news', 'news'], ['#markets', 'markets'], ['#calendar', 'calendar'], ['#wb-body', 'worldbank'], ['#fred-body', 'fred'],
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
  if (a === 'import') $('#import-modal').classList.remove('hidden');
  else if (a === 'manual') { $('#add-form').classList.remove('hidden'); $('#add-symbol').focus(); }
  setStatus(profile.name ? `Welcome, ${profile.name}.` : 'Terminal ready.', 'ok');
});

function priceFlash(sym, last) {
  const prev = state.lastPrices[sym];
  state.lastPrices[sym] = last;
  if (prev == null || prev === last) return '';
  return last > prev ? 'flash-up' : 'flash-down';
}

// row clicks (event delegation)
$('#positions-body').addEventListener('click', async (e) => {
  const actBtn = e.target.closest('[data-act]');
  if (actBtn) {
    e.stopPropagation();
    const sym = actBtn.dataset.sym;
    if (actBtn.dataset.act === 'del') {
      if (!confirm(`Remove ${sym} from your portfolio? (does not record a sale)`)) return;
      await api('/api/portfolio/delete' + baseQS(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ symbol: sym }) });
      setStatus(`REMOVED ${sym}`, 'ok'); if (state.selected === sym) state.selected = null; await loadPortfolio();
    } else if (actBtn.dataset.act === 'sell') {
      const held = actBtn.dataset.qty;
      const qty = prompt(`Sell how many ${sym}? (you hold ${held})\nLeave price blank to sell at market.`, held);
      if (qty == null) return;
      const price = prompt(`Sell price for ${sym}? (blank = market price)`, '');
      try {
        const res = await api('/api/portfolio/sell' + baseQS(), { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbol: sym, quantity: qty, price: price === '' ? null : price }) });
        setStatus(`SOLD ${qty} ${sym} · realized ${signStr(res.lastRealized)}`, res.lastRealized >= 0 ? 'ok' : 'err');
        renderPortfolio(res);
      } catch (err) { setStatus('SELL failed: ' + err.message, 'err'); }
    }
    return;
  }
  const row = e.target.closest('tr[data-sym]');
  if (row) selectSymbol(row.dataset.sym);
});

// ===========================================================================
//  ADD FORM + SYMBOL SEARCH
// ===========================================================================
$('#add-toggle').addEventListener('click', () => { $('#add-form').classList.toggle('hidden'); $('#add-symbol').focus(); });
$('#add-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const symbol = $('#add-symbol').value.trim().toUpperCase();
  const quantity = $('#add-qty').value, price = $('#add-price').value, date = $('#add-date').value || null;
  if (!symbol || !quantity || !price) return setStatus('Fill symbol, quantity and average price.', 'err');
  if (blockIfAll()) return;
  try {
    await api('/api/portfolio/buy' + baseQS(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ symbol, quantity, price, date }) });
    setStatus(`BOUGHT ${quantity} ${symbol} @ ${price}${date ? ' on ' + date : ''}`, 'ok');
    $('#add-symbol').value = $('#add-qty').value = $('#add-price').value = $('#add-date').value = '';
    $('#add-suggest').classList.add('hidden');
    await loadPortfolio();
  } catch (err) { setStatus('ADD failed: ' + err.message, 'err'); }
});

let searchTimer = null, suggestItems = [], suggestIdx = -1;
$('#add-symbol').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  const q = e.target.value.trim();
  if (q.length < 1) { $('#add-suggest').classList.add('hidden'); return; }
  searchTimer = setTimeout(async () => {
    try {
      suggestItems = await api('/api/search?q=' + encodeURIComponent(q));
      suggestIdx = -1;
      const box = $('#add-suggest');
      if (!suggestItems.length) { box.classList.add('hidden'); return; }
      box.innerHTML = suggestItems.map((s, i) =>
        `<div data-i="${i}"><span class="s-sym">${esc(s.symbol)}</span> <span class="s-meta">${esc(s.name).slice(0, 30)} · ${esc(s.exchange)} · ${esc(s.type)}</span></div>`).join('');
      box.classList.remove('hidden');
    } catch { $('#add-suggest').classList.add('hidden'); }
  }, 200);
});
$('#add-suggest').addEventListener('click', (e) => {
  const d = e.target.closest('[data-i]'); if (!d) return;
  pickSuggest(suggestItems[+d.dataset.i]);
});
$('#add-symbol').addEventListener('keydown', (e) => {
  const box = $('#add-suggest');
  if (box.classList.contains('hidden')) return;
  if (e.key === 'ArrowDown') { e.preventDefault(); suggestIdx = Math.min(suggestIdx + 1, suggestItems.length - 1); hl(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); suggestIdx = Math.max(suggestIdx - 1, 0); hl(); }
  else if (e.key === 'Enter' && suggestIdx >= 0) { e.preventDefault(); pickSuggest(suggestItems[suggestIdx]); }
  else if (e.key === 'Escape') box.classList.add('hidden');
  function hl() { $$('#add-suggest div').forEach((el, i) => el.classList.toggle('active', i === suggestIdx)); }
});
function pickSuggest(s) {
  if (!s) return;
  $('#add-symbol').value = s.symbol;
  $('#add-suggest').classList.add('hidden');
  $('#add-qty').focus();
}
document.addEventListener('click', (e) => { if (!e.target.closest('.add-field')) $('#add-suggest').classList.add('hidden'); });

// ===========================================================================
//  SECURITY DETAIL + CHART
// ===========================================================================
async function selectSymbol(symbol) {
  state.selected = symbol;
  $$('#positions-body tr').forEach((tr) => tr.classList.toggle('selected', tr.dataset.sym === symbol));
  loadNews(symbol);
  await loadDetail();
}

let detailChart = null; // singleton PriceChart instance (chart.js); survives refreshes

async function loadDetail() {
  const symbol = state.selected;
  if (!symbol) return;
  $('#detail-title').textContent = symbol + ' · DETAIL';
  const body = $('#detail-body');
  // Build a persistent skeleton ONCE so the interactive chart (its canvases,
  // ResizeObserver, zoom window and drawings) survives range switches and the
  // 30s background refresh — only the header + stats blocks get re-rendered.
  if (!body.querySelector('#detail-chart-host')) {
    body.innerHTML =
      '<div id="detail-hdr"></div>' +
      '<div id="detail-chart-host"></div>' +
      '<div id="detail-stats" class="stats"></div>';
    detailChart = null;
  }
  const hdr = $('#detail-hdr');
  if (!detailChart) hdr.innerHTML = '<div class="muted">Loading ' + esc(symbol) + '…</div>';
  try {
    const { range, interval } = state.detailRange;
    const h = await api(`/api/history?symbol=${encodeURIComponent(symbol)}&range=${range}&interval=${interval}`);
    if (state.selected !== symbol) return; // user switched symbols while we awaited
    const m = h.meta || {};
    const pts = h.points || [];
    const chg = m.change, chgPct = m.changePct;
    hdr.innerHTML = `
      <div class="detail-top">
        <div><span class="detail-sym">${esc(m.symbol || symbol)}</span> <span class="detail-name">${esc(m.name || '')}</span></div>
      </div>
      <div class="detail-top" style="margin-top:4px">
        <span class="detail-price">${fmt(m.price)}</span>
        <span class="detail-chg ${signClass(chg)}">${signStr(chg)} (${signStr(chgPct)}%)</span>
        <span class="muted small">${m.currency || ''} · ${esc(m.exchange || '')}</span>
      </div>`;
    $('#detail-stats').innerHTML = `
        ${statRow('Prev Close', fmt(m.prevClose))}
        ${statRow('Day Range', `${fmt(m.dayLow)} – ${fmt(m.dayHigh)}`)}
        ${statRow('52W High', fmt(m.weekHigh52))}
        ${statRow('52W Low', fmt(m.weekLow52))}
        ${statRow('Volume', fmtBig(m.volume))}
        ${statRow('Type', esc(m.type || '—'))}`;
    if (!detailChart && window.PriceChart) detailChart = new PriceChart($('#detail-chart-host'));
    if (detailChart) detailChart.load(symbol, pts, m, { range, interval });
    else $('#detail-chart-host').innerHTML = sparkline(pts, chg >= 0); // fallback if chart.js absent
  } catch (e) {
    hdr.innerHTML = `<div class="down">Could not load ${esc(symbol)}: ${esc(e.message)}</div>`;
  }
}
function statRow(k, v) { return `<div class="stat-row"><span class="k">${k}</span><span class="v">${v}</span></div>`; }

$('#ranges').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  $$('#ranges button').forEach((x) => x.classList.remove('active'));
  b.classList.add('active');
  state.detailRange = { range: b.dataset.range, interval: b.dataset.interval };
  loadDetail();
});

// SVG sparkline / line chart -------------------------------------------------
function sparkline(points, up) {
  if (!points || points.length < 2) return '<div class="chart muted small">No chart data.</div>';
  const W = 520, H = 150, pad = 4;
  const vals = points.map((p) => p.c);
  const min = Math.min(...vals), max = Math.max(...vals), span = (max - min) || 1;
  const stepX = (W - pad * 2) / (points.length - 1);
  const x = (i) => pad + i * stepX;
  const y = (v) => pad + (H - pad * 2) * (1 - (v - min) / span);
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.c).toFixed(1)}`).join(' ');
  const area = `${line} L${x(points.length - 1).toFixed(1)},${H - pad} L${x(0).toFixed(1)},${H - pad} Z`;
  const color = up ? 'var(--up)' : 'var(--down)';
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${color}" stop-opacity="0.28"/>
      <stop offset="100%" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
    <path d="${area}" fill="url(#g)"/>
    <path d="${line}" fill="none" stroke="${color}" stroke-width="1.5"/>
  </svg>`;
}

// ===========================================================================
//  WORLD MARKETS
// ===========================================================================
async function loadMarkets() {
  try {
    const groups = await api('/api/markets');
    const wrap = $('#markets');
    wrap.innerHTML = Object.entries(groups).map(([name, items]) => `
      <div class="mkt-group">
        <div class="mkt-h">${name.toUpperCase()}</div>
        ${items.map((q) => {
          if (q.error) return `<div class="mkt-row"><span class="mkt-label">${esc(q.label || q.symbol)}</span><span class="muted small">n/a</span></div>`;
          return `<div class="mkt-row" data-sym="${q.symbol}">
            <span class="mkt-label">${esc(q.label || q.symbol)}</span>
            <span class="mkt-px">${fmt(q.price, q.price < 10 ? 4 : 2)}</span>
            <span class="mkt-chg ${signClass(q.changePct)}">${signStr(q.changePct)}%</span></div>`;
        }).join('')}
      </div>`).join('');
    $('#markets-time').textContent = 'upd ' + new Date().toLocaleTimeString('en-US', { hour12: false });
    // market state pill from S&P time
    const sp = groups.Indices && groups.Indices.find((x) => x.symbol === '^GSPC');
    if (sp && sp.marketTime) {
      const fresh = Date.now() - sp.marketTime < 6 * 60000;
      const pill = $('#market-state');
      pill.textContent = fresh ? 'LIVE' : 'CLOSED';
      pill.className = 'pill ' + (fresh ? 'open' : 'closed');
    }
  } catch (e) { $('#markets').innerHTML = `<div class="down small">Markets failed: ${esc(e.message)}</div>`; }
}
$('#markets').addEventListener('click', (e) => {
  const row = e.target.closest('[data-sym]'); if (row) selectSymbol(row.dataset.sym);
});

// ===========================================================================
//  WORLD BANK MACRO
// ===========================================================================
async function loadWorldBank() {
  const country = $('#wb-country').value.trim().toUpperCase() || 'US';
  const indicator = $('#wb-indicator').value;
  const body = $('#wb-body');
  body.innerHTML = '<span class="muted">Loading World Bank data…</span>';
  try {
    const d = await api(`/api/worldbank?country=${encodeURIComponent(country)}&indicator=${encodeURIComponent(indicator)}`);
    if (!d.series || !d.series.length) { body.innerHTML = `<span class="muted">No data for ${esc(country)}.</span>`; return; }
    const latest = d.series[d.series.length - 1];
    const isPct = /%/.test(d.label) || /ZS|ZG/.test(indicator);
    const val = isPct ? fmt(latest.value, 2) + '%' : fmtBig(latest.value);
    body.innerHTML = `
      <div class="wb-headline"><span class="wb-val">${val}</span><span class="wb-yr">${esc(d.countryName)} · ${latest.year}</span></div>
      <div class="wb-label">${esc(d.label)} · annual, latest available (use FRED for monthly)</div>
      ${wbChart(d.series, isPct)}`;
  } catch (e) { body.innerHTML = `<span class="down">World Bank error: ${esc(e.message)}</span>`; }
}
function wbChart(series, isPct) {
  const pts = series.map((s) => ({ c: s.value }));
  const last = series[series.length - 1].value, first = series[0].value;
  return sparkline(pts, last >= first);
}
$('#wb-go').addEventListener('click', loadWorldBank);
$('#wb-country').addEventListener('keydown', (e) => { if (e.key === 'Enter') loadWorldBank(); });
$('#wb-indicator').addEventListener('change', loadWorldBank);

// ===========================================================================
//  FRED — US FEDERAL RESERVE MACRO (no key)
// ===========================================================================
async function loadFred() {
  const [series, transform] = $('#fred-series').value.split('|');
  const label = $('#fred-series').selectedOptions[0].textContent;
  const body = $('#fred-body');
  body.innerHTML = '<span class="muted">Loading FRED…</span>';
  try {
    const d = await api(`/api/fred?series=${encodeURIComponent(series)}&transform=${encodeURIComponent(transform || 'lin')}`);
    if (!d.points || !d.points.length) { body.innerHTML = '<span class="muted">No data.</span>'; return; }
    const last = d.points[d.points.length - 1];
    const isLevel = /GDP/.test(series) && transform !== 'pc1';
    const val = isLevel ? fmtBig(last.value) : fmt(last.value, 2) + '%';
    const pts = d.points.map((p) => ({ c: p.value }));
    body.innerHTML = `<div class="wb-headline"><span class="wb-val">${val}</span><span class="wb-yr">${esc(last.date)}</span></div>
      <div class="wb-label">${esc(label)} · FRED</div>${sparkline(pts, last.value >= d.points[0].value)}`;
  } catch (e) { body.innerHTML = `<span class="down">FRED error: ${esc(e.message)}</span>`; }
}
$('#fred-go').addEventListener('click', loadFred);
$('#fred-series').addEventListener('change', loadFred);

// ===========================================================================
//  DIVIDENDS (income received, from broker imports)
// ===========================================================================
async function loadDividends() {
  const box = $('#dividends');
  try {
    const d = await api('/api/dividends' + baseQS());
    const base = d.base || state.base;
    $('#div-ttm').textContent = d.count ? 'TTM ' + money(base, d.ttm) : '';
    if (!d.count) { box.innerHTML = '<span class="muted">No dividends yet — import a broker statement (IBKR) to track income.</span>'; return; }
    const top = d.bySymbol.slice(0, 8).map((s) => `<div class="div-row"><span class="ds">${esc(s.symbol)}</span><span>${money(base, s.amount)}</span></div>`).join('');
    const recent = d.recent.slice(0, 8).map((r) => `<div class="dr"><span>${esc(r.date)}</span><span class="ds">${esc(r.symbol)}</span><span>${money(base, r.baseAmount)}</span></div>`).join('');
    box.innerHTML = `<div class="div-head"><span class="dv">${money(base, d.ttm)}</span><span class="div-sub">last 12 months · ${money(base, d.total)} all-time</span></div>${top}<div class="div-recent">${recent}</div>`;
  } catch (e) { box.innerHTML = `<span class="down">${esc(e.message)}</span>`; }
}

// ===========================================================================
//  WATCHLIST
// ===========================================================================
async function loadWatchlist() {
  try { renderWatchlist((await api('/api/watchlist')).watchlist); } catch {}
}
function renderWatchlist(list) {
  $('#watchlist').innerHTML = (list && list.length) ? list.map((w) => {
    if (w.error) return `<div class="wl-row"><span class="wl-sym">${esc(w.symbol)}</span><span class="muted small">n/a</span><span></span><button class="wl-x" data-sym="${esc(w.symbol)}">✕</button></div>`;
    return `<div class="wl-row" data-sym="${esc(w.symbol)}">
      <div><span class="wl-sym">${esc(w.symbol)}</span> <span class="wl-name">${esc(w.name || '').slice(0, 16)}</span></div>
      <span class="wl-px">${fmt(w.price, w.price < 10 ? 4 : 2)}</span>
      <span class="wl-chg ${signClass(w.changePct)}">${signStr(w.changePct)}%</span>
      <button class="wl-x" data-sym="${esc(w.symbol)}">✕</button></div>`;
  }).join('') : '<div class="wl-empty">Empty — add a symbol above, or type <b>WATCH NVDA</b>.</div>';
}
$('#watch-toggle').addEventListener('click', () => { $('#watch-form').classList.toggle('hidden'); $('#watch-symbol').focus(); });
$('#watch-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const s = $('#watch-symbol').value.trim().toUpperCase();
  if (!s) return;
  try {
    const res = await api('/api/watchlist/add', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ symbol: s }) });
    renderWatchlist(res.watchlist); $('#watch-symbol').value = ''; $('#watch-suggest').classList.add('hidden'); setStatus(`Watching ${s}`, 'ok');
  } catch (err) { setStatus('Watch failed: ' + err.message, 'err'); }
});
$('#watchlist').addEventListener('click', async (e) => {
  const x = e.target.closest('.wl-x');
  if (x) {
    e.stopPropagation();
    const res = await api('/api/watchlist/remove', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ symbol: x.dataset.sym }) });
    return renderWatchlist(res.watchlist);
  }
  const row = e.target.closest('[data-sym]'); if (row) selectSymbol(row.dataset.sym);
});

// ===========================================================================
//  PRICE ALERTS + NOTIFICATIONS
// ===========================================================================
let notifiedAlerts = null; // seeded on first load so pre-existing triggers don't re-fire
async function loadAlerts() {
  try { renderAlerts((await api('/api/alerts')).alerts); } catch {}
}
function renderAlerts(alerts) {
  alerts = alerts || [];
  if (notifiedAlerts === null) {
    notifiedAlerts = new Set(alerts.filter((a) => a.triggeredAt).map((a) => a.id));
  } else {
    alerts.forEach((a) => {
      if (a.met && a.triggeredAt && !notifiedAlerts.has(a.id)) {
        notifiedAlerts.add(a.id);
        notify('PRICE ALERT', `${a.symbol} ${a.op === '>' ? '≥' : '≤'} ${fmt(a.price)} — now ${fmt(a.currentPrice)}`);
      }
    });
  }
  $('#alerts').innerHTML = alerts.length ? alerts.map((a) => `
    <div class="al-row ${a.met ? 'met' : ''}">
      <div><span class="al-sym">${esc(a.symbol)}</span> <span class="al-cond">${a.op === '>' ? '≥' : '≤'} ${fmt(a.price)}</span>
        <span class="muted small">now ${a.currentPrice != null ? fmt(a.currentPrice) : '—'}</span></div>
      <span class="al-badge">${a.met ? 'TRIGGERED' : 'armed'}</span>
      <button class="al-x" data-id="${esc(a.id)}">✕</button></div>`).join('')
    : '<div class="al-empty">No alerts — add one above, or type <b>ALERT AAPL > 320</b>.</div>';
}
$('#alert-toggle').addEventListener('click', () => { $('#alert-form').classList.toggle('hidden'); $('#alert-symbol').focus(); requestNotify(); });
$('#alert-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const symbol = $('#alert-symbol').value.trim().toUpperCase();
  const op = $('#alert-op').value, price = $('#alert-price').value;
  if (!symbol || !price) return setStatus('Alert needs a symbol and a price.', 'err');
  try {
    const res = await api('/api/alerts/add', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ symbol, op, price }) });
    renderAlerts(res.alerts); $('#alert-symbol').value = ''; $('#alert-price').value = '';
    setStatus(`Alert set: ${symbol} ${op} ${price}`, 'ok'); requestNotify();
  } catch (err) { setStatus('Alert failed: ' + err.message, 'err'); }
});
$('#alerts').addEventListener('click', async (e) => {
  const x = e.target.closest('.al-x'); if (!x) return;
  const res = await api('/api/alerts/remove', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: x.dataset.id }) });
  renderAlerts(res.alerts);
});
function requestNotify() {
  if ('Notification' in window && Notification.permission === 'default') { try { Notification.requestPermission(); } catch {} }
}
function notify(head, body) {
  toast(head, body); beep();
  if ('Notification' in window && Notification.permission === 'granted') { try { new Notification(head, { body }); } catch {} }
}
function toast(head, body) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<div class="toast-h">🔔 ${esc(head)}</div><div class="toast-b">${esc(body)}</div>`;
  $('#toasts').appendChild(el);
  setTimeout(() => { el.style.transition = 'opacity .4s'; el.style.opacity = '0'; setTimeout(() => el.remove(), 400); }, 9000);
}
function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.type = 'sine'; o.frequency.value = 880; g.gain.value = 0.05;
    o.start(); o.stop(ctx.currentTime + 0.15);
    o.onended = () => ctx.close();
  } catch {}
}

// ===========================================================================
//  NEWS
// ===========================================================================
async function loadNews(symbol) {
  $('#news-sym').textContent = symbol || 'market';
  const box = $('#news');
  box.innerHTML = '<span class="muted">Loading news…</span>';
  try {
    const { news } = await api('/api/news' + (symbol ? '?symbol=' + encodeURIComponent(symbol) : ''));
    if (!news.length) { box.innerHTML = '<span class="muted">No headlines found.</span>'; return; }
    box.innerHTML = news.map((n) => `<a class="news-item" href="${esc(n.link)}" target="_blank" rel="noopener noreferrer">
      <div class="news-title">${esc(n.title)}</div>
      <div class="news-meta">${esc(n.publisher || '')}${n.time ? ' · ' + timeAgo(n.time) : ''}</div></a>`).join('');
  } catch (e) { box.innerHTML = `<span class="down">News error: ${esc(e.message)}</span>`; }
}
function timeAgo(ms) {
  const s = (Date.now() - ms) / 1000;
  if (s < 3600) return Math.max(1, Math.floor(s / 60)) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

// ===========================================================================
//  CSV IMPORT / EXPORT
// ===========================================================================
function setImportStatus(m, k) { const el = $('#import-status'); el.textContent = m; el.className = 'cmd-status ' + (k || ''); }
$('#import-btn').addEventListener('click', () => { $('#import-modal').classList.remove('hidden'); $('#import-text').focus(); });
$('#import-close').addEventListener('click', () => $('#import-modal').classList.add('hidden'));
$('#import-modal').addEventListener('click', (e) => { if (e.target.id === 'import-modal') $('#import-modal').classList.add('hidden'); });
$('#import-file').addEventListener('change', async (e) => { const f = e.target.files[0]; if (f) $('#import-text').value = await f.text(); });
$('#import-do').addEventListener('click', async () => {
  const csv = $('#import-text').value.trim();
  if (!csv) return setImportStatus('Paste CSV or choose a file first.', 'err');
  if (state.account === 'ALL') return setImportStatus('Switch to a specific account first (ACCT, top-right).', 'err');
  setImportStatus('Importing… (fetching a quote per symbol)', '');
  try {
    const res = await api('/api/portfolio/import' + baseQS(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ csv, replace: $('#import-replace').checked }) });
    const r = res.imported;
    setImportStatus(`Imported ${r.added}/${r.total}${r.failed.length ? ' · failed: ' + r.failed.join(', ') : ''}`, r.added ? 'ok' : 'err');
    renderPortfolio(res);
    if (r.added) setTimeout(() => $('#import-modal').classList.add('hidden'), 1400);
  } catch (e) { setImportStatus('Import failed: ' + e.message, 'err'); }
});
$('#import-clear').addEventListener('click', async () => {
  if (!confirm('Clear ALL positions and transaction history?\n(Watchlist and alerts are kept.)')) return;
  try {
    const res = await api('/api/portfolio/reset' + baseQS(), { method: 'POST' });
    state.selected = null; renderPortfolio(res); setImportStatus('Portfolio cleared.', 'ok');
  } catch (e) { setImportStatus(e.message, 'err'); }
});
$('#export-btn').addEventListener('click', async () => {
  try {
    const data = await api('/api/portfolio' + baseQS());
    if (!data.positions.length) return setFooter('Nothing to export — portfolio is empty.');
    const head = ['symbol', 'quantity', 'avg_price', 'currency', 'last', 'market_value_' + (data.base || state.base).toLowerCase(), 'unrealized_pnl'];
    const rows = data.positions.map((p) => [p.symbol, p.quantity, p.avgCost, p.currency, p.last, p.marketValue.toFixed(2), p.unrealized.toFixed(2)]);
    const csv = [head, ...rows].map((r) => r.join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = 'portfolio.csv'; a.click(); URL.revokeObjectURL(a.href);
    setFooter('Exported portfolio.csv');
  } catch (e) { setFooter('Export failed: ' + e.message); }
});

// reusable symbol search for the watchlist field
function setupSearch(input, box, onPick) {
  let timer = null, items = [];
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 1) { box.classList.add('hidden'); return; }
    timer = setTimeout(async () => {
      try {
        items = await api('/api/search?q=' + encodeURIComponent(q));
        if (!items.length) { box.classList.add('hidden'); return; }
        box.innerHTML = items.map((s, i) => `<div data-i="${i}"><span class="s-sym">${esc(s.symbol)}</span> <span class="s-meta">${esc(s.name).slice(0, 26)} · ${esc(s.exchange)}</span></div>`).join('');
        box.classList.remove('hidden');
      } catch { box.classList.add('hidden'); }
    }, 200);
  });
  box.addEventListener('click', (e) => { const d = e.target.closest('[data-i]'); if (d) { onPick(items[+d.dataset.i]); box.classList.add('hidden'); } });
  document.addEventListener('click', (e) => { if (!box.parentElement.contains(e.target)) box.classList.add('hidden'); });
}
setupSearch($('#watch-symbol'), $('#watch-suggest'), (s) => { if (s) $('#watch-symbol').value = s.symbol; });

// ===========================================================================
//  PORTFOLIO ANALYTICS — performance, allocation donut, sector heatmap
// ===========================================================================
let lastPositions = [];
let heatMetric = 'day', allocMode = 'holding', perfRange = '1y', perfSig = '';
const catCache = {};

async function ensureCategories(symbols) {
  const missing = symbols.filter((s) => !catCache[s]);
  if (!missing.length) return;
  try { Object.assign(catCache, await api('/api/categories?symbols=' + encodeURIComponent(missing.join(',')))); } catch {}
}

// Squarified treemap: data [{value,...}] in rect -> [{...,x,y,w,h}] (validated: fills, no overlap).
function treemap(data, x, y, w, h) {
  const nodes = data.filter((d) => d.value > 0).map((d) => ({ d, value: d.value }));
  const out = [];
  const total = nodes.reduce((s, n) => s + n.value, 0);
  if (!total || w <= 0 || h <= 0) return out;
  const scale = (w * h) / total;
  nodes.forEach((n) => (n.area = n.value * scale));
  let rect = { x, y, w, h }, row = [], i = 0;
  const shortest = () => Math.min(rect.w, rect.h);
  const worst = (r, side) => {
    const s = r.reduce((a, q) => a + q.area, 0); let mx = 0, mn = Infinity;
    for (const q of r) { mx = Math.max(mx, q.area); mn = Math.min(mn, q.area); }
    return Math.max((side * side * mx) / (s * s), (s * s) / (side * side * mn));
  };
  const layout = (r) => {
    const s = r.reduce((a, q) => a + q.area, 0);
    if (rect.w >= rect.h) {
      const rw = s / rect.h; let cy = rect.y;
      for (const q of r) { const rh = q.area / rw; out.push({ ...q.d, x: rect.x, y: cy, w: rw, h: rh }); cy += rh; }
      rect.x += rw; rect.w -= rw;
    } else {
      const rh = s / rect.w; let cx = rect.x;
      for (const q of r) { const rw = q.area / rh; out.push({ ...q.d, x: cx, y: rect.y, w: rw, h: rh }); cx += rw; }
      rect.y += rh; rect.h -= rh;
    }
  };
  while (i < nodes.length) {
    const n = nodes[i], side = shortest();
    if (row.length === 0 || worst(row, side) >= worst([...row, n], side)) { row.push(n); i++; }
    else { layout(row); row = []; }
  }
  if (row.length) layout(row);
  return out;
}

function heatColor(pct) {
  const t = Math.max(-1, Math.min(1, (pct || 0) / 3)); // clamp at ±3%
  const neutral = [26, 31, 38], tgt = t >= 0 ? [38, 175, 110] : [205, 55, 55], a = Math.abs(t);
  const c = neutral.map((n, i) => Math.round(n + (tgt[i] - n) * a));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

function renderHeatmap(positions) {
  const box = $('#heatmap-body');
  if (!positions || !positions.length) { box.innerHTML = '<span class="muted">Add positions to see the heatmap.</span>'; return; }
  const W = 800, H = 380, pad = 2, labelH = 14;
  const groups = {};
  positions.forEach((p) => {
    const cat = (catCache[p.symbol]?.category) || 'Other';
    (groups[cat] || (groups[cat] = { category: cat, value: 0, items: [] }));
    groups[cat].value += p.marketValue; groups[cat].items.push(p);
  });
  const sectors = Object.values(groups).filter((g) => g.value > 0);
  let svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="height:380px">`;
  for (const sr of treemap(sectors.map((s) => ({ ...s })), 0, 0, W, H)) {
    svg += `<rect x="${sr.x}" y="${sr.y}" width="${sr.w}" height="${sr.h}" fill="#0a0c10" stroke="#000" stroke-width="2"/>`;
    const showLbl = sr.w > 56 && sr.h > 26;
    if (showLbl) svg += `<text x="${sr.x + 4}" y="${sr.y + 10}" fill="#8aa0b5" font-size="9" letter-spacing="0.5">${esc(sr.category.toUpperCase().slice(0, Math.floor(sr.w / 6)))}</text>`;
    const iy = sr.y + (showLbl ? labelH : pad), ih = sr.h - (showLbl ? labelH : pad) - pad;
    const ix = sr.x + pad, iw = sr.w - 2 * pad;
    if (iw <= 2 || ih <= 2) continue;
    for (const t of treemap(sr.items.map((p) => ({ p, value: p.marketValue })), ix, iy, iw, ih)) {
      const pct = heatMetric === 'day' ? t.p.changePct : t.p.unrealizedPct;
      svg += `<g class="hm-tile" data-sym="${esc(t.p.symbol)}" style="cursor:pointer">`;
      svg += `<rect x="${t.x}" y="${t.y}" width="${t.w}" height="${t.h}" fill="${heatColor(pct)}" stroke="#050608" stroke-width="1"/>`;
      if (t.w > 32 && t.h > 24) {
        svg += `<text x="${t.x + t.w / 2}" y="${t.y + t.h / 2 - 1}" fill="#fff" font-size="${Math.min(13, t.w / 4.2)}" font-weight="700" text-anchor="middle">${esc(t.p.symbol)}</text>`;
        svg += `<text x="${t.x + t.w / 2}" y="${t.y + t.h / 2 + 11}" fill="#e6edf3" font-size="9" text-anchor="middle">${signStr(pct)}%</text>`;
      }
      svg += `</g>`;
    }
  }
  box.innerHTML = svg + `</svg>`;
}
$('#heatmap-body').addEventListener('click', (e) => { const g = e.target.closest('[data-sym]'); if (g) selectSymbol(g.dataset.sym); });
$('#heat-metric').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  $$('#heat-metric button').forEach((x) => x.classList.remove('active')); b.classList.add('active');
  heatMetric = b.dataset.metric; renderHeatmap(lastPositions);
});

const PALETTE = ['#ff9e16', '#38bdf8', '#2ec27e', '#ff4d4d', '#a78bfa', '#f472b6', '#facc15', '#34d399', '#60a5fa', '#fb923c', '#94a3b8'];
function renderAllocation(positions) {
  const box = $('#alloc-body');
  if (!positions || !positions.length) { box.innerHTML = '<span class="muted">Add positions to see allocation.</span>'; return; }
  let items;
  if (allocMode === 'sector') {
    const g = {}; positions.forEach((p) => { const c = catCache[p.symbol]?.category || 'Other'; g[c] = (g[c] || 0) + p.marketValue; });
    items = Object.entries(g).map(([label, value]) => ({ label, value }));
  } else items = positions.map((p) => ({ label: p.symbol, value: p.marketValue }));
  items.sort((a, b) => b.value - a.value);
  const total = items.reduce((s, i) => s + i.value, 0) || 1;
  const cx = 70, cy = 70, r = 60, rin = 36; let ang = -Math.PI / 2, paths = '';
  items.forEach((it, i) => {
    const frac = it.value / total, a2 = ang + Math.max(frac, 0.0001) * 2 * Math.PI, col = PALETTE[i % PALETTE.length];
    it.color = col;
    // A single 100% slice would be a degenerate arc (start==end) that draws nothing —
    // render it as a full ring (two stacked circles) instead.
    if (frac >= 0.9999) {
      paths += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${col}" data-sym="${allocMode === 'holding' ? esc(it.label) : ''}"/><circle cx="${cx}" cy="${cy}" r="${rin}" fill="var(--panel)"/>`;
      ang = a2; return;
    }
    const x1 = cx + r * Math.cos(ang), y1 = cy + r * Math.sin(ang), x2 = cx + r * Math.cos(a2), y2 = cy + r * Math.sin(a2);
    const xi1 = cx + rin * Math.cos(a2), yi1 = cy + rin * Math.sin(a2), xi2 = cx + rin * Math.cos(ang), yi2 = cy + rin * Math.sin(ang);
    const large = frac > 0.5 ? 1 : 0;
    paths += `<path d="M${x1} ${y1} A${r} ${r} 0 ${large} 1 ${x2} ${y2} L${xi1} ${yi1} A${rin} ${rin} 0 ${large} 0 ${xi2} ${yi2} Z" fill="${col}" data-sym="${allocMode === 'holding' ? esc(it.label) : ''}"/>`;
    ang = a2;
  });
  const legend = items.slice(0, 11).map((it) => `<div class="lg" data-sym="${allocMode === 'holding' ? esc(it.label) : ''}"><span class="sw" style="background:${it.color}"></span>${esc(it.label).slice(0, 18)}<span class="pct">${(it.value / total * 100).toFixed(1)}%</span></div>`).join('');
  box.innerHTML = `<div class="donut-wrap"><svg width="140" height="140" viewBox="0 0 140 140">${paths}</svg><div class="donut-legend">${legend}</div></div>`;
}
$('#alloc-body').addEventListener('click', (e) => { const g = e.target.closest('[data-sym]'); if (g && g.dataset.sym) selectSymbol(g.dataset.sym); });
$('#alloc-mode').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  $$('#alloc-mode button').forEach((x) => x.classList.remove('active')); b.classList.add('active');
  allocMode = b.dataset.mode; renderAllocation(lastPositions);
});

async function loadPerformance() {
  const box = $('#perf-body');
  if (!lastPositions.length) { box.innerHTML = '<span class="muted">Add positions to see performance over time.</span>'; return; }
  box.innerHTML = '<span class="muted">Loading…</span>';
  try {
    const d = await api('/api/portfolio/performance?range=' + perfRange + baseQS().replace('?', '&'));
    if (!d.points || !d.points.length) { box.innerHTML = '<span class="muted">No data.</span>'; return; }
    const base = d.base || state.base, up = (d.changePct || 0) >= 0;
    box.innerHTML = `<div class="perf-headline"><span class="pv">${money(base, d.end)}</span>` +
      `<span class="${signClass(d.changePct)}">${signStr(d.changePct)}% · ${perfRange.toUpperCase()}</span></div>` +
      sparkline(d.points.map((p) => ({ c: p.value })), up) +
      `<div class="perf-note">Current holdings valued over time (not a replay of past trades).</div>`;
  } catch (e) { box.innerHTML = `<span class="down">${esc(e.message)}</span>`; }
}
$('#perf-ranges').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  $$('#perf-ranges button').forEach((x) => x.classList.remove('active')); b.classList.add('active');
  perfRange = b.dataset.range; loadPerformance();
});

// Called from renderPortfolio whenever positions update.
function renderAnalytics(positions) {
  lastPositions = positions || [];
  renderHeatmap(positions); renderAllocation(positions);
  ensureCategories(positions.map((p) => p.symbol)).then(() => { renderHeatmap(lastPositions); renderAllocation(lastPositions); });
  const sig = state.base + '|' + positions.map((p) => p.symbol + ':' + p.quantity).join(',');
  if (sig !== perfSig) { perfSig = sig; loadPerformance(); }
}

// ===========================================================================
//  UTIL + BOOT + POLLING
// ===========================================================================
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

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
  state.account = v; localStorage.setItem('finsight-account', v); perfSig = '';
  await loadPortfolio();
});
async function newAccountPrompt() {
  const name = (prompt('New account name (e.g. Crypto, SGX, IBKR):') || '').trim();
  if (!name) return;
  try {
    const d = await api('/api/accounts/add', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
    accountsCache = d.accounts; state.account = d.newId; localStorage.setItem('finsight-account', d.newId);
    renderAccountSelector(); perfSig = ''; await loadPortfolio(); setStatus(`Account "${name}" created.`, 'ok');
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
      renderAccountsList(); renderAccountSelector(); perfSig = ''; await loadPortfolio();
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
  loadWatchlist();
  loadAlerts();
  if (!state.selected) loadNews(''); // general market news when nothing selected
  await loadMarkets();
  loadWorldBank();
  loadFred();
  loadCalendar();
  setFooter(`READY · base ${state.base} · live data refreshing every 15s`);
  startPolling();
}
// Live polling, startable/stoppable so it pauses while the app is locked (otherwise
// each poll 401s and re-triggers the lock screen, wiping the PIN being typed).
let pollTimers = [];
function startPolling() {
  stopPolling();
  pollTimers.push(
    setInterval(loadPortfolio, 15000),
    setInterval(loadMarkets, 15000),
    setInterval(loadWatchlist, 15000),
    setInterval(loadAlerts, 15000), // evaluates + fires notifications
    setInterval(() => { if (state.selected) loadDetail(); }, 30000),
    // macro panels change slowly — auto-refresh every 15 min (the LOAD buttons still work)
    setInterval(loadWorldBank, 15 * 60000),
    setInterval(loadFred, 15 * 60000),
    setInterval(loadCalendar, 15 * 60000),
  );
}
function stopPolling() { pollTimers.forEach(clearInterval); pollTimers = []; }
// ===========================================================================
//  PIN LOCK
// ===========================================================================
let booted = false, lockMode = 'enter';
function showLock(mode) {
  const wasLocked = document.body.classList.contains('locked');
  lockMode = mode;
  document.body.classList.add('locked');
  stopPolling(); // no background 401s while locked
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
  if (!booted) { booted = true; boot(); }
  else startPolling(); // resume polling after unlocking
}
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

async function checkAuth() {
  let st;
  try { st = await api('/api/auth/status'); } catch { st = { pinSet: false, authed: false }; }
  if (st.authed) showApp();
  else showLock(st.pinSet ? 'enter' : 'create');
}
checkAuth();
