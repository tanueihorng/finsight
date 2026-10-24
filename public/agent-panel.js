/* FinSight — agent chat panel (talks to the optional local agent through the
 * session-gated /api/agent/* proxy). Terminal-style conversation modelled on
 * Claude Code. No keys or personal data live here. Rendering is XSS-safe:
 * model text is HTML-escaped first, then a small whitelisted markdown subset
 * is applied; links must be http(s).
 */
(function () {
  'use strict';
  const LS = { open: 'finsight-agent-open', width: 'finsight-agent-w', thread: 'finsight-agent-thread', brain: 'finsight-agent-brain', ctx: 'finsight-agent-ctx' };
  const ls = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
  };
  const API = '/api/agent';
  const $ = (s, el) => (el || document).querySelector(s);
  const h = (tag, attrs, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return el;
  };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ------------------------------------------------------------- markdown (safe subset)
  function inline(s) {
    return s
      .replace(/`([^`\n]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>')
      .replace(/\[([^\]\n]{1,200})\]\((https?:\/\/[^\s)]{1,2000})\)/g, (m, t, u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${t}</a>`);
  }
  const isNum = (c) => /^[\s(+−-]*[$S€£¥]*[+−-]?[\d,.]+%?[)\s]*[A-Za-z%]{0,4}$/.test(c.replace(/&[a-z]+;/g, ''));
  function md(src) {
    const lines = esc(src).split('\n');
    let out = '', i = 0;
    const para = [];
    const flush = () => { if (para.length) { out += `<p>${inline(para.join('<br>'))}</p>`; para.length = 0; } };
    while (i < lines.length) {
      const l = lines[i];
      if (/^```/.test(l)) { flush(); const buf = []; i++; while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]); i++; out += `<pre><code>${buf.join('\n')}</code></pre>`; continue; }
      if (/^\s*\|.*\|\s*$/.test(l) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
        flush();
        const cells = (r) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
        const head = cells(l); i += 2; const rows = [];
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(cells(lines[i++]));
        const numCol = head.map((_, c) => rows.length > 0 && rows.every((r) => !r[c] || isNum(r[c])));
        out += '<div class="agent-table-wrap"><table><thead><tr>' + head.map((c, k) => `<th class="${numCol[k] ? 'num' : ''}">${inline(c)}</th>`).join('') + '</tr></thead><tbody>'
          + rows.map((r) => '<tr>' + head.map((_, k) => `<td class="${numCol[k] ? 'num' : ''}">${inline(r[k] || '')}</td>`).join('') + '</tr>').join('') + '</tbody></table></div>';
        continue;
      }
      const hd = l.match(/^(#{1,3})\s+(.*)$/);
      if (hd) { flush(); out += `<h${hd[1].length}>${inline(hd[2])}</h${hd[1].length}>`; i++; continue; }
      if (/^\s*([-*]|\d+[.)])\s+/.test(l)) {
        flush();
        const ordered = /^\s*\d+[.)]/.test(l); const items = [];
        while (i < lines.length && /^\s*([-*]|\d+[.)])\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*]|\d+[.)])\s+/, ''));
        out += `<${ordered ? 'ol' : 'ul'}>` + items.map((t) => `<li>${inline(t)}</li>`).join('') + `</${ordered ? 'ol' : 'ul'}>`;
        continue;
      }
      if (!l.trim()) { flush(); i++; continue; }
      para.push(l); i++;
    }
    flush();
    return out;
  }

  // ------------------------------------------------------------- api
  async function api(path, opts) {
    const o = opts || {};
    const res = await fetch(API + path, { method: o.method || 'GET', headers: o.body ? { 'Content-Type': 'application/json' } : {}, body: o.body ? JSON.stringify(o.body) : undefined, credentials: 'same-origin' });
    let j = null; try { j = await res.json(); } catch (e) { /* empty */ }
    if (!res.ok) { const err = new Error((j && j.error && (j.error.message || j.error)) || `HTTP ${res.status}`); err.code = j && j.error && j.error.code; err.status = res.status; throw err; }
    return j;
  }

  // ------------------------------------------------------------- state
  const S = { name: 'Kestrel', thread: null, version: 0, brains: [], skills: [], defaultBrain: null, es: null, lastEventId: 0, turns: new Map(), running: null, offline: false, stick: true, files: [] };

  // ------------------------------------------------------------- DOM
  // Thinking indicator: green candles climb one by one (one red dip), then a gold $ pops. CSS-animated.
  function candles() {
    const c = h('span', { class: 'candles', 'aria-hidden': 'true' });
    [[6, ''], [5, 'dn'], [10, ''], [14, ''], [18, '']].forEach(([px, cls], i) => c.append(h('i', { class: cls, style: `height:${px}px;animation-delay:${i * 0.15}s` })));
    c.append(h('b', { class: 'money' }, '$'));
    return c;
  }
  const panel = h('aside', { class: 'agent-panel', id: 'agent-panel', role: 'complementary', 'aria-label': 'Agent chat' });
  const resize = h('div', { class: 'agent-resize', title: 'Drag to resize', 'aria-hidden': 'true' });
  const titleEl = h('span', { class: 'agent-title' }, h('span', { class: 'mark' }, '↗'), ' ', h('span', { class: 'nm' }, S.name), h('small', {}, 'research agent'));
  const threadsBtn = h('button', { class: 'agent-icon-btn', title: 'Chats', 'aria-label': 'Show chats', 'aria-expanded': 'false', 'aria-controls': 'agent-threads' }, '☰');
  const newBtn = h('button', { class: 'agent-icon-btn', title: 'New chat (/new)', 'aria-label': 'New chat' }, '＋');
  const closeBtn = h('button', { class: 'agent-icon-btn', title: 'Close (Esc)', 'aria-label': 'Close chat' }, '✕');
  const threadsEl = h('div', { class: 'agent-threads', id: 'agent-threads', hidden: true, role: 'listbox', 'aria-label': 'Chats' });
  const log = h('div', { class: 'agent-log', role: 'log', 'aria-live': 'polite', 'aria-relevant': 'additions' });
  const jump = h('button', { class: 'agent-jump', hidden: true }, '↓ latest');
  const status = h('div', { class: 'agent-status', hidden: true, 'aria-live': 'off' }, candles(), h('span', { class: 'verb' }, 'Thinking…'), h('span', { class: 'sub' }, ''));
  const menu = h('div', { class: 'agent-menu', hidden: true, role: 'listbox', 'aria-label': 'Commands and skills' });
  const attachRow = h('div', { class: 'agent-attach-row' });
  const fileInput = h('input', { type: 'file', multiple: true, hidden: true, accept: 'image/png,image/jpeg,image/gif,image/webp,application/pdf,.docx,.txt,.md,.csv,.json' });
  const attachBtn = h('button', { class: 'agent-icon-btn', title: 'Attach images or documents (or paste / drop)', 'aria-label': 'Attach files' }, '⊕');
  const input = h('textarea', { class: 'agent-input', rows: '1', placeholder: 'Ask anything about your portfolio, a stock, a strategy…  (/ for skills)', 'aria-label': 'Message', maxlength: '12000' });
  const sendBtn = h('button', { class: 'agent-send', title: 'Send (Enter)', 'aria-label': 'Send' }, '⏎');
  const box = h('div', { class: 'agent-box' }, attachRow, h('div', { class: 'agent-row' }, h('span', { class: 'agent-prompt-glyph' }, '>'), input, attachBtn, sendBtn));
  const modelSel = h('select', { class: 'agent-model', 'aria-label': 'Model', title: 'Model for this chat' });
  const ctxBtn = h('button', { class: 'agent-ctx', title: 'Send what you are looking at (symbol, timeframe, strategy) with your message' }, '');
  const hintL = h('span', {}, '⏎ send · / skills · ⊕ files');
  panel.append(resize,
    h('div', { class: 'agent-head' }, titleEl, threadsBtn, newBtn, closeBtn),
    threadsEl, log,
    h('div', { class: 'agent-compose' }, menu, box, fileInput,
      h('div', { class: 'agent-hints' }, hintL, h('span', { class: 'r' }, ctxBtn, h('span', {}, '·'), modelSel))));

  function mount() {
    document.body.append(panel);
    const bar = document.querySelector('.topbar-right');
    if (bar) bar.prepend(h('button', { id: 'agent-toggle', class: 'topbar-btn agent-toggle', title: 'Ask the agent (⌘/)', 'aria-controls': 'agent-panel', 'aria-expanded': 'false', onclick: () => toggle() }, h('span', { class: 'mark' }, '↗'), ' ', h('span', { class: 'tname' }, 'ASK'), h('span', { class: 'kbd' }, '⌘/')));
    const w = Number(ls.get(LS.width, 440)); if (w >= 320) document.documentElement.style.setProperty('--agent-w', Math.min(w, window.innerWidth * 0.5) + 'px');
    if (ls.get(LS.open, '0') === '1') toggle(true);
  }

  // ------------------------------------------------------------- open/close/resize
  let booted = false;
  function toggle(force) {
    const open = force != null ? force : !document.body.classList.contains('agent-open');
    document.body.classList.toggle('agent-open', open);
    const t = $('#agent-toggle'); if (t) { t.setAttribute('aria-expanded', String(open)); t.classList.toggle('active', open); }
    ls.set(LS.open, open ? '1' : '0');
    window.dispatchEvent(new Event('resize'));
    if (open) { if (!booted && !document.body.classList.contains('locked')) { booted = true; boot(); } updateCtx(); setTimeout(() => input.focus(), 30); }
  }
  resize.addEventListener('pointerdown', (e) => {
    e.preventDefault(); resize.setPointerCapture(e.pointerId); document.body.classList.add('agent-resizing');
    const move = (ev) => { const w = Math.max(320, Math.min(window.innerWidth * 0.5, window.innerWidth - ev.clientX)); document.documentElement.style.setProperty('--agent-w', w + 'px'); };
    const up = () => { resize.removeEventListener('pointermove', move); document.body.classList.remove('agent-resizing'); ls.set(LS.width, parseInt(getComputedStyle(document.documentElement).getPropertyValue('--agent-w'), 10)); window.dispatchEvent(new Event('resize')); };
    resize.addEventListener('pointermove', move); resize.addEventListener('pointerup', up, { once: true });
  });
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === '/') { e.preventDefault(); toggle(); return; }
    if (e.key === 'Escape' && document.body.classList.contains('agent-open') && panel.contains(document.activeElement)) {
      if (!menu.hidden) return closeMenu();
      if (S.running) return stop();
      if (!input.value.trim()) toggle(false); // never discard a typed message by closing
    }
  });
  closeBtn.addEventListener('click', () => toggle(false));

  // ------------------------------------------------------------- page context
  let ctxOn = ls.get(LS.ctx, '1') === '1';
  function pageContext() {
    const c = {};
    try {
      if (typeof state !== 'undefined' && state) {
        if (state.selected) c.symbol = String(state.selected).slice(0, 24);
        if (state.account) c.account = String(state.account).slice(0, 64);
        if (state.base) c.base = String(state.base).slice(0, 3);
        if (state.detailRange && state.detailRange.interval) c.timeframe = String(state.detailRange.interval).slice(0, 10);
      }
      if (typeof detailChart !== 'undefined' && detailChart && detailChart.cfg && detailChart.cfg.strategy) c.strategy = String(detailChart.cfg.strategy).slice(0, 40);
    } catch (e) { /* app not ready */ }
    c.view = 'terminal';
    return c;
  }
  function updateCtx() {
    const c = pageContext();
    ctxBtn.classList.toggle('on', ctxOn);
    ctxBtn.textContent = ctxOn ? `◉ ${[c.symbol, c.timeframe].filter(Boolean).join(' ') || 'page'}` : '○ no context';
  }
  ctxBtn.addEventListener('click', () => { ctxOn = !ctxOn; ls.set(LS.ctx, ctxOn ? '1' : '0'); updateCtx(); });
  setInterval(() => { if (document.body.classList.contains('agent-open') && !document.hidden) updateCtx(); }, 2000);

  // ------------------------------------------------------------- boot
  async function boot() {
    try {
      const [info, b, sk] = await Promise.all([api('/info').catch(() => ({})), api('/brains'), api('/skills').catch(() => ({ skills: [] }))]);
      if (info.name) { S.name = info.name; $('.nm', titleEl).textContent = info.name; const t = $('#agent-toggle .tname'); if (t) t.textContent = info.name.toUpperCase(); input.placeholder = `Ask ${info.name} anything…  (/ for skills)`; }
      S.brains = b.brains; S.defaultBrain = b.default; S.skills = sk.skills || []; S.offline = false;
      renderModels();
      const saved = ls.get(LS.thread, '');
      if (saved) { try { await openThread(saved); return; } catch (e) { /* gone */ } }
      showWelcome();
    } catch (e) {
      if (e.status === 401) { booted = false; return; } // FinSight still locked: boot again after unlock (observer below)
      if (e.code === 'AGENT_OFFLINE' || e.status === 503 || e.status === 502) return showOffline();
      notice(log, `Could not reach the agent: ${e.message}`, 'error');
    }
  }
  // Start (or restart) once the PIN lock screen goes away.
  new MutationObserver(() => {
    if (!document.body.classList.contains('locked') && document.body.classList.contains('agent-open') && !booted) { booted = true; boot(); }
  }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  // Offline: ask FinSight why (it supervises the agent) and retry while it is starting.
  let retryTimer = 0;
  async function showOffline() {
    S.offline = true; sendBtn.disabled = true;
    let st = {}; try { st = await fetch('/api/agent-status', { credentials: 'same-origin' }).then((r) => r.json()); } catch (e) { /* FinSight down */ }
    const starting = st.status === 'running' || st.status === 'restarting';
    const why = {
      'not-installed': ['The agent is not installed yet. In the finsight folder run:', 'npm run agent:install'],
      disabled: ['The agent is turned off (AGENT_AUTOSTART=0).', ''],
      crashed: ['The agent keeps crashing. Details are in its log:', st.logFile || 'agent.log'],
    }[st.status] || (starting ? [`${S.name} is starting…`, ''] : ['The agent is not reachable.', st.logFile ? `log: ${st.logFile}` : '']);
    log.replaceChildren(h('div', { class: 'agent-offline' },
      h('div', {}, h('strong', {}, `${S.name} offline. `), why[0]), why[1] ? h('code', {}, why[1]) : null,
      h('div', { style: 'margin-top:8px' }, h('button', { class: 'agent-chip', onclick: () => { booted = true; boot(); } }, 'retry'))));
    clearTimeout(retryTimer);
    if (starting) retryTimer = setTimeout(() => { booted = true; boot(); }, 2000);
  }
  function renderModels() {
    modelSel.replaceChildren(...S.brains.map((b) => h('option', { value: b.id, disabled: !b.available, title: b.available ? b.label : b.reason }, `${b.label} ${b.costTier}${b.available ? '' : ' · n/a'}`)));
    const want = (S.thread && S.thread.defaultBrain) || ls.get(LS.brain, '') || S.defaultBrain;
    const ok = S.brains.find((b) => b.id === want && b.available) || S.brains.find((b) => b.available);
    if (ok) modelSel.value = ok.id;
    sendBtn.disabled = !ok;
    if (!ok) hintL.textContent = 'No model available: add an API key (see agent README).';
  }
  modelSel.addEventListener('change', () => ls.set(LS.brain, modelSel.value));

  // ------------------------------------------------------------- threads
  async function listThreads() {
    const { threads } = await api('/threads');
    threadsEl.replaceChildren(...threads.map((t) => {
      const row = h('div', { class: 'agent-thread-row' + (S.thread && S.thread.id === t.id ? ' active' : ''), role: 'option', tabindex: '0', 'aria-selected': String(!!(S.thread && S.thread.id === t.id)) },
        h('span', { class: 't' }, t.title), h('span', { class: 'd' }, new Date(t.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })),
        h('button', { class: 'agent-icon-btn x', title: 'Delete chat', 'aria-label': `Delete ${t.title}`, onclick: async (e) => {
          e.stopPropagation();
          if (!confirm(`Delete "${t.title}" permanently?`)) return;
          await api(`/threads/${t.id}?confirm=true`, { method: 'DELETE' });
          if (S.thread && S.thread.id === t.id) newChat();
          listThreads();
        } }, '✕'));
      const open = () => { openThread(t.id); toggleThreads(false); };
      row.addEventListener('click', open); row.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
      return row;
    }));
    if (!threads.length) threadsEl.append(h('div', { class: 'agent-thread-row' }, h('span', { class: 't' }, 'No chats yet')));
  }
  function toggleThreads(force) {
    const show = force != null ? force : threadsEl.hidden;
    threadsEl.hidden = !show; threadsBtn.setAttribute('aria-expanded', String(show));
    if (show) listThreads().catch(() => {});
  }
  threadsBtn.addEventListener('click', () => toggleThreads());
  newBtn.addEventListener('click', () => newChat());
  function newChat() { closeStream(); S.thread = null; S.turns.clear(); S.running = null; setRunning(false); ls.set(LS.thread, ''); showWelcome(); input.focus(); }

  async function openThread(id) {
    const d = await api(`/threads/${id}`);
    closeStream(); S.thread = d.thread; S.version = d.thread.version; S.turns.clear(); S.lastEventId = d.lastEventId || 0;
    ls.set(LS.thread, id); renderModels();
    log.replaceChildren();
    const cites = new Map(); for (const c of d.citations || []) { if (!cites.has(c.turnId)) cites.set(c.turnId, []); cites.get(c.turnId).push(c); }
    renderHistory(d.messages, cites);
    S.running = d.runningTurn || null; setRunning(!!S.running);
    openStream();
    scrollBottom(true);
  }

  // ------------------------------------------------------------- status line (Claude Code style)
  const VERBS = ['Crunching numbers', 'Reading the tape', 'Consulting the ledger', 'Squinting at filings', 'Pricing it in', 'Checking the 200-day',
    'Marking to market', 'Counting basis points', 'Asking the bond market', 'Tallying dividends', 'Hedging my words', 'Sniffing out the catalyst',
    'Rebalancing thoughts', 'Reconciling the books', 'Scanning for setups', 'Weighing the evidence', 'Discounting cash flows', 'Waiting for the close'];
  const TOOL_VERBS = { get_portfolio: 'Opening the portfolio', query_positions: 'Sorting positions', get_exposures: 'Measuring exposure', get_cash: 'Counting cash',
    run_strategy: 'Running the strategy', scan_strategies: 'Scanning for setups', size_position: 'Sizing the position', web_search: 'Searching the web',
    fetch_url: 'Reading the page', edgar_filings: 'Pulling SEC filings', edgar_financials: 'Reading the financials', get_history: 'Charting the history',
    get_events: 'Checking the calendar', get_policy: 'Re-reading the policy', use_skill: 'Opening the playbook', get_news: 'Reading the headlines' };
  let stTimer = 0, stStart = 0, stChars = 0, stVerb = '', stTick = 0;
  function statusStart() {
    stStart = Date.now(); stChars = 0; stTick = 0; stVerb = VERBS[Math.floor(Math.random() * VERBS.length)];
    status.hidden = false; log.append(status); paintStatus();
    clearInterval(stTimer); stTimer = setInterval(() => { stTick++; if (stTick % 25 === 0) stVerb = VERBS[Math.floor(Math.random() * VERBS.length)]; paintStatus(); }, 120);
  }
  function paintStatus() {
    $('.verb', status).textContent = stVerb + '…';
    const secs = Math.floor((Date.now() - stStart) / 1000);
    $('.sub', status).textContent = `(${secs}s${stChars ? ` · ↓ ~${Math.round(stChars / 4)} tokens` : ''} · esc to interrupt)`;
  }
  function statusVerb(v) { if (v) { stVerb = v; paintStatus(); } }
  function statusStop() { clearInterval(stTimer); status.hidden = true; }
  function statusKeepLast() { if (!status.hidden) log.append(status); }

  // ------------------------------------------------------------- rendering
  function showWelcome() {
    log.replaceChildren(h('div', { class: 'agent-welcome' },
      h('div', { class: 'hi' }, h('span', { class: 'star' }, '↗ '), `Welcome to ${S.name}`),
      h('div', {}, 'Your research agent inside FinSight. Answers use your live data, strategy library, records and the web, with sources and data times. It never trades.'),
      h('ul', {}, h('li', {}, h('code', {}, '/'), ' shows skills and commands (', h('code', {}, '/pre-trade-check'), ', ', h('code', {}, '/earnings-review'), ' …)'),
        h('li', {}, 'paste or drop images, PDFs, DOCX or CSV to analyse them'),
        h('li', {}, 'switch model at the bottom right; ', h('code', {}, 'esc'), ' stops a reply'))),
      h('div', { class: 'agent-try' }, h('div', { class: 'lbl' }, 'Try'), ...suggestions().map((s) => h('button', { class: 'agent-chip', onclick: () => { input.value = s; submit(); } }, s))));
  }
  function suggestions() {
    const c = pageContext();
    const list = ['How is my portfolio doing today, and what moved it?', 'What is my currency and sector exposure?', '/strategy-scan any live setups in my holdings?'];
    if (c.symbol) list.unshift(`What do my strategies say about ${c.symbol} right now?`);
    list.push('What earnings or dividends are coming up for my holdings?');
    return list.slice(0, 4);
  }
  function notice(where, text, kind) { const n = h('div', { class: 'agent-notice ' + (kind || '') }, text); where.append(n); return n; }
  const fileChip = (f) => h('span', { class: 'agent-file', title: f.name }, f.thumb ? h('img', { src: f.thumb, alt: '' }) : (f.kind === 'image' ? '🖼' : '📄'), ' ', f.name);

  function userBubble(text, ctxTxt, files) {
    const el = h('div', { class: 'agent-user' }, h('span', { class: 'q' }, text));
    if (files && files.length) el.append(h('div', { class: 'agent-files' }, files.map(fileChip)));
    if (ctxTxt) el.append(h('span', { class: 'meta' }, ctxTxt));
    return el;
  }
  const ctxLabel = (pc) => { try { const c = typeof pc === 'string' ? JSON.parse(pc) : pc; return [c.symbol && `@${c.symbol}`, c.timeframe, c.strategy && `strategy ${c.strategy}`].filter(Boolean).join(' · '); } catch (e) { return ''; } };
  const prettyTool = (n) => String(n || 'tool').replace(/^mcp__finsight__/, '');
  function prettyArgs(s) {
    if (!s) return '()';
    try { const o = JSON.parse(s); const parts = Object.entries(o).map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`); return `(${parts.join(', ').slice(0, 90)})`; }
    catch (e) { return `(${String(s).slice(0, 90)})`; }
  }

  /** One assistant turn = ordered parts (⏺ text segments and ⏺ tool rows) + citations + meta. */
  function turnView(turnId) {
    if (S.turns.has(turnId)) return S.turns.get(turnId);
    const root = h('div', { class: 'agent-turn' });
    const cites = h('div', { class: 'agent-cites' });
    const meta = h('div', { class: 'agent-meta' });
    root.append(cites, meta);
    log.append(root); statusKeepLast();
    let seg = null, segText = '', raf = 0, allText = '';
    const tools = new Map();
    const v = {
      root, label: '',
      text(delta) {
        if (!seg) { seg = h('div', { class: 'agent-text' }); root.insertBefore(seg, cites); segText = ''; }
        segText += delta; allText += delta; stChars += delta.length;
        if (!raf) raf = requestAnimationFrame(() => { raf = 0; if (seg) seg.innerHTML = md(segText); scrollBottom(); });
      },
      endSegment() { if (seg && raf) { cancelAnimationFrame(raf); raf = 0; seg.innerHTML = md(segText); } seg = null; },
      tool(callId, name, args) {
        v.endSegment();
        const det = h('details', { class: 'agent-tool running' },
          h('summary', {}, h('span', { class: 'nm' }, prettyTool(name)), h('span', { class: 'args' }, prettyArgs(args))),
          h('div', { class: 'res' }, 'running…'),
          h('div', { class: 'detail' }, `input: ${args || '{}'}`));
        root.insertBefore(det, cites); tools.set(callId || name + tools.size, det);
        statusVerb(TOOL_VERBS[prettyTool(name)]);
        scrollBottom();
      },
      toolDone(callId, name, ok, summary, ms) {
        const det = tools.get(callId) || [...tools.values()].reverse().find((d) => d.classList.contains('running') && $('.nm', d).textContent === prettyTool(name));
        if (!det) return;
        det.className = 'agent-tool ' + (ok ? 'ok' : 'err');
        const took = ms == null ? '' : ms < 1000 ? ` · ${ms} ms` : ` · ${(ms / 1000).toFixed(1)} s`;
        $('.res', det).textContent = `${ok ? (summary || 'done') : (summary || 'failed')}${took}`;
        if (summary) $('.detail', det).append(document.createTextNode(`\nresult: ${summary}`));
      },
      cite(c) {
        if (!/^https?:/i.test(c.url) || [...cites.children].some((a) => a.getAttribute('href') === c.url)) return;
        let host = c.url; try { host = new URL(c.url).hostname.replace(/^www\./, ''); } catch (e) { /* keep */ }
        cites.append(h('a', { class: `agent-cite ${c.class || 'unverified'}`, href: c.url, target: '_blank', rel: 'noopener noreferrer', title: `${c.title || c.url}\nretrieved ${String(c.retrievedAt || '').slice(0, 10)} · ${c.class || 'unverified'}` },
          h('b', {}, (c.class || 'web')[0].toUpperCase()), ' ', host));
      },
      notice(text, kind) { v.endSegment(); const n = h('div', { class: 'agent-notice ' + (kind || '') }, text); root.insertBefore(n, cites); },
      finish(info) {
        v.endSegment();
        meta.replaceChildren();
        if (info && info.label) meta.append(h('span', {}, info.label));
        if (info && info.costUsd != null) meta.append(h('span', { title: 'API cost of this answer' }, `$${Number(info.costUsd).toFixed(info.costUsd < 0.01 ? 4 : 3)}`));
        if (info && info.ms) meta.append(h('span', {}, `${(info.ms / 1000).toFixed(1)}s`));
        if (allText) meta.append(h('button', { title: 'Copy answer', onclick: (e) => { navigator.clipboard && navigator.clipboard.writeText(allText); e.target.textContent = 'copied'; setTimeout(() => { e.target.textContent = 'copy'; }, 1200); } }, 'copy'));
        if (/^turn_/.test(turnId)) meta.append(h('button', { title: 'Show every model, tool and data call for this answer', onclick: () => showTrace(turnId, root) }, 'trace'));
      },
    };
    S.turns.set(turnId, v);
    return v;
  }

  async function showTrace(turnId, root) {
    const old = $('.agent-trace', root); if (old) { old.remove(); return; }
    const box2 = h('div', { class: 'agent-trace' }, h('div', {}, 'loading…'));
    root.append(box2);
    try {
      const { lines } = await api(`/logs?turnId=${encodeURIComponent(turnId)}&limit=500`);
      box2.replaceChildren(h('div', {}, h('b', {}, turnId), ' · ', `${lines.length} events · full detail: agent logs ${turnId}`),
        ...lines.map((l) => {
          const bad = l.ok === false || /error|failed/.test(String(l.kind)) || l.status === 'failed';
          const what = l.tool || l.path || l.brain || '';
          const extra = [l.ms != null ? `${l.ms}ms` : '', l.stopReason || '', l.usage ? `in ${l.usage.inputTokens} / out ${l.usage.outputTokens}` : '', l.code || '', l.error ? String(l.error).slice(0, 80) : ''].filter(Boolean).join(' · ');
          return h('div', { class: bad ? 'bad' : '' }, `${String(l.ts).slice(11, 19)} `, h('b', {}, l.kind), ` ${what} ${extra}`);
        }));
    } catch (e) { box2.replaceChildren(h('div', { class: 'bad' }, e.message)); }
  }

  function renderHistory(messages, citesByTurn) {
    const byTurn = new Map(); const order = [];
    for (const m of messages) { const key = m.turnId || m.id; if (!byTurn.has(key)) { byTurn.set(key, []); order.push(key); } byTurn.get(key).push(m); }
    for (const key of order) {
      const msgs = byTurn.get(key);
      const user = msgs.find((m) => m.role === 'user' && m.blocks.some((b) => b.type === 'text'));
      if (user) {
        const pc = user.blocks.find((b) => b.type === 'notice' && b.kind === 'page_context');
        const files = user.blocks.filter((b) => b.type === 'attachment');
        log.append(userBubble(user.blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n'), pc ? ctxLabel(pc.text) : '', files));
      }
      const asst = msgs.filter((m) => m.role !== 'user');
      if (!asst.length) continue;
      const v = turnView(key);
      let brain = '';
      for (const m of asst) {
        if (m.brain) brain = m.brain;
        for (const b of m.blocks) {
          if (b.type === 'text' && m.role === 'assistant') { v.text(b.text); v.endSegment(); }
          else if (b.type === 'tool_call') v.tool(b.id, b.name, JSON.stringify(b.args || {}));
          else if (b.type === 'tool_result') v.toolDone(b.callId, b.name, b.ok, '', null);
          else if (b.type === 'notice' && m.role === 'assistant') v.notice(b.text, b.kind === 'error' || b.kind === 'refusal' ? 'error' : 'warn');
        }
      }
      for (const c of citesByTurn.get(key) || []) v.cite(c);
      v.finish({ label: (S.brains.find((b) => b.id === brain) || {}).label || brain });
    }
    stChars = 0;
  }

  // ------------------------------------------------------------- stream
  function closeStream() { if (S.es) { S.es.close(); S.es = null; } }
  function openStream() {
    if (!S.thread) return;
    closeStream();
    const es = new EventSource(`${API}/threads/${S.thread.id}/events?after=${S.lastEventId}`);
    S.es = es;
    const on = (type, fn) => es.addEventListener(type, (e) => { S.lastEventId = Math.max(S.lastEventId, Number(e.lastEventId) || 0); let d = {}; try { d = JSON.parse(e.data); } catch (x) { /* ignore */ } fn(d); });
    on('turn.started', (d) => { S.running = d.turnId; setRunning(true); const v = turnView(d.turnId); v.label = d.label; if (d.skill) v.notice(`using skill ${d.skill}`, ''); });
    on('message.delta', (d) => turnView(d.turnId).text(d.text));
    on('tool.started', (d) => turnView(d.turnId).tool(d.callId, d.name, d.argsSummary));
    on('tool.finished', (d) => turnView(d.turnId).toolDone(d.callId, d.name, d.ok, d.resultSummary, d.ms));
    on('citation', (d) => turnView(d.turnId).cite(d));
    on('budget.warning', (d) => turnView(d.turnId).notice(d.note || 'Limit reached.', 'warn'));
    on('turn.retry', (d) => { turnView(d.turnId).notice(`model busy (${d.code}), retrying…`, 'warn'); statusVerb('Waiting for the model'); });
    on('turn.finished', (d) => { const v = turnView(d.turnId); v.finish({ label: v.label, costUsd: d.costUsd, ms: d.ms }); done(d.turnId); });
    on('turn.stopped', (d) => { const v = turnView(d.turnId); v.notice('Interrupted by you.', 'warn'); v.finish({ label: v.label }); done(d.turnId); });
    on('turn.failed', (d) => { const v = turnView(d.turnId); v.notice(friendly(d.code, d.message), 'error'); v.finish({ label: v.label }); done(d.turnId); });
    es.onerror = () => { /* EventSource reconnects by itself with Last-Event-ID */ };
  }
  function done(turnId) { if (S.running === turnId) { S.running = null; setRunning(false); } scrollBottom(); }
  function friendly(code, msg) {
    if (code === 'FINSIGHT_DOWN') return 'FinSight data is unreachable right now.';
    return msg || code || 'Something went wrong.';
  }

  // ------------------------------------------------------------- scroll (stick to bottom unless the user scrolls up)
  let lastTop = 0;
  log.addEventListener('scroll', () => {
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    if (atBottom) S.stick = true; else if (log.scrollTop < lastTop - 2) S.stick = false;
    lastTop = log.scrollTop; jump.hidden = S.stick;
    if (!jump.hidden && !jump.isConnected) log.append(jump);
  });
  jump.addEventListener('click', () => scrollBottom(true));
  function scrollBottom(force) { if (force || S.stick) { log.scrollTop = log.scrollHeight; S.stick = true; jump.hidden = true; } }

  // ------------------------------------------------------------- slash menu (commands + skills)
  const COMMANDS = [
    { k: '/new', v: 'start a new chat' }, { k: '/model', v: 'switch model: /model deepseek-pro' }, { k: '/cost', v: 'spend today (/cost month)' },
    { k: '/strategies', v: 'list the strategy library' }, { k: '/skills', v: 'list installed skills' }, { k: '/logs', v: 'recent errors from the interaction log' }, { k: '/help', v: 'what I can do' },
  ];
  let menuItems = [], menuSel = 0;
  function updateMenu() {
    const m = input.value.match(/^\/([\w-]*)$/);
    if (!m) return closeMenu();
    const q = m[1].toLowerCase();
    const skills = S.skills.map((s) => ({ k: '/' + s.name, v: s.description, skill: true })).filter((x) => x.k.slice(1).includes(q));
    const cmds = COMMANDS.filter((c) => c.k.slice(1).startsWith(q));
    menuItems = [...skills, ...cmds];
    if (!menuItems.length) return closeMenu();
    menuSel = Math.min(menuSel, menuItems.length - 1);
    const row = (it, i) => { const el = h('div', { class: 'it' + (i === menuSel ? ' sel' : ''), role: 'option', 'aria-selected': String(i === menuSel) }, h('span', { class: 'k' }, it.k), h('span', { class: 'v' }, it.v)); el.addEventListener('mousedown', (e) => { e.preventDefault(); pickMenu(i); }); return el; };
    menu.replaceChildren(
      ...(skills.length ? [h('div', { class: 'grp' }, 'SKILLS')] : []), ...skills.map((it, i) => row(it, i)),
      ...(cmds.length ? [h('div', { class: 'grp' }, 'COMMANDS')] : []), ...cmds.map((it, i) => row(it, i + skills.length)));
    menu.hidden = false;
    const sel = $('.sel', menu); if (sel) sel.scrollIntoView({ block: 'nearest' });
  }
  function closeMenu() { menu.hidden = true; menuSel = 0; }
  function pickMenu(i) { const it = menuItems[i]; if (!it) return; input.value = it.k + ' '; closeMenu(); autosize(); input.focus(); }

  // ------------------------------------------------------------- attachments
  function readB64(file) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = () => rej(r.error); r.readAsDataURL(file); }); }
  async function addFiles(list) {
    for (const file of [...list].slice(0, 5 - S.files.length)) {
      if (file.size > 15 * 1024 * 1024) { notice(log, `${file.name}: larger than 15 MB`, 'error'); continue; }
      const f = { name: file.name || 'pasted.png', kind: /^image\//.test(file.type) ? 'image' : 'document', thumb: /^image\//.test(file.type) ? URL.createObjectURL(file) : null, id: null, state: 'uploading' };
      S.files.push(f); renderFiles();
      try {
        const { upload } = await api('/uploads', { method: 'POST', body: { name: f.name, dataBase64: await readB64(file) } });
        f.id = upload.id; f.state = upload.kind === 'document' && !upload.chars ? 'notext' : 'ready';
      } catch (e) { f.state = 'error'; f.error = e.message; }
      renderFiles();
    }
  }
  function renderFiles() {
    attachRow.replaceChildren(...S.files.map((f, i) => {
      const label = f.state === 'uploading' ? ' uploading…' : f.state === 'error' ? ` ✕ ${f.error}` : f.state === 'notext' ? ' (no text found)' : '';
      const chip = fileChip({ ...f, name: f.name + label });
      chip.append(h('button', { title: 'Remove', 'aria-label': `Remove ${f.name}`, onclick: () => { S.files.splice(i, 1); renderFiles(); } }, '×'));
      return chip;
    }));
  }
  attachBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => { addFiles(fileInput.files); fileInput.value = ''; });
  box.addEventListener('dragover', (e) => { e.preventDefault(); box.classList.add('drag'); });
  box.addEventListener('dragleave', () => box.classList.remove('drag'));
  box.addEventListener('drop', (e) => { e.preventDefault(); box.classList.remove('drag'); if (e.dataTransfer && e.dataTransfer.files.length) addFiles(e.dataTransfer.files); });
  input.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData && e.clipboardData.files || [])];
    if (files.length) { e.preventDefault(); addFiles(files); }
  });

  // ------------------------------------------------------------- compose
  function setRunning(on) {
    sendBtn.classList.toggle('stop', on); sendBtn.textContent = on ? '■' : '⏎';
    sendBtn.title = on ? 'Stop (Esc)' : 'Send (Enter)'; sendBtn.setAttribute('aria-label', on ? 'Stop' : 'Send');
    sendBtn.disabled = false;
    if (on) statusStart(); else statusStop();
  }
  const autosize = () => { input.style.height = 'auto'; input.style.height = Math.min(200, input.scrollHeight) + 'px'; };
  input.addEventListener('input', () => { autosize(); updateMenu(); });
  input.addEventListener('keydown', (e) => {
    if (!menu.hidden) {
      if (e.key === 'ArrowDown') { e.preventDefault(); menuSel = (menuSel + 1) % menuItems.length; updateMenu(); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); menuSel = (menuSel - 1 + menuItems.length) % menuItems.length; updateMenu(); return; }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) { e.preventDefault(); pickMenu(menuSel); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (!S.running) submit(); }
  });
  input.addEventListener('blur', () => setTimeout(closeMenu, 120));
  sendBtn.addEventListener('click', () => (S.running ? stop() : submit()));
  async function stop() { if (S.thread) { try { await api(`/threads/${S.thread.id}/stop`, { method: 'POST', body: {} }); } catch (e) { /* already done */ } } }

  async function slash(cmd) {
    const [c, ...rest] = cmd.slice(1).trim().split(/\s+/); const arg = rest.join(' ');
    const sys = (t) => { if ($('.agent-welcome', log)) log.replaceChildren(); notice(log, t); scrollBottom(true); };
    if (c === 'new') return newChat();
    if (c === 'model') {
      const b = S.brains.find((x) => x.id === arg || x.label.toLowerCase().includes(arg.toLowerCase()));
      if (!arg || !b) return sys(`Models: ${S.brains.map((x) => `${x.id}${x.available ? '' : ' (n/a)'}`).join(', ')}`);
      if (!b.available) return sys(`${b.label} is not available: ${b.reason}`);
      modelSel.value = b.id; ls.set(LS.brain, b.id); return sys(`Model set to ${b.label}.`);
    }
    if (c === 'cost') { const r = await api(`/cost?period=${arg === 'month' ? 'month' : 'day'}`); return sys(`Spend ${r.period === 'day' ? 'today' : 'this month'}: $${r.totalUsd.toFixed(4)} (daily cap $${r.capUsdPerDay}).`); }
    if (c === 'strategies') { const r = await api('/strategies'); return sys(r.strategies.map((s) => `${s.name} (${s.id}) · ${s.status}`).join('\n')); }
    if (c === 'skills') return sys(S.skills.length ? S.skills.map((s) => `/${s.name} — ${s.description.slice(0, 90)}`).join('\n') : 'No skills installed.');
    if (c === 'logs') {
      const { lines } = await api('/logs?limit=1000');
      const bad = lines.filter((l) => l.ok === false || /error|failed/.test(String(l.kind)) || l.status === 'failed' || (l.status >= 500)).slice(-12);
      return sys(bad.length ? bad.map((l) => `${String(l.ts).slice(5, 19)} ${l.kind} ${l.tool || l.path || l.brain || ''} ${l.code || ''} ${l.error || l.message || ''}`.trim()).join('\n') : 'No recent errors in the interaction log.');
    }
    return sys(`${S.name} answers from your FinSight data, strategy library, records and the web. Commands: /new · /model <id> · /cost [month] · /strategies · /skills · /logs. Skills: type / to browse. Attach files with ⊕, paste or drop.`);
  }

  async function submit() {
    const text = input.value.trim();
    if ((!text && !S.files.length) || S.offline) return;
    const cmd = text.match(/^\/([\w-]+)/);
    if (cmd && !S.skills.some((s) => s.name === cmd[1])) { input.value = ''; autosize(); try { await slash(text); } catch (e) { notice(log, e.message, 'error'); } return; }
    if (S.files.some((f) => f.state === 'uploading')) { notice(log, 'Wait for uploads to finish.', 'warn'); return; }
    const files = S.files.filter((f) => f.id);
    sendBtn.disabled = true;
    try {
      if (!S.thread) {
        const { thread } = await api('/threads', { method: 'POST', body: { brain: modelSel.value || undefined } });
        S.thread = thread; S.version = thread.version; S.lastEventId = 0; ls.set(LS.thread, thread.id);
        log.replaceChildren(); openStream();
      }
      const pc = ctxOn ? pageContext() : undefined;
      log.append(userBubble(text || '(attached files)', pc ? ctxLabel(pc) : '', files));
      input.value = ''; autosize(); S.files = []; renderFiles(); scrollBottom(true);
      const key = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random()).replace(/-/g, '');
      const r = await api(`/threads/${S.thread.id}/messages`, { method: 'POST', body: { content: text || 'Please analyse the attached file(s).', brain: modelSel.value || undefined, pageContext: pc, idempotencyKey: key, expectedVersion: S.version, attachmentIds: files.length ? files.map((f) => f.id) : undefined } });
      S.version = r.version; if (!S.running) { S.running = r.turnId; setRunning(true); }
      turnView(r.turnId);
    } catch (e) {
      sendBtn.disabled = false;
      if (e.code === 'CONFLICT' && S.thread) { notice(log, 'This chat changed in another tab. Reloaded it; please resend.', 'warn'); await openThread(S.thread.id); input.value = text; autosize(); return; }
      if (e.code === 'AGENT_OFFLINE') return showOffline();
      notice(log, e.message, 'error'); input.value = text; autosize();
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();
