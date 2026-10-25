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
      setStatus(`Dividend withholding for ${mkt.toUpperCase()} set to ${pct}%`, 'ok'); loadDividends(); afterWrite('withholding'); return;
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

// Dividends and FX risk move with holdings, cash and slow FX rates, not every
// 15s quote tick: refetch them when the holdings/cash/account/base change, or
// at most every 2 minutes otherwise.
let sideSig = '', sideAt = 0;
const SIDE_MAX_AGE = 120000;
let portfolioRequest = 0;
async function loadPortfolio() {
  const request = ++portfolioRequest, query = baseQS();
  try {
    const data = await api('/api/portfolio' + query);
    if (request !== portfolioRequest || query !== baseQS()) return;
    renderPortfolio(data);
    const sig = state.account + '|' + state.base + '|' + (data.positions || []).map((p) => p.symbol + ':' + p.quantity).join(',') + '|' + JSON.stringify(data.cash || []);
    if (sig !== sideSig || Date.now() - sideAt > SIDE_MAX_AGE) {
      sideSig = sig; sideAt = Date.now();
      loadDividends(); // keep dividend panel in sync with the active account/base
      loadFxRisk();    // keep FX-risk panel + exposure card in sync too
    }
  } catch (e) { if (request === portfolioRequest && query === baseQS()) setFooter('Portfolio load failed: ' + e.message); }
}

// Every completed write refreshes all readers of what it changed (COUPLING.md
// §A6, web/src/api/invalidation.ts). Islands refetch through Query; legacy
// readers registered here refresh themselves. Dividends, FX risk, performance
// and wealth still follow loadPortfolio's signatures until B3/C2/C3.
function afterWrite(kind) { return window.FinSight.bus.write(kind); }
window.FinSight.bus.on('portfolio', () => loadPortfolio());
window.FinSight.bus.on('accounts', () => loadAccounts());
window.FinSight.bus.on('watchlist', () => loadWatchlist());
window.FinSight.bus.on('alerts', () => loadAlerts());

function renderPortfolio(data) {
  const { positions, summary, transactions } = data;
  const base = data.base || state.base;
  lastSummary = summary; // read by the legacy FX risk panel (C2)
  // FX coverage note
  if (data.fxMissing && data.fxMissing.length) setFooter(`Note: no FX rate for ${data.fxMissing.join(', ')} → shown unconverted.`);

  // The positions table is a React island (D1). The detail view and the chart
  // watch feed still read lastTableData until E1/E2.
  lastTableData = { positions, base };
  pushChartWatch();
  // activity
  $('#activity').innerHTML = (transactions || []).map((t) => {
    const cls = t.type === 'BUY' ? 't-buy' : t.type === 'SELL' ? 't-sell' : 't-del';
    const when = new Date(t.time).toLocaleString('en-US', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    let detail = t.type === 'DELETE' ? 'removed'
      : `${fmt(t.quantity, t.quantity % 1 ? 4 : 0)} @ ${fmt(t.price)}` + (t.realized != null ? `  ·  P&L ${signStr(t.realized)}` : '');
    return `<div class="line"><span class="ts">${when}</span><span class="${cls}">${t.type}</span><span class="sym amber">${esc(t.symbol)}</span><span class="muted">${detail}</span></div>`;
  }).join('') || '<div class="muted small">No transactions yet.</div>';


}

// ---- FX RISK panel ---------------------------------------------------------
async function loadFxRisk() {
  try {
    const data = await api('/api/fx-risk' + baseQS());
    renderFxRisk(data); // the FX EXPOSURE card reads /api/fx-risk itself (useFxRisk)
  } catch (e) { /* non-fatal — panel just keeps its last state */ }
}

// Tool inputs survive the 15s re-render; a render is deferred while you type.
const fxTools = { conv: '', shock: '0' };
let fxPending = null;
function renderFxRisk(data) {
  const box = $('#fxrisk'); if (!box) return;
  const ae = document.activeElement;
  if (ae && box.contains(ae) && ae.tagName === 'INPUT') {
    fxPending = data;
    if (!ae.dataset.fxBlur) { ae.dataset.fxBlur = '1'; ae.addEventListener('blur', () => { const d = fxPending; fxPending = null; if (d) renderFxRisk(d); }, { once: true }); }
    return;
  }
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
    <div class="fxr-cell"><span class="k">${e.ccy} EXPOSURE</span><span class="v">${moneyBig(base, e.notionalBase)}</span><span class="s">${fmt(e.pct, 0)}% of book · ${money(e.ccy, e.notionalNative, 0)}${e.cashBase ? ' · incl. cash' : ''}</span></div>
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
      <td>${when}</td><td class="sym">${esc(l.symbol)}</td>
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
    <div class="fxr-tools">
      <div class="tool"><span class="fxr-sub" style="margin:0">TARGET EXPOSURE</span><br>
        Keep <input id="fxr-target" type="number" min="0" max="100" step="1" placeholder="e.g. 70"> % in foreign currency
        <div id="fxr-target-out" class="muted"></div></div>
      <div class="tool"><span class="fxr-sub" style="margin:0">CONVERT NOW vs LATER · ${dom.ccy}</span><br>
        Convert <input id="fxr-conv" type="number" min="0" step="100" placeholder="${base} amount"> ${base}
        <div id="fxr-conv-out" class="muted"></div></div>
    </div>
    <div class="fxr-note">Currency risk adds volatility with little long-run expected return — it bites most over short horizons and drawdowns. Informational only; no trades are placed.</div>`;

  const slider = $('#fxr-slider');
  slider.value = fxTools.shock;
  const upd = () => {
    fxTools.shock = slider.value;
    const pct = parseFloat(slider.value);
    const impact = totalExp * pct / 100;
    $('#fxr-shock').textContent = (pct > 0 ? '+' : '') + pct.toFixed(1) + '%';
    const imp = $('#fxr-impact'); imp.textContent = moneySigned(base, impact); imp.className = signClass(impact);
    $('#fxr-newval').textContent = money(base, totalExp + impact);
  };
  slider.addEventListener('input', upd); upd();

  // Target exposure: gap between today's foreign share and the one you want.
  const total = data.totalValue || 0;
  const tIn = $('#fxr-target'), tOut = $('#fxr-target-out');
  try { tIn.value = localStorage.getItem('finsight-fx-target') || ''; } catch {}
  const updTarget = () => {
    const pct = parseFloat(tIn.value);
    try { localStorage.setItem('finsight-fx-target', tIn.value); } catch {}
    const cur = total ? (totalExp / total) * 100 : 0;
    if (!Number.isFinite(pct) || !total) { tOut.innerHTML = `Now <b>${fmt(cur, 1)}%</b> foreign (${money(base, totalExp, 0)} of ${money(base, total, 0)}).`; return; }
    const gap = (pct / 100) * total - totalExp;
    tOut.innerHTML = `Now <b>${fmt(cur, 1)}%</b>. ` + (Math.abs(gap) < total * 0.005 ? '<span class="up">On target.</span>'
      : gap > 0 ? `To reach ${fmt(pct, 0)}%: move <b>${money(base, gap, 0)}</b> into foreign currency.`
        : `To reach ${fmt(pct, 0)}%: bring <b>${money(base, -gap, 0)}</b> back to ${base}.`);
  };
  tIn.addEventListener('input', updTarget); updTarget();

  // Convert now vs later: what the amount buys at spot, and the typical 1-month
  // range from recent volatility (68% band). Shows the spread, not a forecast.
  const cIn = $('#fxr-conv'), cOut = $('#fxr-conv-out');
  cIn.value = fxTools.conv;
  const sigmaM = (dom.sigmaWeeklyPct || 0) / 100 * Math.sqrt(4.345);
  const updConv = () => {
    fxTools.conv = cIn.value;
    const amt = parseFloat(cIn.value);
    if (!(amt > 0)) { cOut.innerHTML = `Spot ${fmt(dom.nowRate, 4)} · your blended entry ${fmt(dom.blendedEntry, 4)} (${signStr(dom.driftPct)}%).`; return; }
    const now = amt / dom.nowRate;
    let html = `Now: <b>${money(dom.ccy, now, 0)}</b> at ${fmt(dom.nowRate, 4)}.`;
    if (sigmaM > 0) {
      const lo = dom.nowRate * Math.exp(-sigmaM), hi = dom.nowRate * Math.exp(sigmaM);
      html += `<br>In a month, 2 in 3 outcomes: <b>${money(dom.ccy, amt / hi, 0)} – ${money(dom.ccy, amt / lo, 0)}</b> (rate ${fmt(lo, 4)}–${fmt(hi, 4)}). Waiting is a ±${money(dom.ccy, now - amt / hi, 0)} coin flip.`;
    }
    cOut.innerHTML = html;
  };
  cIn.addEventListener('input', updConv); updConv();
}

// ---- ECON CALENDAR panel ---------------------------------------------------
async function loadCalendar() {
  try {
    const [cal, ev] = await Promise.all([api('/api/calendar'), api('/api/events' + baseQS()).catch(() => null)]);
    renderCalendar(cal, ev);
  } catch (e) { const b = $('#calendar'); if (b) { b.classList.add('muted'); b.textContent = 'Calendar unavailable right now.'; } }
}
function renderCalendar(data, ev) {
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

  // Earnings + ex-dividend dates for what you hold / watch.
  let mine = '';
  if (ev && ev.events) {
    const d2 = (ms) => new Date(ms).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: '2-digit' });
    const evRows = ev.events.slice(0, 14).map((e) => `<div class="cal-row" data-sym="${esc(e.symbol)}" style="cursor:pointer">
      <span class="cal-when">${d2(e.t)}${e.estimated ? ' <span class="dim">~</span>' : ''}</span>
      <span class="ev-kind ${e.kind === 'EARNINGS' ? 'earn' : 'div'}">${e.kind}</span>
      <span class="cal-title"><span class="sym amber">${esc(e.symbol)}</span>${e.held ? '' : ' <span class="dim">watch</span>'}</span>
      ${e.amount ? `<span class="cal-fp">~${fmt(e.amount, 2)}/sh</span>` : ''}</div>`).join('');
    mine = `<div class="fxr-sub">YOUR HOLDINGS · next 60 days (earnings · ex-dividend)</div>` +
      (evRows || `<div class="muted small">${ev.ok ? 'No earnings or ex-dividend dates in the next 60 days.' : 'Company dates unavailable right now.'}</div>`);
  }
  box.innerHTML = anchor + mine + `<div class="fxr-sub">THIS WEEK · high-impact (USD/SGD)</div>` + rows;
}
$('#calendar').addEventListener('click', (e) => { const r = e.target.closest('[data-sym]'); if (r) selectSymbol(r.dataset.sym); });

// ---- customizable summary cards --------------------------------------------
// Summary cards are a React island (web/src/features/summary, PILOT-2).
let lastSummary = null; // adapter: the legacy FX risk panel reads realized FX from it until C2
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
// lastTableData feeds the detail view and the chart watch list until E1/E2.
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
// World Markets is a React island (web/src/features/markets, PILOT-1).

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
//  US INFLATION GAUGES — official CPI/PCE + trimmed-mean measures (FRED, no key)
//  ★ = trimmed/median family: Fed Chair Warsh's preferred "underlying inflation"
//  gauges (they strip outlier price moves instead of fixed food/energy buckets).
// ===========================================================================
const INFL_GAUGES = [
  { s: 'CPIAUCSL', t: 'pc1', name: 'CPI (headline)', src: 'BLS' },
  { s: 'CPILFESL', t: 'pc1', name: 'Core CPI', src: 'BLS' },
  { s: 'PCEPI', t: 'pc1', name: 'PCE (headline)', src: 'BEA · Fed 2% target' },
  { s: 'PCEPILFE', t: 'pc1', name: 'Core PCE', src: 'BEA' },
  { s: 'PCETRIM12M159SFRBDAL', t: 'lin', name: '★ Trimmed Mean PCE', src: 'Dallas Fed' },
  { s: 'MEDCPIM159SFRBCLE', t: 'lin', name: '★ Median CPI', src: 'Cleveland Fed' },
  { s: 'TRMMEANCPIM159SFRBCLE', t: 'lin', name: '★ Trimmed Mean CPI', src: 'Cleveland Fed' },
];
function inflClass(v) {
  const d = v - 2.0;
  if (d <= 0.3) return 'up';
  if (d <= 1.0) return 'warn';
  return 'down';
}
async function loadInflation() {
  const body = $('#infl-body');
  body.innerHTML = '<span class="muted">Loading inflation gauges…</span>';
  try {
    const results = await Promise.all(
      INFL_GAUGES.map((g) => api(`/api/fred?series=${g.s}&transform=${g.t}`).catch(() => null))
    );
    const ff = await api('/api/fred?series=FEDFUNDS&transform=lin').catch(() => null);
    const rows = INFL_GAUGES.map((g, i) => {
      const d = results[i];
      if (!d || !d.points || !d.points.length) return `<div class="infl-row"><span class="infl-name">${esc(g.name)}</span><span class="muted small">n/a</span></div>`;
      const last = d.points[d.points.length - 1];
      const prev = d.points[d.points.length - 2];
      const mom = prev ? last.value - prev.value : 0;
      const when = new Date(last.date).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
      return `<div class="infl-row" title="${esc(g.src)}">
        <span class="infl-name">${esc(g.name)} <span class="dim small">${esc(g.src)}</span></span>
        <span class="infl-mom ${mom > 0.005 ? 'down' : mom < -0.005 ? 'up' : 'dim'}">${mom > 0.005 ? '▲' : mom < -0.005 ? '▼' : '·'} ${fmt(Math.abs(mom), 2)}</span>
        <span class="infl-val ${inflClass(last.value)}">${fmt(last.value, 2)}%</span>
        <span class="infl-date dim">${when}</span></div>`;
    }).join('');
    const ffLast = ff && ff.points && ff.points.length ? ff.points[ff.points.length - 1].value : null;
    body.innerHTML = `${rows}
      <div class="infl-note">Fed target: 2% (PCE)${ffLast != null ? ` · Fed funds: ${fmt(ffLast, 2)}%` : ''} · monthly YoY, latest release
      <br>★ Trimmed/median gauges — Chair Warsh's preferred read of underlying inflation: rank all price changes, drop the extreme tails (Dallas trims bottom 24% / top 31% of the PCE basket), average the rest. ▲▼ = change vs prior month.</div>`;
  } catch (e) { body.innerHTML = `<span class="down">Inflation gauges error: ${esc(e.message)}</span>`; }
}
$('#infl-go').addEventListener('click', loadInflation);

// ===========================================================================
//  DIVIDENDS (income received, from broker imports)
// ===========================================================================
async function loadDividends() {
  const box = $('#dividends');
  try {
    const d = await api('/api/dividends' + baseQS());
    const base = d.base || state.base;
    const rc = d.received || { ttm: { gross: d.ttm, tax: 0, net: d.ttm }, total: { gross: d.total, tax: 0, net: d.total } };
    const fw = d.forwardTotal || { gross: 0, tax: 0, net: 0 };
    $('#div-ttm').textContent = fw.net ? 'FWD ' + money(base, fw.net, 0) + '/yr net' : (d.count ? 'TTM ' + money(base, rc.ttm.net) : '');
    if (!d.count && !(d.forward || []).length) { box.innerHTML = '<span class="muted">No dividends yet — hold dividend payers, or import an IBKR statement to track income received.</span>'; return; }
    const cell = (k, v, sub, cls) => `<div class="fxr-cell"><span class="k">${k}</span><span class="v ${cls || ''}">${v}</span><span class="s">${sub}</span></div>`;
    const strip = [
      fw.gross ? cell('FORWARD / YR', money(base, fw.net, 0), `net · ${money(base, fw.gross, 0)} gross`, 'up') : '',
      fw.tax ? cell('WITHHOLDING / YR', money(base, fw.tax, 0), 'tax at source (est.)', 'down') : '',
      d.count ? cell('RECEIVED · 12M', money(base, rc.ttm.net, 0), `net · ${money(base, rc.ttm.tax, 0)} withheld`) : '',
      d.count ? cell('ALL-TIME', money(base, rc.total.net, 0), `net · ${d.count} payments`) : '',
    ].join('');
    const dd = (ms) => ms ? new Date(ms).toLocaleDateString('en-US', { month: 'short', day: '2-digit' }) : '—';
    const fwdRows = (d.forward || []).map((f) => `<tr>
      <td class="sym">${esc(f.symbol)}</td>
      <td class="r">${fmt(f.perShare, 2)} <span class="dim">${esc(f.currency)}</span></td>
      <td class="r">${f.yieldOnCost != null ? fmt(f.yieldOnCost, 2) + '%' : '—'}</td>
      <td class="r">${f.currentYield != null ? fmt(f.currentYield, 2) + '%' : '—'}</td>
      <td class="r up">${money(base, f.annualNet, 0)}</td>
      <td class="r">${dd(f.nextEx)}${f.nextExEstimated ? '<span class="dim">~</span>' : ''}</td></tr>`).join('');
    const recent = (d.recent || []).slice(0, 8).map((r) => `<div class="dr"><span>${esc(r.date)}</span><span class="ds">${esc(r.symbol)}</span>` +
      `<span>${money(base, r.baseNet ?? r.baseAmount)}${r.baseTax ? ` <span class="dim">(−${money(base, r.baseTax)}${r.whtActual ? '' : ' est.'})</span>` : ''}</span></div>`).join('');
    const w = d.withholding || {};
    box.innerHTML = `<div class="div-strip">${strip}</div>` +
      (fwdRows ? `<div class="fxr-sub">FORWARD INCOME · current holdings</div><table class="tbl div-tbl"><thead><tr><th>SYM</th><th class="r">/SHARE·YR</th><th class="r">YOC</th><th class="r">YIELD</th><th class="r">NET/YR</th><th class="r">NEXT EX</th></tr></thead><tbody>${fwdRows}</tbody></table>` : '') +
      (recent ? `<div class="fxr-sub">RECEIVED · net of withholding</div><div class="div-recent">${recent}</div>` : '') +
      `<div class="fxr-note">Withholding assumed: US ${w.US ?? 30}% · SG ${w.SG ?? 0}% · HK ${w.HK ?? 0}% · EU ${w.EU ?? 15}% (IBKR statements use the actual tax). Change with <b>WHT US 15</b>. ~ = estimated from payment history. YOC = yield on your cost.</div>`;
  } catch (e) { box.innerHTML = `<span class="down">${esc(e.message)}</span>`; }
}

// ===========================================================================
//  WATCHLIST
// ===========================================================================
async function loadWatchlist() {
  try { renderWatchlist((await api('/api/watchlist')).watchlist); } catch {}
}
function renderWatchlist(list) {
  lastWatch = list || []; pushChartWatch();
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
function renderAlerts(alerts, fromChart) {
  alerts = alerts || [];
  if (notifiedAlerts === null) {
    notifiedAlerts = new Set(alerts.filter((a) => a.triggeredAt).map((a) => a.id));
  } else {
    alerts.forEach((a) => {
      if (a.met && a.triggeredAt && !notifiedAlerts.has(a.id)) {
        notifiedAlerts.add(a.id);
        notify('ALERT', `${a.label || a.symbol} — now ${a.currentValue != null ? fmt(a.currentValue) : fmt(a.currentPrice)}`);
      }
    });
  }
  // charts draw their symbol's alerts; they also post here after adding one
  window.__finAlerts = alerts;
  if (!fromChart) window.dispatchEvent(new CustomEvent('finsight:alerts', { detail: { alerts, from: 'app' } }));
  $('#alerts').innerHTML = alerts.length ? alerts.map((a) => `
    <div class="al-row ${a.met ? 'met' : ''}">
      <div><span class="al-sym" data-sym="${esc(a.symbol)}">${esc(a.symbol)}</span> <span class="al-cond">${esc((a.label || '').replace(a.symbol + ' ', ''))}</span>
        <span class="muted small">now ${a.currentValue != null ? fmt(a.currentValue) : '—'}${a.level != null && a.kind !== 'price' ? ' · level ' + fmt(a.level) : ''}</span></div>
      <span class="al-badge">${a.met ? 'TRIGGERED' : 'armed'}</span>
      <button class="al-x" data-id="${esc(a.id)}">✕</button></div>`).join('')
    : '<div class="al-empty">No alerts — add one above, type <b>ALERT AAPL > 320</b>, or use the bell on the chart (price, trend line, RSI, moving average).</div>';
}
window.addEventListener('finsight:alerts', (e) => { if (e.detail && e.detail.from === 'chart') renderAlerts(e.detail.alerts, true); });
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
  const sy = e.target.closest('.al-sym'); if (sy) return selectSymbol(sy.dataset.sym);
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
  loadCalendar(); // holdings' earnings / ex-div dates follow the account
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
  loadWatchlist();
  loadAlerts();
  loadWorldBank();
  loadFred();
  loadCalendar();
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
    setInterval(loadWatchlist, 15000),
    setInterval(loadAlerts, 30000), // the server also evaluates alerts every minute and notifies
    // macro panels change slowly — auto-refresh every 15 min (the LOAD buttons still work)
    setInterval(loadWorldBank, 15 * 60000),
    setInterval(loadFred, 15 * 60000),
    setInterval(loadCalendar, 15 * 60000),
  );
}
function stopTimers() { pollTimers.forEach(clearInterval); pollTimers = []; }
function stopPolling() { pollWanted = false; stopTimers(); }
document.addEventListener('visibilitychange', () => {
  if (!pollWanted) return;
  if (document.hidden) { hiddenAt = Date.now(); stopTimers(); return; }
  // back in view: refresh what went stale, then resume the timers
  if (Date.now() - hiddenAt > 10000) {
    loadPortfolio(); window.FinSight.bus.invalidate('markets'); loadWatchlist(); loadAlerts();
    window.FinSight.bus.invalidate('quote'); // the detail island re-reads the quote
    if (Date.now() - hiddenAt > 15 * 60000) { loadWorldBank(); loadFred(); loadCalendar(); }
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
