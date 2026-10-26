/* FinSight — trade journal UI (window.FinJournal).
 * Log ideas, paper, replay and live trades with plan, exits, rule-following,
 * notes and a chart snapshot. Data lives on the local server (/api/journal*);
 * this only records — it never places orders.
 */
(function () {
  'use strict';

  const KINDS = [['idea', 'Idea'], ['paper', 'Paper'], ['replay', 'Replay'], ['live', 'Live']];
  const STATUSES = [['watching', 'Watching'], ['open', 'Open'], ['closed', 'Closed'], ['cancelled', 'Cancelled']];
  const RULES = [['', '—'], ['yes', 'Yes'], ['partial', 'Partly'], ['no', 'No']];
  const esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  const num = function (v) { if (v === '' || v == null) return null; const n = Number(String(v).replace(/,/g, '')); return isFinite(n) ? n : NaN; };
  const f2 = function (v, d) { return v == null || !isFinite(v) ? '—' : Number(v).toFixed(d == null ? 2 : d); };
  const sR = function (v) { return v == null || !isFinite(v) ? '—' : (v >= 0 ? '+' : '') + v.toFixed(2) + 'R'; };
  const opt = function (list, val) { return list.map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === val ? ' selected' : '') + '>' + o[1] + '</option>'; }).join(''); };

  async function api(path, body) {
    const r = await fetch(path, body === undefined ? { credentials: 'same-origin' } : { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(function () { return {}; });
    if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
    return j;
  }

  // Same definitions as lib/journal.ts metrics(): R measured on the initial stop.
  function metrics(e) {
    const m = { riskPerUnit: null, stopPct: null, plannedRR: null, riskAmount: null, exitedQty: 0, remaining: null, netPnl: null, netR: null };
    const sgn = e.side === 'short' ? -1 : 1;
    if (e.entry != null && e.stop != null && isFinite(e.entry) && isFinite(e.stop)) {
      m.riskPerUnit = Math.abs(e.entry - e.stop);
      m.stopPct = e.entry ? m.riskPerUnit / e.entry * 100 : null;
      if (e.target != null && m.riskPerUnit > 0) m.plannedRR = sgn * (e.target - e.entry) / m.riskPerUnit;
      if (e.qty != null) m.riskAmount = m.riskPerUnit * e.qty;
    }
    const exits = (e.exits || []).filter(function (x) { return x.price > 0 && x.qty > 0; });
    m.exitedQty = exits.reduce(function (a, x) { return a + x.qty; }, 0);
    if (e.qty != null) m.remaining = Math.max(0, e.qty - m.exitedQty);
    const closed = e.status === 'closed' || (e.qty > 0 && m.remaining === 0);
    if (e.entry != null && m.exitedQty > 0) {
      m.netPnl = sgn * exits.reduce(function (a, x) { return a + x.qty * (x.price - e.entry); }, 0) - (e.fees || 0);
      if (closed && m.riskPerUnit > 0 && e.qty) m.netR = m.netPnl / (m.riskPerUnit * e.qty);
    }
    return m;
  }

  let modal = null, state = { view: 'list', entries: [], stats: null, byKind: {}, filter: { kind: '', status: '', q: '' }, opts: {}, current: null, img: null };

  function ensureModal() {
    if (modal) return modal;
    modal = document.createElement('div');
    modal.className = 'modal jr-modal hidden';
    modal.innerHTML = '<div class="modal-box jr-box"><div class="modal-head"><span class="panel-title jr-title">TRADE JOURNAL</span><button type="button" class="x-btn jr-x">✕</button></div><div class="modal-body jr-body"></div></div>';
    document.body.appendChild(modal);
    modal.querySelector('.jr-x').addEventListener('click', close);
    modal.addEventListener('mousedown', function (e) { if (e.target === modal) close(); });
    modal.addEventListener('keydown', function (e) {
      e.stopPropagation(); // keep chart shortcuts (Esc, Delete, ⌥-keys) out of the form
      if (e.key === 'Escape') { if (state.view === 'form' && state.dirty && !window.confirm('Discard unsaved changes?')) return; close(); }
    });
    return modal;
  }
  function open() { ensureModal().classList.remove('hidden'); }
  function close() { if (modal) modal.classList.add('hidden'); state.dirty = false; }
  function body() { return modal.querySelector('.jr-body'); }
  function title(t) { modal.querySelector('.jr-title').textContent = t; }

  async function refresh() {
    const r = await api('/api/journal');
    state.entries = r.entries || []; state.stats = r.stats; state.byKind = r.byKind || {};
  }

  // ---------------------------------------------------------------- list view
  function statLine(s, label) {
    if (!s || !s.n) return '<div class="jr-stat"><b>' + label + '</b><span class="muted">no closed trades</span></div>';
    return '<div class="jr-stat"><b>' + label + '</b>' +
      '<span>' + s.n + ' closed</span><span>win ' + (s.winRate * 100).toFixed(0) + '%</span>' +
      '<span>avg ' + sR(s.avgWin) + ' / ' + sR(s.avgLoss) + '</span>' +
      '<span class="' + (s.expectancy >= 0 ? 'up' : 'down') + '">exp ' + sR(s.expectancy) + '</span>' +
      '<span>total ' + sR(s.totalR) + '</span><span>worst streak ' + s.maxLossStreak + '</span>' +
      (s.ruleRate != null ? '<span>rules followed ' + (s.ruleRate * 100).toFixed(0) + '%</span>' : '') + '</div>';
  }
  function renderList() {
    state.view = 'list'; title('TRADE JOURNAL');
    const f = state.filter;
    const rows = state.entries.filter(function (e) {
      return (!f.kind || e.kind === f.kind) && (!f.status || e.status === f.status) &&
        (!f.q || (e.symbol + ' ' + e.tags.join(' ') + ' ' + e.setup).toLowerCase().indexOf(f.q.toLowerCase()) >= 0);
    });
    body().innerHTML =
      '<div class="jr-stats">' + statLine(state.stats, 'All') + ['paper', 'replay', 'live'].map(function (k) { return statLine(state.byKind[k], k[0].toUpperCase() + k.slice(1)); }).join('') + '</div>' +
      '<div class="jr-toolbar">' +
        '<button type="button" class="mini-btn solid" data-a="new">+ NEW ENTRY</button>' +
        '<select data-f="kind"><option value="">All kinds</option>' + opt(KINDS, f.kind) + '</select>' +
        '<select data-f="status"><option value="">All statuses</option>' + opt(STATUSES, f.status) + '</select>' +
        '<input data-f="q" placeholder="Search symbol / tag / setup" value="' + esc(f.q) + '">' +
        '<span class="jr-sp"></span><a class="mini-btn" href="/api/journal/csv" download="finsight-journal.csv">EXPORT CSV</a>' +
      '</div>' +
      (rows.length ? '<div class="jr-tablewrap"><table class="jr-table"><thead><tr><th>Date</th><th>Symbol</th><th>Kind</th><th>Side</th><th>Status</th><th>Entry</th><th>Stop</th><th>Target</th><th>Qty</th><th>Plan R:R</th><th>Net</th><th>Net R</th><th>Rules</th><th>Tags</th><th></th></tr></thead><tbody>' +
        rows.map(function (e) {
          const m = e.m || metrics(e);
          return '<tr data-id="' + e.id + '"><td>' + esc(e.entryDate || new Date(e.created).toISOString().slice(0, 10)) + '</td><td class="amber">' + esc(e.symbol) + '</td><td>' + esc(e.kind) + '</td>' +
            '<td class="' + (e.side === 'short' ? 'down' : 'up') + '">' + esc(e.side) + '</td><td>' + esc(e.status) + '</td>' +
            '<td>' + f2(e.entry) + '</td><td>' + f2(e.stop) + '</td><td>' + f2(e.target) + '</td><td>' + (e.qty == null ? '—' : e.qty) + '</td>' +
            '<td>' + f2(m.plannedRR) + '</td><td class="' + (m.netPnl > 0 ? 'up' : m.netPnl < 0 ? 'down' : '') + '">' + f2(m.netPnl) + '</td>' +
            '<td class="' + (m.netR > 0 ? 'up' : m.netR < 0 ? 'down' : '') + '">' + sR(m.netR) + '</td><td>' + esc(e.rule || '—') + '</td>' +
            '<td>' + esc(e.tags.join(', ')) + '</td><td>' + (e.hasImage ? '📷' : '') + '</td></tr>';
        }).join('') + '</tbody></table></div>'
        : '<div class="jr-empty">No entries yet. Use <b>Log</b> on the chart (it captures the setup, levels and a snapshot) or <b>+ New entry</b>.</div>') +
      '<div class="jr-note">R is measured on the initial stop. Statistics use closed entries with entry, stop, quantity and exits. A record of what you planned and did — not advice, and nothing here places an order.</div>';
    const b = body();
    b.querySelector('[data-a=new]').onclick = function () { renderForm({ kind: 'paper', status: 'watching', side: 'long', exits: [], tags: [] }, null); };
    b.querySelectorAll('[data-f]').forEach(function (el) {
      const ev = el.tagName === 'INPUT' ? 'input' : 'change';
      el.addEventListener(ev, function () { state.filter[el.dataset.f] = el.value; renderList(); const q = body().querySelector('[data-f=q]'); if (el.dataset.f === 'q') { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } });
    });
    b.querySelectorAll('tbody tr').forEach(function (tr) {
      tr.onclick = function () { const e = state.entries.find(function (x) { return x.id === tr.dataset.id; }); if (e) renderForm(e, null); };
    });
  }

  // ---------------------------------------------------------------- form view
  function field(label, html, cls) { return '<label class="jr-f' + (cls ? ' ' + cls : '') + '"><span>' + label + '</span>' + html + '</label>'; }
  function inp(name, val, attrs) { return '<input name="' + name + '" value="' + esc(val == null ? '' : val) + '" ' + (attrs || '') + '>'; }

  function renderForm(e, img) {
    state.view = 'form'; state.current = e; state.img = img; state.dirty = false;
    title(e.id ? 'JOURNAL · ' + e.symbol : 'LOG A SETUP / TRADE');
    const exits = (e.exits || []).slice();
    body().innerHTML =
      '<form class="jr-form" autocomplete="off">' +
      '<div class="jr-cols"><div class="jr-left">' +
        '<div class="jr-grid">' +
          field('Symbol', inp('symbol', e.symbol, 'required maxlength="24" style="text-transform:uppercase"')) +
          field('Kind', '<select name="kind">' + opt(KINDS, e.kind || 'idea') + '</select>') +
          field('Status', '<select name="status">' + opt(STATUSES, e.status || 'watching') + '</select>') +
          field('Side', '<select name="side">' + opt([['long', 'Long'], ['short', 'Short']], e.side || 'long') + '</select>') +
          field('Date', inp('entryDate', e.entryDate || new Date().toISOString().slice(0, 10), 'type="date"')) +
          field('Timeframe', inp('interval', e.interval, 'maxlength="8"')) +
          field('Entry', inp('entry', e.entry, 'inputmode="decimal"')) +
          field('Stop (initial)', inp('stop', e.stop, 'inputmode="decimal"')) +
          field('Target', inp('target', e.target, 'inputmode="decimal"')) +
          field('Quantity', inp('qty', e.qty, 'inputmode="decimal"')) +
          field('Fees (total)', inp('fees', e.fees, 'inputmode="decimal"')) +
          field('Rules followed?', '<select name="rule">' + opt(RULES, e.rule || '') + '</select>') +
        '</div>' +
        field('Setup', inp('setup', e.setup, 'maxlength="120" placeholder="e.g. Pullback to 21 EMA, break of prior high"'), 'wide') +
        field('Tags', inp('tags', (e.tags || []).join(', '), 'placeholder="pullback, earnings, A+"'), 'wide') +
        '<div class="jr-metrics"></div>' +
        '<div class="jr-exits"><div class="jr-sub">Exits <button type="button" class="mini-btn" data-a="addexit">+ ADD EXIT</button></div><div class="jr-exrows"></div></div>' +
        field('Notes (thesis, context, what you saw)', '<textarea name="notes" rows="4" maxlength="5000">' + esc(e.notes || '') + '</textarea>', 'wide') +
        field('Lesson / review', '<textarea name="lesson" rows="2" maxlength="2000">' + esc(e.lesson || '') + '</textarea>', 'wide') +
        field('Ledger reference (optional)', inp('ledgerRef', e.ledgerRef, 'maxlength="80" placeholder="e.g. IBKR fill id — the journal does not change your ledger"'), 'wide') +
      '</div><div class="jr-right">' +
        '<div class="jr-sub">Chart snapshot</div>' +
        '<div class="jr-img">' + (img ? '<img src="' + img + '" alt="chart snapshot">' : e.id && e.hasImage ? '<img src="/api/journal/image?id=' + e.id + '&v=' + (e.updated || 0) + '" alt="chart snapshot">' : '<div class="muted small">No snapshot. Use Log on the chart to capture one.</div>') + '</div>' +
        (e.chartAt ? '<div class="muted small">Chart as of ' + esc(new Date(e.chartAt).toISOString().slice(0, 16).replace('T', ' ')) + ' UTC' + (e.price != null ? ' · last ' + f2(e.price) : '') + '</div>' : '') +
      '</div></div>' +
      '<div class="jr-err"></div>' +
      '<div class="jr-foot">' +
        '<button type="button" class="mini-btn" data-a="back">← LIST</button>' +
        (e.id ? '<button type="button" class="mini-btn" data-a="del">DELETE</button>' : '') +
        (state.opts.onOpenChart ? '<button type="button" class="mini-btn" data-a="chart">OPEN CHART</button>' : '') +
        '<span class="jr-sp"></span>' +
        '<button type="submit" class="mini-btn solid">' + (e.id ? 'SAVE' : 'SAVE TO JOURNAL') + '</button>' +
      '</div></form>';
    const form = body().querySelector('form'), exRows = form.querySelector('.jr-exrows');
    const renderExits = function () {
      exRows.innerHTML = exits.length ? exits.map(function (x, k) {
        return '<div class="jr-exrow" data-k="' + k + '"><input data-x="date" type="date" value="' + esc(x.date || '') + '"><input data-x="qty" placeholder="qty" inputmode="decimal" value="' + esc(x.qty == null ? '' : x.qty) + '"><input data-x="price" placeholder="price" inputmode="decimal" value="' + esc(x.price == null ? '' : x.price) + '"><input data-x="note" placeholder="note (3R, stop, EMA9…)" maxlength="80" value="' + esc(x.note || '') + '"><button type="button" class="x-btn" data-a="rmexit">✕</button></div>';
      }).join('') : '<div class="muted small">No exits yet. Add one per partial sale; R is computed when the position is fully exited or marked closed.</div>';
    };
    const read = function () {
      const fd = new FormData(form), o = {};
      ['symbol', 'kind', 'status', 'side', 'entryDate', 'interval', 'setup', 'tags', 'rule', 'notes', 'lesson', 'ledgerRef'].forEach(function (k) { o[k] = (fd.get(k) || '').toString(); });
      ['entry', 'stop', 'target', 'qty', 'fees'].forEach(function (k) { o[k] = num(fd.get(k)); });
      o.exits = exits.map(function (x) { return { date: x.date || '', qty: num(x.qty), price: num(x.price), note: x.note || '' }; });
      o.chartAt = e.chartAt == null ? null : e.chartAt; o.price = e.price == null ? null : e.price;
      return o;
    };
    const showMetrics = function () {
      const o = read(), m = metrics(o), box = form.querySelector('.jr-metrics');
      const bad = ['entry', 'stop', 'target', 'qty', 'fees'].filter(function (k) { return o[k] != null && isNaN(o[k]); });
      let warn = '';
      if (bad.length) warn = 'Not a number: ' + bad.join(', ');
      else if (o.entry != null && o.stop != null && (o.side === 'long' ? o.stop >= o.entry : o.stop <= o.entry)) warn = o.side === 'long' ? 'Long stop must be below entry' : 'Short stop must be above entry';
      box.innerHTML = '<span>Risk/unit <b>' + f2(m.riskPerUnit) + '</b> (' + f2(m.stopPct, 1) + '%)</span><span>Plan R:R <b>' + f2(m.plannedRR) + '</b></span>' +
        '<span>Risk <b>' + f2(m.riskAmount) + '</b></span><span>Exited <b>' + m.exitedQty + '</b>' + (m.remaining != null ? ' · open ' + m.remaining : '') + '</span>' +
        '<span>Net P&amp;L <b class="' + (m.netPnl > 0 ? 'up' : m.netPnl < 0 ? 'down' : '') + '">' + f2(m.netPnl) + '</b></span><span>Net R <b class="' + (m.netR > 0 ? 'up' : m.netR < 0 ? 'down' : '') + '">' + sR(m.netR) + '</b></span>' +
        (warn ? '<span class="down">' + esc(warn) + '</span>' : '');
    };
    renderExits(); showMetrics();
    form.addEventListener('input', function (ev) {
      state.dirty = true;
      const row = ev.target.closest('.jr-exrow');
      if (row) exits[Number(row.dataset.k)][ev.target.dataset.x] = ev.target.value;
      showMetrics();
    });
    form.addEventListener('change', function () { state.dirty = true; showMetrics(); });
    form.addEventListener('click', async function (ev) {
      const b = ev.target.closest('[data-a]'); if (!b) return;
      const a = b.dataset.a;
      if (a === 'addexit') { const o = read(), m = metrics(o); exits.push({ date: new Date().toISOString().slice(0, 10), qty: m.remaining != null && m.remaining > 0 ? m.remaining : '', price: '', note: '' }); renderExits(); showMetrics(); state.dirty = true; }
      else if (a === 'rmexit') { exits.splice(Number(b.closest('.jr-exrow').dataset.k), 1); renderExits(); showMetrics(); state.dirty = true; }
      else if (a === 'back') { if (state.dirty && !window.confirm('Discard unsaved changes?')) return; state.dirty = false; await refresh().catch(function () {}); renderList(); }
      else if (a === 'chart') { const s = read().symbol.trim().toUpperCase(); if (s && state.opts.onOpenChart) { close(); state.opts.onOpenChart(s); } }
      else if (a === 'del') {
        if (!window.confirm('Delete this journal entry' + (e.hasImage ? ' and its snapshot' : '') + '? This cannot be undone.')) return;
        try { await api('/api/journal/delete', { id: e.id }); state.dirty = false; await refresh(); renderList(); } catch (err) { form.querySelector('.jr-err').textContent = err.message; }
      }
    });
    form.addEventListener('submit', async function (ev) {
      ev.preventDefault();
      const o = read(), err = form.querySelector('.jr-err');
      err.textContent = '';
      const btn = form.querySelector('[type=submit]'); btn.disabled = true;
      try {
        let saved;
        if (e.id) saved = (await api('/api/journal/update', { id: e.id, entry: o })).entry;
        else {
          saved = (await api('/api/journal/create', o)).entry;
          if (state.img) {
            try { await api('/api/journal/image', { id: saved.id, dataUrl: state.img }); saved.hasImage = true; }
            catch (imgErr) { err.textContent = 'Saved, but the snapshot was not stored: ' + imgErr.message; }
          }
        }
        state.dirty = false;
        await refresh();
        const fresh = state.entries.find(function (x) { return x.id === saved.id; }) || saved;
        renderForm(fresh, null);
        const ok = body().querySelector('.jr-err'); if (ok && !err.textContent) { ok.textContent = '✓ Saved'; ok.className = 'jr-err ok'; }
      } catch (x) { err.textContent = x.message; }
      finally { btn.disabled = false; }
    });
    const first = form.querySelector(e.symbol ? '[name=entry]' : '[name=symbol]'); if (first && !e.id) first.focus();
  }

  window.FinJournal = {
    openList: async function (opts) {
      state.opts = opts || {}; ensureModal(); open();
      body().innerHTML = '<div class="muted">Loading…</div>';
      try { await refresh(); renderList(); } catch (e) { body().innerHTML = '<div class="down">Could not load the journal: ' + esc(e.message) + '</div>'; }
    },
    openNew: function (prefill, img, opts) {
      state.opts = opts || {}; ensureModal(); open();
      const e = Object.assign({ kind: 'idea', status: 'watching', side: 'long', exits: [], tags: [] }, prefill || {});
      if (typeof e.tags === 'string') e.tags = e.tags.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
      renderForm(e, img || null);
      refresh().catch(function () {});
    },
    metrics: metrics,
  };
})();
