/* ===========================================================================
 *  chart.js — FinSight pro chart (zero-dependency canvas, offline)
 * ---------------------------------------------------------------------------
 *  TradingView-style chart for the SECURITY DETAIL panel:
 *   - chart types: candles, hollow, Heikin Ashi, OHLC bars, line, area
 *   - timeframes 1m…1M, symbol box, log / percent / manual price scale,
 *     axis-drag scaling, wheel zoom, pan, expand to full screen
 *   - indicator registry with parameters (overlays + sub-panes)
 *   - drawing tools with select / move / edit handles, styles, lock, clone,
 *     undo/redo, magnet snapping and keyboard shortcuts
 *   - pullback strategy layer (strategy.js) with sizer
 *   - bar replay, PNG snapshot, trade log hook (journal.js)
 *   - drawings and layouts saved on the local server (/api/charts/*),
 *     cached in localStorage for offline use
 *  Exposes window.PriceChart. Consumes /api/history points {t,o,h,l,c,v}.
 * ======================================================================== */
(function () {
  'use strict';

  const IND_LIB = window.FinIndicators;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.272, 1.618];
  const FIBEXT_LEVELS = [0, 0.618, 1, 1.272, 1.618, 2, 2.618];
  const FIB_COLORS = ['#787b86', '#f23645', '#ff9800', '#4caf50', '#089981', '#00bcd4', '#787b86', '#2962ff', '#9c27b0'];
  const PALETTE = ['#2962ff', '#f23645', '#089981', '#ff9800', '#e040fb', '#00bcd4', '#ffeb3b', '#ffffff', '#787b86'];
  const clamp = function (v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; };
  const uid = function () { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); };

  function decimalsFor(v) {
    v = Math.abs(v);
    if (!isFinite(v) || v === 0) return 2;
    if (v >= 1) return 2;
    if (v >= 0.1) return 4;
    if (v >= 0.001) return 5;
    return 6;
  }
  function fmtPrice(v, dec) { return v == null || !isFinite(v) ? '—' : v.toFixed(dec == null ? decimalsFor(v) : dec); }
  function fmtVol(v) {
    if (v == null || !isFinite(v)) return '—';
    const a = Math.abs(v);
    if (a >= 1e9) return (v / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return (v / 1e6).toFixed(2) + 'M';
    if (a >= 1e3) return (v / 1e3).toFixed(1) + 'K';
    return String(Math.round(v));
  }
  function niceStep(range, target) {
    const raw = range / (target || 6);
    if (!(raw > 0)) return 1;
    const pow = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw / pow;
    return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * pow;
  }
  function distToSeg(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy || 1;
    const t = clamp(((px - ax) * dx + (py - ay) * dy) / len2, 0, 1);
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function pct(v) { return v == null ? '—' : (v >= 0 ? '+' : '') + (v * 100).toFixed(0) + '%'; }
  function fmtDate(t, intraday) {
    const d = new Date(t);
    const s = MONTHS[d.getMonth()] + ' ' + d.getDate() + ' ' + d.getFullYear();
    return intraday ? s + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') : s;
  }

  // ---- icons (16px stroke SVG) ---------------------------------------------
  const svg = function (d) { return '<svg viewBox="0 0 18 18" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">' + d + '</svg>'; };
  const ICON = {
    cursor: svg('<path d="M9 2v14M2 9h14"/>'),
    trend: svg('<path d="M3 15L15 3"/><circle cx="3" cy="15" r="1.4"/><circle cx="15" cy="3" r="1.4"/>'),
    ray: svg('<path d="M3 14L17 4"/><circle cx="3" cy="14" r="1.4"/><circle cx="9" cy="9.7" r="1.4"/>'),
    ext: svg('<path d="M1 16L17 2"/><circle cx="6" cy="11.6" r="1.4"/><circle cx="12" cy="6.4" r="1.4"/>'),
    hline: svg('<path d="M1 9h16"/><circle cx="9" cy="9" r="1.4"/>'),
    hray: svg('<path d="M5 9h12"/><circle cx="5" cy="9" r="1.4"/>'),
    vline: svg('<path d="M9 1v16"/><circle cx="9" cy="9" r="1.4"/>'),
    channel: svg('<path d="M2 12L13 3M5 16L16 7"/>'),
    fib: svg('<path d="M2 3h14M2 7h14M2 11h14M2 15h14" stroke-dasharray="2 1.5"/>'),
    fibext: svg('<path d="M2 15l4-8 3 4M10 4h7M10 8h7M10 12h7"/>'),
    rect: svg('<rect x="3" y="4" width="12" height="10" rx="1"/>'),
    text: svg('<path d="M4 4h10M9 4v11"/>'),
    arrowup: svg('<path d="M9 15V3M4 8l5-5 5 5"/>'),
    arrowdn: svg('<path d="M9 3v12M4 10l5 5 5-5"/>'),
    long: svg('<rect x="3" y="2" width="12" height="7" fill="rgba(8,153,129,.35)"/><rect x="3" y="9" width="12" height="6" fill="rgba(242,54,69,.35)"/>'),
    short: svg('<rect x="3" y="2" width="12" height="6" fill="rgba(242,54,69,.35)"/><rect x="3" y="8" width="12" height="7" fill="rgba(8,153,129,.35)"/>'),
    measure: svg('<path d="M9 2v14M5 6l4-4 4 4M5 12l4 4 4-4"/>'),
    avwap: svg('<path d="M9 3v9M5 9c0 3 2 5 4 5s4-2 4-5M7 4h4"/>'),
    magnet: svg('<path d="M4 3v6a5 5 0 0010 0V3h-3v6a2 2 0 01-4 0V3z"/>'),
    lock: svg('<rect x="4" y="8" width="10" height="7" rx="1"/><path d="M6 8V6a3 3 0 016 0v2"/>'),
    eye: svg('<path d="M1 9s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5z"/><circle cx="9" cy="9" r="2"/>'),
    trash: svg('<path d="M3 5h12M7 5V3h4v2M5 5l1 11h6l1-11"/>'),
    undo: svg('<path d="M6 4L2 8l4 4M2 8h9a4 4 0 010 8H8"/>'),
    redo: svg('<path d="M12 4l4 4-4 4M16 8H7a4 4 0 000 8h3"/>'),
    clone: svg('<rect x="6" y="6" width="9" height="9" rx="1"/><path d="M3 12V3h9"/>'),
    gear: svg('<circle cx="9" cy="9" r="2.5"/><path d="M9 1v3M9 14v3M1 9h3M14 9h3M3.3 3.3l2.1 2.1M12.6 12.6l2.1 2.1M3.3 14.7l2.1-2.1M12.6 5.4l2.1-2.1"/>'),
    close: svg('<path d="M4 4l10 10M14 4L4 14"/>'),
    camera: svg('<rect x="2" y="5" width="14" height="10" rx="1.5"/><circle cx="9" cy="10" r="3"/><path d="M6 5l1.5-2h3L12 5"/>'),
    replay: svg('<path d="M3 3v12M6 4l9 5-9 5z"/>'),
    expand: svg('<path d="M2 7V2h5M16 7V2h-5M2 11v5h5M16 11v5h-5"/>'),
    shrink: svg('<path d="M7 2v5H2M11 2v5h5M7 16v-5H2M11 16v-5h5"/>'),
    journal: svg('<path d="M4 2h10v14H4zM7 6h4M7 9h4M7 12h3"/>'),
  };

  // ---- indicator registry ----------------------------------------------------
  const closes = function (b) { return b.map(function (x) { return x.c; }); };
  const IND = {
    sma: { name: 'SMA', params: [['length', 'Length', 20]], color: '#ffd166',
      calc: function (b, p) { return { lines: [{ data: IND_LIB.sma(closes(b), p.length) }] }; } },
    ema: { name: 'EMA', params: [['length', 'Length', 21]], color: '#a78bfa',
      calc: function (b, p) { return { lines: [{ data: IND_LIB.ema(closes(b), p.length) }] }; } },
    bb: { name: 'Bollinger Bands', short: 'BB', params: [['length', 'Length', 20], ['mult', 'StdDev', 2]], color: '#7b8794',
      calc: function (b, p) { const r = IND_LIB.bollinger(b, p.length, p.mult); return { lines: [{ data: r.upper }, { data: r.mid, dash: true }, { data: r.lower }], fill: [0, 2] }; } },
    kc: { name: 'Keltner Channels', short: 'KC', params: [['length', 'Length', 20], ['mult', 'Multiplier', 2], ['atr', 'ATR length', 10]], color: '#2dd4bf',
      calc: function (b, p) { const r = IND_LIB.keltner(b, p.length, p.mult, p.atr); return { lines: [{ data: r.upper }, { data: r.mid, dash: true }, { data: r.lower }], fill: [0, 2] }; } },
    dc: { name: 'Donchian Channels', short: 'DC', params: [['length', 'Length', 20]], color: '#60a5fa',
      calc: function (b, p) { const r = IND_LIB.donchian(b, p.length); return { lines: [{ data: r.upper }, { data: r.mid, dash: true }, { data: r.lower }], fill: [0, 2] }; } },
    st: { name: 'SuperTrend', short: 'ST', params: [['atr', 'ATR length', 10], ['mult', 'Factor', 3]], color: '#089981',
      calc: function (b, p) { const r = IND_LIB.supertrend(b, p.atr, p.mult); return { lines: [{ data: r.line, dirs: r.dir, width: 1.6 }] }; } },
    vwap: { name: 'VWAP (session, intraday)', short: 'VWAP', params: [], color: '#fb923c', intradayOnly: true,
      calc: function (b) { return { lines: [{ data: IND_LIB.vwap(b, -new Date().getTimezoneOffset()) }] }; } },
    vol: { name: 'Volume', short: 'Vol', pane: true, weight: 0.7, params: [['ma', 'MA length', 20]], color: '#7b8794',
      calc: function (b, p) { return { volume: true, lines: p.ma > 0 ? [{ data: IND_LIB.sma(b.map(function (x) { return x.v || 0; }), p.ma), color: '#38bdf8' }] : [] }; } },
    rsi: { name: 'RSI', pane: true, params: [['length', 'Length', 14]], color: '#ff9e16',
      calc: function (b, p) { return { lines: [{ data: IND_LIB.rsi(b, p.length) }], levels: [70, 50, 30], range: [0, 100] }; } },
    macd: { name: 'MACD', pane: true, params: [['fast', 'Fast', 12], ['slow', 'Slow', 26], ['signal', 'Signal', 9]], color: '#38bdf8',
      calc: function (b, p) { const r = IND_LIB.macd(b, p.fast, p.slow, p.signal); return { hist: r.hist, lines: [{ data: r.macd }, { data: r.signal, color: '#ff9e16' }], levels: [0] }; } },
    stoch: { name: 'Stochastic', short: 'Stoch', pane: true, params: [['length', '%K length', 14], ['k', '%K smooth', 3], ['d', '%D smooth', 3]], color: '#38bdf8',
      calc: function (b, p) { const r = IND_LIB.stoch(b, p.length, p.k, p.d); return { lines: [{ data: r.k }, { data: r.d, color: '#ff9e16' }], levels: [80, 20], range: [0, 100] }; } },
    atr: { name: 'ATR', pane: true, params: [['length', 'Length', 14]], color: '#f472b6',
      calc: function (b, p) { return { lines: [{ data: IND_LIB.atr(b, p.length) }] }; } },
    obv: { name: 'On-Balance Volume', short: 'OBV', pane: true, params: [], color: '#38bdf8',
      calc: function (b) { return { lines: [{ data: IND_LIB.obv(b) }] }; } },
    adx: { name: 'ADX / DMI', short: 'ADX', pane: true, params: [['length', 'Length', 14]], color: '#ffeb3b',
      calc: function (b, p) { const r = IND_LIB.adx(b, p.length); return { lines: [{ data: r.adx, width: 1.6 }, { data: r.plusDI, color: '#089981' }, { data: r.minusDI, color: '#f23645' }], levels: [25] }; } },
  };
  function defaultParams(type) { const o = {}; IND[type].params.forEach(function (p) { o[p[0]] = p[2]; }); return o; }
  function newInd(type, params) { return { id: uid(), type: type, params: Object.assign(defaultParams(type), params || {}), color: IND[type].color, hidden: false }; }

  // ---- drawing tools ---------------------------------------------------------
  const TOOLS = {
    cursor: { name: 'Cross (Esc)' },
    trend: { n: 2, name: 'Trend line', key: 'KeyT' },
    ray: { n: 2, name: 'Ray' },
    ext: { n: 2, name: 'Extended line' },
    hline: { n: 1, name: 'Horizontal line', key: 'KeyH' },
    hray: { n: 1, name: 'Horizontal ray', key: 'KeyJ' },
    vline: { n: 1, name: 'Vertical line', key: 'KeyV' },
    channel: { n: 3, name: 'Parallel channel', key: 'KeyC' },
    fib: { n: 2, name: 'Fib retracement', key: 'KeyF' },
    fibext: { n: 3, name: 'Trend-based fib extension', key: 'KeyE' },
    rect: { n: 2, name: 'Rectangle', key: 'KeyR' },
    text: { n: 1, name: 'Text', key: 'KeyN' },
    arrowup: { n: 1, name: 'Arrow up' },
    arrowdn: { n: 1, name: 'Arrow down' },
    long: { n: 2, name: 'Long position (click entry, then stop)', key: 'KeyL' },
    short: { n: 2, name: 'Short position (click entry, then stop)', key: 'KeyS' },
    measure: { n: 2, name: 'Price / date range', key: 'KeyM' },
    avwap: { n: 1, name: 'Anchored VWAP (click a bar)', key: 'KeyA' },
  };
  const GROUPS = [
    ['cursor', ['cursor']],
    ['lines', ['trend', 'ray', 'ext', 'hline', 'hray', 'vline', 'channel']],
    ['fib', ['fib', 'fibext']],
    ['shapes', ['rect', 'text', 'arrowup', 'arrowdn']],
    ['measure', ['long', 'short', 'measure']],
    ['avwap', ['avwap']],
  ];
  const DEFAULT_COLOR = { trend: '#2962ff', ray: '#2962ff', ext: '#2962ff', hline: '#ff9800', hray: '#ff9800', vline: '#787b86', channel: '#2962ff',
    fib: '#787b86', fibext: '#787b86', rect: '#9c27b0', text: '#ffffff', arrowup: '#089981', arrowdn: '#f23645', long: '#089981', short: '#f23645',
    measure: '#2962ff', avwap: '#fb923c' };
  const TIMEFRAMES = [['1m', '1m'], ['5m', '5m'], ['15m', '15m'], ['60m', '1H'], ['1d', 'D'], ['1wk', 'W'], ['1mo', 'M']];
  const CHART_TYPES = [['candles', 'Candles'], ['hollow', 'Hollow candles'], ['heikin', 'Heikin Ashi'], ['bars', 'OHLC bars'], ['line', 'Line'], ['area', 'Area']];
  const ST_COL = { setup: '#38bdf8' };
  const isIntraday = function (iv) { return /m$|h$/.test(iv) && iv !== '1mo'; };

  // ---- persisted settings ----------------------------------------------------
  const CFG_KEY = 'finsight-chart-cfg2';
  function defaultCfg() {
    const s50 = newInd('sma', { length: 50 }); s50.color = '#38bdf8';
    return { chartType: 'candles', scale: 'linear', pct: false, magnet: false, strategy: '',
      sizer: { equity: '', risk: 0.5, fee: 1 },
      indicators: [newInd('sma', { length: 20 }), s50, newInd('vol')] };
  }
  function migrateOldCfg() {
    // v1 kept {mode, overlays:{sma20,...}, panes:{vol,rsi,macd}, strat, sizer}
    try {
      const o = JSON.parse(localStorage.getItem('finsight-chart-cfg') || 'null');
      if (!o) return null;
      const c = defaultCfg(); c.indicators = [];
      const ov = o.overlays || {}, pn = o.panes || {};
      if (ov.sma20 !== false) c.indicators.push(newInd('sma', { length: 20 }));
      if (ov.sma50 !== false) { const i = newInd('sma', { length: 50 }); i.color = '#38bdf8'; c.indicators.push(i); }
      if (ov.sma200) { const i = newInd('sma', { length: 200 }); i.color = '#c678dd'; c.indicators.push(i); }
      if (ov.ema21) c.indicators.push(newInd('ema', { length: 21 }));
      if (ov.bb) c.indicators.push(newInd('bb'));
      if (pn.vol !== false) c.indicators.push(newInd('vol'));
      if (pn.rsi) c.indicators.push(newInd('rsi'));
      if (pn.macd) c.indicators.push(newInd('macd'));
      if (o.mode === 'line' || o.mode === 'area') c.chartType = o.mode;
      if (o.strat === true) c.strategy = 'pullback';
      if (o.sizer) Object.assign(c.sizer, o.sizer);
      return c;
    } catch (e) { return null; }
  }
  function sanitizeCfg(raw) {
    const c = defaultCfg();
    if (!raw || typeof raw !== 'object') return c;
    if (CHART_TYPES.some(function (t) { return t[0] === raw.chartType; })) c.chartType = raw.chartType;
    if (raw.scale === 'log') c.scale = 'log';
    c.pct = !!raw.pct; c.magnet = !!raw.magnet;
    c.strategy = typeof raw.strategy === 'string' && window.FinStrategies && window.FinStrategies.get(raw.strategy) ? raw.strategy : raw.strat === true ? 'pullback' : '';
    if (raw.sizer && typeof raw.sizer === 'object') ['equity', 'risk', 'fee'].forEach(function (k) { if (raw.sizer[k] != null) c.sizer[k] = String(raw.sizer[k]).slice(0, 20); });
    if (Array.isArray(raw.indicators)) {
      c.indicators = raw.indicators.filter(function (x) { return x && IND[x.type]; }).slice(0, 20).map(function (x) {
        const i = newInd(x.type, {});
        IND[x.type].params.forEach(function (p) { const v = Number(x.params && x.params[p[0]]); if (isFinite(v) && v > 0 && v < 1000) i.params[p[0]] = v; });
        if (typeof x.color === 'string' && /^#[0-9a-f]{6}$/i.test(x.color)) i.color = x.color;
        i.hidden = !!x.hidden; if (typeof x.id === 'string') i.id = x.id.slice(0, 24);
        return i;
      });
    }
    return c;
  }
  function loadLocalCfg() {
    try { const raw = JSON.parse(localStorage.getItem(CFG_KEY) || 'null'); if (raw) return sanitizeCfg(raw); } catch (e) { /* ignore */ }
    return migrateOldCfg() || defaultCfg();
  }
  function cfgForSave(cfg) { return { chartType: cfg.chartType, scale: cfg.scale, pct: cfg.pct, magnet: cfg.magnet, strategy: cfg.strategy, sizer: cfg.sizer, indicators: cfg.indicators }; }

  async function api(path, body) {
    const r = await fetch(path, body === undefined ? { credentials: 'same-origin' } : { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(function () { return {}; });
    if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
    return j;
  }

  // =========================================================================
  //  PriceChart
  // =========================================================================
  function PriceChart(root) {
    this.root = root;
    root.__priceChart = this;
    root.classList.add('pc-root');
    this.cfg = loadLocalCfg();
    this.tool = 'cursor';
    this.groupLast = {};
    this.symbol = null; this.interval = '1d'; this.range = '1y';
    this.allBars = []; this.bars = []; this.disp = [];
    this.drawings = []; this.sel = -1;
    this.undoStack = []; this.redoStack = [];
    this.i0 = 0; this.i1 = 0; this.padBars = 0;
    this.hoverIdx = -1; this.mx = -1; this.my = -1; this.inside = false;
    this.drag = null; this.pending = null;
    this.replay = { active: false, picking: false, idx: 0, playing: false, speed: 2, timer: 0 };
    this.yManual = null;
    this._rsOn = false; this._roOn = false; this._lastAreaH = 0;
    this.onRequest = null; this.onSymbol = null; this.onLog = null; this.onJournal = null;
    this._build();
    const self = this;
    this.ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(function () { self.resize(); }) : null;
    if (this.ro) this.ro.observe(this.area);
    this._bind();
    this.resize();
    this._syncServerCfg();
  }

  // ---- DOM ---------------------------------------------------------------
  PriceChart.prototype._build = function () {
    const self = this;
    this.root.innerHTML = '';
    const el = function (tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
    const btn = function (html, title, cls) { const b = el('button', 'ctbtn' + (cls ? ' ' + cls : ''), html); b.type = 'button'; if (title) b.title = title; return b; };

    // top toolbar
    const tb = el('div', 'chart-toolbar');
    this.toolbar = tb;
    this.symInput = el('input', 'pc-sym'); this.symInput.placeholder = 'Symbol'; this.symInput.spellcheck = false;
    this.symInput.addEventListener('keydown', function (e) {
      e.stopPropagation();
      if (e.key === 'Enter') { const s = self.symInput.value.trim().toUpperCase(); if (s && self.onSymbol) self.onSymbol(s); self.symInput.blur(); }
    });
    tb.appendChild(this.symInput);
    tb.appendChild(el('span', 'sep'));
    this.tfBtns = {};
    const tfg = el('span', 'grp');
    TIMEFRAMES.forEach(function (tf) {
      const b = btn(tf[1], 'Timeframe ' + tf[1]);
      b.addEventListener('click', function () { if (self.onRequest) self.onRequest({ interval: tf[0] }); });
      self.tfBtns[tf[0]] = b; tfg.appendChild(b);
    });
    tb.appendChild(tfg);
    tb.appendChild(el('span', 'sep'));
    this.typeSel = el('select', 'pc-select');
    this.typeSel.title = 'Chart type';
    CHART_TYPES.forEach(function (t) { const o = el('option', null, t[1]); o.value = t[0]; self.typeSel.appendChild(o); });
    this.typeSel.addEventListener('change', function () { self.cfg.chartType = self.typeSel.value; self._cfgChanged(true); });
    tb.appendChild(this.typeSel);
    this.indBtn = btn('<b>ƒx</b> Indicators', 'Add / edit indicators');
    this.indBtn.addEventListener('click', function (e) { e.stopPropagation(); self._toggleIndMenu(); });
    tb.appendChild(this.indBtn);
    this.layoutBtn = btn('Layouts ▾', 'Save / load chart layouts (indicators, type, scale, strategy)');
    this.layoutBtn.addEventListener('click', function (e) { e.stopPropagation(); self._toggleLayoutMenu(); });
    tb.appendChild(this.layoutBtn);
    tb.appendChild(el('span', 'sep'));
    this.stratBtn = btn('Strategy ▾', 'Load a ready-made strategy (daily bars): signals, simulated trades, live levels and stats');
    this.stratBtn.addEventListener('click', function (e) { e.stopPropagation(); self._toggleStratMenu(); });
    tb.appendChild(this.stratBtn);
    this.replayBtn = btn(ICON.replay + ' Replay', 'Bar replay: pick a start bar, then step forward without seeing the future');
    this.replayBtn.addEventListener('click', function () { if (self.replay.active || self.replay.picking) self.stopReplay(); else self.startReplayPick(); });
    tb.appendChild(this.replayBtn);
    tb.appendChild(el('span', 'sep'));
    this.logBtn = btn(ICON.journal + ' Log', 'Log this setup / trade to the journal (with a chart snapshot)', 'pc-accent');
    this.logBtn.addEventListener('click', function () { self.logTrade(); });
    tb.appendChild(this.logBtn);
    this.journalBtn = btn('Journal', 'Open the trade journal');
    this.journalBtn.addEventListener('click', function () {
      if (self.onJournal) self.onJournal();
      else if (window.FinJournal) window.FinJournal.openList({ onOpenChart: self.onSymbol });
    });
    tb.appendChild(this.journalBtn);
    this.snapBtn = btn(ICON.camera, 'Save chart image (PNG)', 'tool');
    this.snapBtn.addEventListener('click', function () { self.downloadSnapshot(); });
    tb.appendChild(this.snapBtn);
    tb.appendChild(el('span', 'pc-spacer'));
    this.saveState = el('span', 'pc-save', '');
    tb.appendChild(this.saveState);
    this.logScaleBtn = btn('LOG', 'Logarithmic price scale');
    this.logScaleBtn.addEventListener('click', function () { self.cfg.scale = self.cfg.scale === 'log' ? 'linear' : 'log'; self.yManual = null; self._cfgChanged(true); });
    this.pctBtn = btn('%', 'Percent scale (from first visible bar)');
    this.pctBtn.addEventListener('click', function () { self.cfg.pct = !self.cfg.pct; self._cfgChanged(true); });
    this.autoBtn = btn('AUTO', 'Auto-fit price scale (or double-click the price axis)');
    this.autoBtn.addEventListener('click', function () { self.yManual = null; self._dirty(); });
    tb.appendChild(this.logScaleBtn); tb.appendChild(this.pctBtn); tb.appendChild(this.autoBtn);
    this.maxBtn = btn(ICON.expand, 'Expand chart (Esc to exit)', 'tool');
    this.maxBtn.addEventListener('click', function () { self.toggleMax(); });
    tb.appendChild(this.maxBtn);
    this.root.appendChild(tb);

    // strategy bar
    const sb = el('div', 'strat-bar');
    sb.style.display = 'none';
    sb.innerHTML =
      '<div class="sb-row"><span class="sb-stage"></span><span class="sb-detail"></span></div>' +
      '<div class="sb-row sb-hist"></div>' +
      '<div class="sb-row sb-sizer">' +
        '<label>Equity <input data-k="equity" inputmode="decimal" placeholder="sleeve size"></label>' +
        '<label>Risk % <input data-k="risk" inputmode="decimal"></label>' +
        '<label>Fee/order <input data-k="fee" inputmode="decimal"></label>' +
        '<span class="sb-size"></span>' +
      '</div>' +
      '<div class="sb-row sb-note"></div>';
    this.stratBar = sb;
    sb.querySelectorAll('input').forEach(function (inp) {
      inp.addEventListener('input', function () { self.cfg.sizer[inp.dataset.k] = inp.value.trim(); self._cfgChanged(false); self._renderStratBar(); self.requestOverlay(); });
      inp.addEventListener('keydown', function (e) { e.stopPropagation(); });
    });
    this.root.appendChild(sb);

    // replay bar
    const rb = el('div', 'replay-bar');
    rb.style.display = 'none';
    rb.innerHTML = '<span class="rb-label"></span>' +
      '<button type="button" class="ctbtn" data-a="back" title="Step back (←)">◀</button>' +
      '<button type="button" class="ctbtn" data-a="play" title="Play / pause (Space)">▶</button>' +
      '<button type="button" class="ctbtn" data-a="fwd" title="Step forward (→)">▶|</button>' +
      '<select class="pc-select" data-a="speed" title="Bars per second"><option value="1">1×</option><option value="2" selected>2×</option><option value="5">5×</option><option value="10">10×</option></select>' +
      '<button type="button" class="ctbtn" data-a="exit" title="Exit replay">Exit replay</button>' +
      '<span class="muted small">← → step · Space play · future bars hidden; indicators and the strategy only see the past</span>';
    rb.addEventListener('click', function (e) {
      const a = e.target.closest('button[data-a]'); if (!a) return;
      if (a.dataset.a === 'back') self.replayStep(-1);
      else if (a.dataset.a === 'fwd') self.replayStep(1);
      else if (a.dataset.a === 'play') self.replayToggle();
      else if (a.dataset.a === 'exit') self.stopReplay();
    });
    rb.querySelector('select').addEventListener('change', function (e) { self.replay.speed = Number(e.target.value) || 2; if (self.replay.playing) { self.replayToggle(); self.replayToggle(); } });
    this.replayBar = rb;
    this.root.appendChild(rb);

    // body: left tool strip + chart area
    const body = el('div', 'pc-body');
    const left = el('div', 'pc-tools');
    this.leftBar = left;
    this.groupBtns = {};
    GROUPS.forEach(function (g) {
      const wrap = el('div', 'pc-tgroup');
      const main = btn(ICON[g[1][0]], TOOLS[g[1][0]].name, 'tool pc-tbtn');
      main.addEventListener('click', function () { self.setTool(self.groupLast[g[0]] || g[1][0]); });
      wrap.appendChild(main);
      if (g[1].length > 1) {
        const more = btn('', 'More tools', 'pc-more');
        const fly = el('div', 'pc-fly');
        g[1].forEach(function (t) {
          const it = btn(ICON[t] + '<span>' + esc(TOOLS[t].name) + (TOOLS[t].key ? ' <i>⌥' + TOOLS[t].key.slice(3) + '</i>' : '') + '</span>', null, 'pc-flyitem');
          it.addEventListener('click', function (e) { e.stopPropagation(); fly.classList.remove('open'); self.setTool(t); });
          fly.appendChild(it);
        });
        more.addEventListener('click', function (e) {
          e.stopPropagation(); const o = fly.classList.contains('open'); self._closeMenus();
          if (o) return;
          const r = wrap.getBoundingClientRect();
          fly.style.left = (r.right + 4) + 'px'; fly.style.top = Math.min(r.top, window.innerHeight - 40 - g[1].length * 28) + 'px';
          fly.classList.add('open');
        });
        wrap.appendChild(more); wrap.appendChild(fly);
      }
      self.groupBtns[g[0]] = { main: main, tools: g[1] };
      left.appendChild(wrap);
    });
    left.appendChild(el('div', 'pc-tsep'));
    this.magnetBtn = btn(ICON.magnet, 'Magnet: snap to open/high/low/close', 'tool pc-tbtn');
    this.magnetBtn.addEventListener('click', function () { self.cfg.magnet = !self.cfg.magnet; self._cfgChanged(false); });
    this.undoBtn = btn(ICON.undo, 'Undo (⌘/Ctrl+Z)', 'tool pc-tbtn');
    this.undoBtn.addEventListener('click', function () { self.undo(); });
    this.redoBtn = btn(ICON.redo, 'Redo (⌘/Ctrl+Shift+Z)', 'tool pc-tbtn');
    this.redoBtn.addEventListener('click', function () { self.redo(); });
    this.hideBtn = btn(ICON.eye, 'Hide / show all drawings', 'tool pc-tbtn');
    this.hideBtn.addEventListener('click', function () { self.hideAll = !self.hideAll; self.hideBtn.classList.toggle('on', !!self.hideAll); self.select(-1); });
    this.clearBtn = btn(ICON.trash, 'Remove all drawings on this symbol', 'tool pc-tbtn');
    this.clearBtn.addEventListener('click', function () { self.clearDrawings(); });
    [this.magnetBtn, this.undoBtn, this.redoBtn, this.hideBtn, this.clearBtn].forEach(function (b) { left.appendChild(b); });
    body.appendChild(left);

    const area = el('div', 'chart-area');
    this.area = area;
    this.staticCv = el('canvas', 'chart-static');
    this.overlayCv = el('canvas', 'chart-overlay');
    this.overlayCv.tabIndex = 0;
    this.legend = el('div', 'chart-legend');
    this.paneLegends = el('div', 'pc-panelegends');
    this.styleBar = el('div', 'pc-stylebar');
    this.styleBar.style.display = 'none';
    this.menu = el('div', 'pc-menu');
    this.menu.style.display = 'none';
    [this.staticCv, this.overlayCv, this.legend, this.paneLegends, this.styleBar, this.menu].forEach(function (x) { area.appendChild(x); });
    body.appendChild(area);
    this.root.appendChild(body);

    this.ctx = this.staticCv.getContext('2d');
    this.octx = this.overlayCv.getContext('2d');
    this._syncControls();
  };

  PriceChart.prototype._syncControls = function () {
    const c = this.cfg, self = this;
    this.typeSel.value = c.chartType;
    this.logScaleBtn.classList.toggle('on', c.scale === 'log');
    this.pctBtn.classList.toggle('on', !!c.pct);
    const sd = c.strategy && window.FinStrategies ? window.FinStrategies.get(c.strategy) : null;
    this.stratBtn.classList.toggle('on', !!sd);
    this.stratBtn.textContent = sd ? '◆ ' + sd.short + ' ▾' : 'Strategy ▾';
    this.magnetBtn.classList.toggle('on', !!c.magnet);
    for (const k in this.tfBtns) this.tfBtns[k].classList.toggle('on', k === this.interval);
    this.stratBar.querySelectorAll('input').forEach(function (inp) { if (document.activeElement !== inp) inp.value = self.cfg.sizer[inp.dataset.k]; });
    for (const g in this.groupBtns) {
      const gb = this.groupBtns[g], active = gb.tools.indexOf(this.tool) >= 0;
      gb.main.classList.toggle('on', active);
      const shown = active ? this.tool : (this.groupLast[g] || gb.tools[0]);
      if (gb.shown !== shown) { gb.main.innerHTML = ICON[shown]; gb.main.title = TOOLS[shown].name; gb.shown = shown; }
    }
    this.undoBtn.disabled = !this.undoStack.length;
    this.redoBtn.disabled = !this.redoStack.length;
  };

  // ---- settings persistence -------------------------------------------------
  PriceChart.prototype._cfgChanged = function (recompute) {
    try { localStorage.setItem(CFG_KEY, JSON.stringify(cfgForSave(this.cfg))); } catch (e) { /* ignore */ }
    const self = this;
    clearTimeout(this._cfgTimer);
    this._cfgTimer = setTimeout(function () { api('/api/charts/current', { cfg: cfgForSave(self.cfg) }).catch(function () { /* offline: local copy kept */ }); }, 800);
    this._syncControls();
    if (recompute) { this._computeIndicators(); this.resize(); } else this.requestOverlay();
  };
  PriceChart.prototype._syncServerCfg = function () {
    const self = this;
    api('/api/charts/layouts').then(function (r) {
      self.layouts = r.layouts || {};
      // The server copy wins when this browser has no local settings yet.
      let hasLocal = false; try { hasLocal = !!localStorage.getItem(CFG_KEY); } catch (e) { /* ignore */ }
      if (r.current && !hasLocal) { self.cfg = sanitizeCfg(r.current); self._syncControls(); self._computeIndicators(); self.resize(); }
    }).catch(function () { self.layouts = {}; });
  };

  // ---- events --------------------------------------------------------------
  PriceChart.prototype._bind = function () {
    const self = this, ov = this.overlayCv;
    ov.addEventListener('mousemove', function (e) { if (!self.drag) self._onMove(e); });
    ov.addEventListener('mousedown', function (e) { self._onDown(e); });
    this._onUpWin = function (e) { self._onUp(e); };
    window.addEventListener('mouseup', this._onUpWin);
    this._onMoveWin = function (e) { if (self.drag) self._onMove(e); };
    window.addEventListener('mousemove', this._onMoveWin);
    ov.addEventListener('mouseleave', function () { if (!self.drag) { self.inside = false; self.requestOverlay(); } });
    ov.addEventListener('mouseenter', function () { self.inside = true; });
    ov.addEventListener('wheel', function (e) { self._onWheel(e); }, { passive: false });
    ov.addEventListener('dblclick', function (e) { self._onDblClick(e); });
    ov.addEventListener('contextmenu', function (e) { e.preventDefault(); if (self.pending || self.tool !== 'cursor') { self.pending = null; self.setTool('cursor'); } });
    this._onKey = function (e) { self._key(e); };
    window.addEventListener('keydown', this._onKey);
    this._onWinResize = function () { if (self.maxed) self.resize(); };
    window.addEventListener('resize', this._onWinResize);
    this._onDocClick = function (e) { if (!e.target.closest || !e.target.closest('.pc-menu,.pc-fly,.pc-more,.chart-toolbar .ctbtn')) self._closeMenus(); };
    document.addEventListener('click', this._onDocClick);
  };

  PriceChart.prototype._key = function (e) {
    const tag = (e.target && e.target.tagName) || '';
    if (/INPUT|TEXTAREA|SELECT/.test(tag) || (e.target && e.target.isContentEditable)) return;
    if (!(this.maxed || this.inside || document.activeElement === this.overlayCv)) return;
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === 'Escape') {
      if (this.pending || this.tool !== 'cursor') { this.pending = null; this.setTool('cursor'); }
      else if (this.replay.picking) this.stopReplay();
      else if (this.sel >= 0) this.select(-1);
      else if (this.maxed) this.toggleMax(false);
      e.preventDefault(); return;
    }
    if (mod && e.code === 'KeyZ') { e.preventDefault(); if (e.shiftKey) this.redo(); else this.undo(); return; }
    if (mod && e.code === 'KeyY') { e.preventDefault(); this.redo(); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.sel >= 0) { e.preventDefault(); this.deleteSelected(); return; }
    if (e.altKey && !mod) { for (const t in TOOLS) if (TOOLS[t].key === e.code) { e.preventDefault(); this.setTool(t); return; } }
    if (this.replay.active && !mod && !e.altKey) {
      if (e.key === 'ArrowRight') { e.preventDefault(); this.replayStep(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); this.replayStep(-1); }
      else if (e.key === ' ') { e.preventDefault(); this.replayToggle(); }
    }
  };

  // ---- data load -----------------------------------------------------------
  PriceChart.prototype.load = function (symbol, bars, meta, ctx) {
    const sameSym = symbol === this.symbol;
    const sameView = sameSym && ctx && this.interval === ctx.interval && this.range === ctx.range;
    this.symbol = symbol;
    this.meta = meta || {};
    this.interval = (ctx && ctx.interval) || '1d';
    this.range = (ctx && ctx.range) || '1y';
    if (document.activeElement !== this.symInput) this.symInput.value = symbol;
    this.allBars = (Array.isArray(bars) ? bars : []).filter(function (b) { return b && b.c != null && isFinite(b.c); });
    if (!sameSym) { this.sel = -1; this._renderStyleBar(); this.pending = null; this.tool = 'cursor'; this.undoStack = []; this.redoStack = []; this.yManual = null; this._loadDrawings(symbol); }
    if (!sameView && (this.replay.active || this.replay.picking)) this.stopReplay(true);
    this._applyReplaySlice();
    this._computeIndicators();
    const n = this.bars.length;
    if (sameView && this.i1 > 0 && this.i1 <= n) {
      const grew = n - this._prevN;
      if (grew > 0 && this.i1 >= this._prevN && !this.replay.active) { this.i0 += grew; this.i1 += grew; }
      this.i1 = Math.min(this.i1, n); this.i0 = clamp(this.i0, 0, Math.max(0, this.i1 - this._minBars()));
      this._dirty();
    } else if (ctx && ctx.visibleFrom != null) {
      const i0 = this.bars.findIndex(function (b) { return b.t >= ctx.visibleFrom; });
      this.setRange(i0 < 0 ? 0 : i0, n);
    } else {
      this.setRange(n - Math.min(n, 150), n);
    }
    this._prevN = n;
    this._syncControls();
  };

  PriceChart.prototype._applyReplaySlice = function () {
    if (this.replay.active) {
      this.replay.idx = clamp(this.replay.idx, 1, Math.max(1, this.allBars.length - 1));
      this.bars = this.allBars.slice(0, this.replay.idx + 1);
    } else this.bars = this.allBars;
  };

  PriceChart.prototype._minBars = function () { return Math.min(this.bars.length || 1, 10); };
  PriceChart.prototype.setRange = function (i0, i1) {
    const n = this.bars.length;
    this.i1 = Math.min(n, Math.max(1, Math.round(i1)));
    this.i0 = Math.max(0, Math.min(Math.round(i0), this.i1 - this._minBars()));
    this._dirty();
  };
  PriceChart.prototype._dirty = function () { this._dirtyStatic = true; this.requestRender(); };

  // ---- indicators ------------------------------------------------------------
  PriceChart.prototype._computeIndicators = function () {
    const b = this.bars, self = this;
    this.disp = this.cfg.chartType === 'heikin' && b.length ? IND_LIB.heikinAshi(b) : b;
    const intraday = isIntraday(this.interval);
    this.indOut = this.cfg.indicators.map(function (inst) {
      const def = IND[inst.type];
      let out = { lines: [] };
      if (b.length && !inst.hidden && !(def.intradayOnly && !intraday)) {
        try { out = def.calc(b, inst.params); } catch (e) { out = { lines: [] }; }
      }
      return { inst: inst, def: def, out: out };
    });
    this._avCache = null;
    this.strat = null; this._stMap = null;
    if (this.cfg.strategy && this.interval === '1d' && window.FinStrategies && b.length) {
      let a = null;
      try { a = window.FinStrategies.run(this.cfg.strategy, b); } catch (e) { a = null; }
      if (a) {
        // the engine drops malformed bars: map its indices back to chart indices by time
        const byT = new Map(); b.forEach(function (x, i) { byT.set(x.t, i); });
        this._stMap = a.bars.map(function (x) { return byT.get(x.t); });
        const full = function (arr) { const out = new Array(b.length).fill(null); arr.forEach(function (v, k) { out[self._stMap[k]] = v; }); return out; };
        a.lines = a.lines.map(function (l) { return Object.assign({}, l, { data: full(l.data) }); });
        a.bands = (a.bands || []).map(function (bd) { return Object.assign({}, bd, { upper: full(bd.upper), lower: full(bd.lower) }); });
        this.strat = a;
      }
    }
    this._renderStratBar();
  };

  PriceChart.prototype._ci = function (k) { return this._stMap ? this._stMap[k] : k; };
  PriceChart.prototype._sizerVals = function () {
    const s = this.cfg.sizer, num = function (v) { const n = parseFloat(String(v).replace(/,/g, '')); return isFinite(n) ? n : NaN; };
    return { equity: num(s.equity), riskPct: num(s.risk), feePerOrder: num(s.fee) || 0 };
  };

  PriceChart.prototype._renderStratBar = function () {
    const sb = this.stratBar; if (!sb) return;
    sb.style.display = this.cfg.strategy ? '' : 'none';
    if (!this.cfg.strategy) return;
    const stEl = sb.querySelector('.sb-stage'), dEl = sb.querySelector('.sb-detail'), hEl = sb.querySelector('.sb-hist'), zEl = sb.querySelector('.sb-size');
    const a = this.strat, def = window.FinStrategies ? window.FinStrategies.get(this.cfg.strategy) : null;
    const sizerRow = sb.querySelector('.sb-sizer');
    sb.querySelector('.sb-note').innerHTML = def ? '<details' + (this._rulesOpen ? ' open' : '') + '><summary>' + esc(def.name) + ' — rules, source &amp; caveats</summary><ol>' + def.rules.map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('') + '</ol>' + esc(def.source) +
      (def.kind === 'zones' ? ' ◆ = zone tranche.' : ' ▲ signal · ▶ entry · ● exit' + (this.cfg.strategy === 'pullback' || this.cfg.strategy === 'breakout' ? ' · “?” = stop assumed on the entry bar (daily bars cannot order it)' : '') + '.') +
      ' Single-symbol simulation, 10 bps/side; the last bar may still be trading. Research aid — not a signal or advice.</details>' : '';
    const det = sb.querySelector('.sb-note details'), self2 = this;
    if (det) det.addEventListener('toggle', function () { self2._rulesOpen = det.open; if (self2.maxed) self2.resize(); });
    sizerRow.style.display = def && def.kind === 'zones' ? 'none' : '';
    if (!a) {
      stEl.className = 'sb-stage st-off';
      stEl.textContent = this.interval === '1d' ? 'NO DATA' : 'DAILY ONLY';
      dEl.textContent = this.interval === '1d' ? '' : 'Switch to D (daily) — the strategy is defined on daily bars.';
      hEl.textContent = ''; zEl.textContent = ''; return;
    }
    const g = a.stage;
    stEl.className = 'sb-stage st-' + g.code;
    stEl.textContent = g.label.toUpperCase();
    const asOf = this.bars.length ? ' · as of ' + fmtDate(this.bars[this.bars.length - 1].t) + (this.replay.active ? ' (replay)' : '') : '';
    dEl.textContent = (g.detail || '') + (g.ret ? '  ·  1m ' + pct(g.ret[0]) + ' · 3m ' + pct(g.ret[1]) + ' · 6m ' + pct(g.ret[2]) : '') + asOf;
    hEl.textContent = 'History on this symbol (' + a.bars.length + ' bars): ' + this._statsText(a);
    if (a.kind === 'zones') { zEl.textContent = ''; return; }
    let entry = null, stop = null;
    if (g.code === 'setup' || g.code === 'signal') { entry = g.trig; stop = g.stop; } else if (a.open) { entry = a.open.entry; stop = a.open.stop; }
    if (entry == null) { zEl.textContent = 'Sizing appears for a setup or open trade (or draw a Long position).'; return; }
    const z = window.FinStrategy.size(Object.assign(this._sizerVals(), { entry: entry, stop: stop }));
    zEl.textContent = z.ok
      ? '→ ' + z.shares + ' sh · ' + fmtPrice(z.value, 2) + ' (' + z.weightPct.toFixed(1) + '% of equity) · risk ' + fmtPrice(z.risk, 2) + ' · stop ' + z.stopPct.toFixed(1) + '% · fees ≈ ' + (z.feeR != null ? z.feeR.toFixed(2) : '—') + 'R' + (z.cashShort ? ' · exceeds equity' : '')
      : '→ ' + z.why;
  };

  // ---- toolbar actions ---------------------------------------------------------
  PriceChart.prototype._statsText = function (a) {
    const s = a.stats;
    const sg = function (v, d) { return v == null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(d == null ? 2 : d); };
    if (a.kind === 'zones') {
      if (!s.n) return 'no completed zone tranches yet' + (s.pending ? ' (' + s.pending + ' pending)' : '');
      return s.n + ' tranches · next-63-bar return avg ' + sg(s.avgFwd * 100, 1) + '% (' + (s.pctPos * 100).toFixed(0) + '% positive) vs ' + sg(s.baseAvg * 100, 1) + '% for any day · edge ' + sg(s.edge * 100, 1) + ' pts' + (s.n < 20 ? '  (small sample)' : '');
    }
    if (!s.n) return 'no completed simulated trades';
    if (a.measure === 'pct') return s.n + ' trades · win ' + (s.winRate * 100).toFixed(0) + '% · avg ' + sg(s.avgWin * 100, 1) + '% / ' + sg(s.avgLoss * 100, 1) + '% · per trade ' + sg(s.expectancy * 100, 2) + '% · compounded ' + sg(s.compounded * 100, 0) + '% · avg hold ' + s.avgBars.toFixed(0) + ' bars · worst streak ' + s.maxLossStreak + (s.n < 30 ? '  (small sample)' : '');
    return s.n + ' trades · win ' + (s.winRate * 100).toFixed(0) + '% · avg ' + sg(s.avgWin) + 'R / ' + sg(s.avgLoss) + 'R · expectancy ' + sg(s.expectancy) + 'R · total ' + sg(s.totalR, 1) + 'R · worst streak ' + s.maxLossStreak + (s.sameDayStops ? ' · ambiguous same-day stops ' + s.sameDayStops : '') + (s.n < 30 ? '  (small sample)' : '');
  };
  PriceChart.prototype.toggleStrategy = function () { this.setStrategy(this.cfg.strategy ? '' : 'pullback'); };
  PriceChart.prototype.setStrategy = function (id) { this.cfg.strategy = id || ''; this._cfgChanged(true); };
  // Strategy menu: every strategy run on the loaded symbol so they can be compared before loading one.
  PriceChart.prototype._toggleStratMenu = function () {
    if (this.menuKind === 'strat') { this._closeMenus(); return; }
    this._closeMenus(); this.menuKind = 'strat'; this._renderStratMenu();
  };
  PriceChart.prototype._renderStratMenu = function () {
    const self = this, m = this.menu, L = window.FinStrategies;
    if (!L) { m.innerHTML = '<div class="pc-mempty">Strategy library not loaded</div>'; m.style.display = 'block'; return; }
    const daily = this.interval === '1d', bars = this.allBars;
    let html = '<div class="pc-mh">Strategies — ' + esc(this.symbol || '') + (daily ? ' · ' + (this.replay.active ? 'replay bars' : bars.length + ' daily bars') : '') + '</div>';
    if (!daily) html += '<div class="pc-mnote">Strategies run on daily bars — switch the timeframe to D to see results.</div>';
    L.list().forEach(function (d) {
      let res = '';
      if (daily && self.bars.length) {
        try { const r = L.run(d.id, self.bars); res = '<span class="pc-sres">' + esc(r.stage.label) + '</span><span class="muted small">' + esc(self._statsText(r)) + '</span>'; }
        catch (e) { res = '<span class="muted small">—</span>'; }
      }
      const on = self.cfg.strategy === d.id;
      html += '<div class="pc-mstrat' + (on ? ' on' : '') + '"><div class="pc-mrow"><span class="pc-mname">' + esc(d.name) + '</span>' +
        '<button type="button" class="ctbtn' + (on ? ' on' : ' pc-accent') + '" data-s="' + d.id + '">' + (on ? 'Loaded' : 'Load') + '</button>' +
        '<button type="button" class="ctbtn" data-rules="' + d.id + '">Rules</button></div>' +
        '<div class="pc-msum">' + esc(d.summary) + '</div>' + (res ? '<div class="pc-mres">' + res + '</div>' : '') +
        '<div class="pc-mrules" data-for="' + d.id + '" hidden><ol>' + d.rules.map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('') + '</ol><div class="muted small">' + esc(d.source) + '</div></div></div>';
    });
    html += '<div class="pc-mrow"><button type="button" class="ctbtn" data-s="">Strategy off</button><span class="pc-mnote">Results are one symbol, daily bars, 10 bps/side, survivorship and selection bias apply — compare them, do not trade on them. A loaded strategy is saved with your layout.</span></div>';
    m.innerHTML = html; m.style.display = 'block';
    m.onchange = null; m.onkeydown = null;
    m.onclick = function (e) {
      e.stopPropagation();
      const r = e.target.closest('[data-rules]');
      if (r) { const box = m.querySelector('.pc-mrules[data-for="' + r.dataset.rules + '"]'); box.hidden = !box.hidden; return; }
      const b = e.target.closest('[data-s]'); if (!b) return;
      self.setStrategy(b.dataset.s); self._closeMenus();
      if (b.dataset.s && self.interval !== '1d' && self.onRequest) self.onRequest({ interval: '1d' });
    };
  };
  PriceChart.prototype.toggleMax = function (force) {
    const want = typeof force === 'boolean' ? force : !this.maxed;
    if (want === !!this.maxed) return;
    this.maxed = want;
    // Re-parent to <body> while expanded: panel ancestors form their own
    // stacking contexts, so position:fixed inside them can sit under other panels.
    if (this.maxed) { this._home = { parent: this.root.parentNode, next: this.root.nextSibling }; document.body.appendChild(this.root); }
    else if (this._home && this._home.parent) { this._home.parent.insertBefore(this.root, this._home.next); this._home = null; }
    this.root.classList.toggle('chart-max', this.maxed);
    this.maxBtn.innerHTML = this.maxed ? ICON.shrink : ICON.expand;
    this.maxBtn.classList.toggle('on', this.maxed);
    document.body.classList.toggle('chart-max-open', this.maxed);
    this.resize();
  };
  PriceChart.prototype.setTool = function (t) {
    if (!TOOLS[t]) t = 'cursor';
    this.tool = t; this.pending = null;
    for (const g in this.groupBtns) if (t !== 'cursor' && this.groupBtns[g].tools.indexOf(t) >= 0) this.groupLast[g] = t;
    if (this.replay.picking && t !== 'cursor') { this.replay.picking = false; this.replayBtn.classList.toggle('on', this.replay.active); }
    this.overlayCv.style.cursor = t === 'cursor' ? 'crosshair' : 'cell';
    this._syncControls();
    this.requestOverlay();
  };
  PriceChart.prototype._closeMenus = function () {
    this.root.querySelectorAll('.pc-fly.open').forEach(function (f) { f.classList.remove('open'); });
    this.menu.style.display = 'none'; this.menuKind = null;
  };

  // Indicator menu: add from the library, edit parameters/colour, hide, remove.
  PriceChart.prototype._toggleIndMenu = function () {
    if (this.menuKind === 'ind') { this._closeMenus(); return; }
    this._closeMenus(); this.menuKind = 'ind'; this._renderIndMenu();
  };
  PriceChart.prototype._renderIndMenu = function () {
    const self = this, m = this.menu;
    let html = '<div class="pc-mh">On chart</div>';
    if (!this.cfg.indicators.length) html += '<div class="pc-mempty">None</div>';
    this.cfg.indicators.forEach(function (inst, k) {
      const def = IND[inst.type];
      html += '<div class="pc-mrow" data-k="' + k + '"><input type="color" value="' + inst.color + '" data-f="color" title="Colour">' +
        '<span class="pc-mname">' + esc(def.name) + '</span>' +
        def.params.map(function (p) { return '<label>' + esc(p[1]) + ' <input type="number" step="any" min="0" data-f="' + p[0] + '" value="' + inst.params[p[0]] + '"></label>'; }).join('') +
        '<button type="button" class="ctbtn tool' + (inst.hidden ? '' : ' on') + '" data-f="hide" title="Show / hide">' + ICON.eye + '</button>' +
        '<button type="button" class="ctbtn tool" data-f="del" title="Remove">' + ICON.close + '</button></div>';
    });
    html += '<div class="pc-mh">Add indicator</div><div class="pc-madd">';
    Object.keys(IND).forEach(function (t) { html += '<button type="button" class="ctbtn" data-add="' + t + '">' + esc(IND[t].name) + (IND[t].pane ? ' <i>pane</i>' : '') + '</button>'; });
    html += '</div>';
    m.innerHTML = html;
    m.style.display = 'block';
    m.onclick = function (e) {
      e.stopPropagation();
      const add = e.target.closest('[data-add]');
      if (add) { self.cfg.indicators.push(newInd(add.dataset.add)); self._cfgChanged(true); self._renderIndMenu(); return; }
      const b = e.target.closest('button[data-f]'); if (!b) return;
      const k = Number(b.closest('.pc-mrow').dataset.k);
      if (b.dataset.f === 'del') self.cfg.indicators.splice(k, 1);
      else if (b.dataset.f === 'hide') self.cfg.indicators[k].hidden = !self.cfg.indicators[k].hidden;
      self._cfgChanged(true); self._renderIndMenu();
    };
    m.onchange = function (e) {
      const inp = e.target, row = inp.closest('.pc-mrow'); if (!row) return;
      const inst = self.cfg.indicators[Number(row.dataset.k)];
      if (inp.dataset.f === 'color') inst.color = inp.value;
      else { const v = Number(inp.value); if (isFinite(v) && v > 0 && v < 1000) inst.params[inp.dataset.f] = v; else inp.value = inst.params[inp.dataset.f]; }
      self._cfgChanged(true);
    };
    m.onkeydown = function (e) { e.stopPropagation(); };
  };

  PriceChart.prototype._toggleLayoutMenu = function () {
    if (this.menuKind === 'layout') { this._closeMenus(); return; }
    this._closeMenus(); this.menuKind = 'layout'; this._renderLayoutMenu();
  };
  PriceChart.prototype._renderLayoutMenu = function () {
    const self = this, m = this.menu, names = Object.keys(this.layouts || {}).sort();
    m.innerHTML = '<div class="pc-mh">Save current layout</div>' +
      '<div class="pc-mrow"><input class="pc-lname" maxlength="40" placeholder="Layout name, e.g. Pullback daily"><button type="button" class="ctbtn pc-accent" data-l="save">Save</button></div>' +
      '<div class="pc-mh">Saved layouts</div>' +
      (names.length ? names.map(function (n) {
        const l = self.layouts[n];
        return '<div class="pc-mrow"><span class="pc-mname">' + esc(n) + '</span><span class="muted small">' + ((l.indicators || []).length) + ' ind · ' + esc(l.chartType || '') + (l.strategy ? ' · ' + esc(l.strategy) : l.strat ? ' · pullback' : '') + '</span>' +
          '<button type="button" class="ctbtn" data-l="load" data-n="' + esc(n) + '">Load</button><button type="button" class="ctbtn tool" data-l="del" data-n="' + esc(n) + '" title="Delete layout">' + ICON.close + '</button></div>';
      }).join('') : '<div class="pc-mempty">No saved layouts yet</div>') +
      '<div class="pc-mnote">A layout stores indicators, chart type, scale, strategy layer and sizer. Drawings are saved automatically per symbol on this computer\'s FinSight server.</div>';
    m.style.display = 'block';
    const nameIn = m.querySelector('.pc-lname');
    nameIn.addEventListener('keydown', function (e) { e.stopPropagation(); if (e.key === 'Enter') m.querySelector('[data-l=save]').click(); });
    m.onchange = null; m.onkeydown = null;
    m.onclick = function (e) {
      e.stopPropagation();
      const b = e.target.closest('[data-l]'); if (!b) return;
      const act = b.dataset.l, n = b.dataset.n;
      if (act === 'save') {
        const name = nameIn.value.trim(); if (!name) { nameIn.focus(); return; }
        api('/api/charts/layouts/save', { name: name, cfg: cfgForSave(self.cfg) }).then(function (r) { self.layouts = r.layouts; self._flash('Layout “' + name + '” saved'); self._renderLayoutMenu(); })
          .catch(function (err) { self._flash(err.message, true); });
      } else if (act === 'load') {
        const l = self.layouts[n]; if (!l) return;
        self.cfg = sanitizeCfg(l); self._cfgChanged(true); self._closeMenus(); self._flash('Loaded “' + n + '”');
      } else if (act === 'del') {
        if (!window.confirm('Delete layout “' + n + '”?')) return;
        api('/api/charts/layouts/delete', { name: n }).then(function (r) { self.layouts = r.layouts; self._renderLayoutMenu(); }).catch(function (err) { self._flash(err.message, true); });
      }
    };
  };
  PriceChart.prototype._flash = function (msg, bad) {
    this.saveState.textContent = msg; this.saveState.className = 'pc-save ' + (bad ? 'bad' : 'ok');
    const self = this; clearTimeout(this._flashT);
    this._flashT = setTimeout(function () { self._setSaveState(self._saveStatus || ''); }, 2600);
  };
  PriceChart.prototype._setSaveState = function (s) {
    this._saveStatus = s;
    const map = { saving: ['Saving…', ''], saved: ['● Drawings saved', 'ok'], local: ['● Saved in browser only (server unreachable)', 'bad'] };
    const v = map[s] || ['', ''];
    this.saveState.textContent = v[0]; this.saveState.className = 'pc-save ' + v[1];
  };

  // ---- layout / sizing -------------------------------------------------------
  PriceChart.prototype._paneInds = function () { return (this.indOut || []).filter(function (x) { return x.def.pane && !x.inst.hidden; }); };
  PriceChart.prototype._desiredHeight = function () {
    const panes = this._paneInds();
    if (this.maxed) {
      const used = this.toolbar.offsetHeight + (this.cfg.strategy ? this.stratBar.offsetHeight : 0) + (this.replay.active ? this.replayBar.offsetHeight : 0) + 34;
      return Math.max(380, window.innerHeight - used);
    }
    let h = 360;
    panes.forEach(function (p) { h += p.def.weight ? 60 : 96; });
    return h;
  };
  PriceChart.prototype.resize = function () {
    const want = this._desiredHeight();
    if (want !== this._lastAreaH) { this.area.style.height = want + 'px'; this.leftBar.style.height = want + 'px'; this._lastAreaH = want; }
    const r = this.area.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    const dpr = window.devicePixelRatio || 1;
    this.cssW = r.width; this.cssH = r.height; this.dpr = dpr;
    [this.staticCv, this.overlayCv].forEach(function (cv) {
      cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
      cv.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
    });
    this._dirtyStatic = true;
    this.render();
  };

  PriceChart.prototype._layout = function () {
    const padTop = 6, padLeft = 4, axisRight = 64, axisBottom = 20, gap = 6;
    this.padL = padLeft; this.axisR = axisRight;
    this.plotW = this.cssW - axisRight - padLeft;
    const panes = [{ id: 'price', w: 3.2 }];
    this._paneInds().forEach(function (p) { panes.push({ id: p.inst.id, w: p.def.weight || 1, ind: p }); });
    const plotH = this.cssH - padTop - axisBottom - gap * (panes.length - 1);
    let totW = 0; panes.forEach(function (p) { totW += p.w; });
    let y = padTop;
    this.panes = {}; this.paneList = [];
    for (let i = 0; i < panes.length; i++) {
      const ph = plotH * panes[i].w / totW;
      const P = { id: panes[i].id, x: padLeft, y: y, w: this.plotW, h: ph, ind: panes[i].ind };
      this.panes[panes[i].id] = P; this.paneList.push(P);
      y += ph + gap;
    }
    this.bottomY = y - gap;
  };

  // ---- scales -----------------------------------------------------------------
  PriceChart.prototype._f = function (v) { return this.cfg.scale === 'log' ? Math.log(Math.max(v, 1e-9)) : v; };
  PriceChart.prototype._finv = function (f) { return this.cfg.scale === 'log' ? Math.exp(f) : f; };
  PriceChart.prototype._computeScales = function () {
    const n = this.i1 - this.i0;
    this.padBars = this.i1 === this.bars.length ? Math.max(4, Math.round(n * (this.strat ? 0.12 : 0.06))) : 0;
    this.slotW = this.plotW / Math.max(1, n + this.padBars);
    this.candleW = Math.max(1, Math.floor(this.slotW * 0.7));
    if (this.candleW % 2 === 0) this.candleW = Math.max(1, this.candleW - 1);
    let lo = Infinity, hi = -Infinity;
    const D = this.disp, self = this;
    for (let i = this.i0; i < this.i1; i++) { const b = D[i]; if (!b) continue; const h = b.h != null ? b.h : b.c, l = b.l != null ? b.l : b.c; if (l < lo) lo = l; if (h > hi) hi = h; }
    const consider = function (v) { if (v != null && isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; } };
    (this.indOut || []).forEach(function (x) { if (x.def.pane) return; x.out.lines.forEach(function (l) { for (let i = self.i0; i < self.i1; i++) consider(l.data[i]); }); });
    if (this.strat) {
      // strategy averages close to price shape the scale; far-away long averages (200-day) do not
      this.strat.lines.forEach(function (l) { if (/200|150/.test(l.key)) return; for (let i = self.i0; i < self.i1; i++) consider(l.data[i]); });
      if (this.i1 === this.bars.length) { const g = this.strat.stage; if ((g.code === 'setup' || g.code === 'signal') && g.trig != null) { consider(g.trig); consider(g.stop); } if (this.strat.open && this.strat.open.stop) consider(this.strat.open.stop); }
    }
    if (!isFinite(lo) || !isFinite(hi)) { lo = 0; hi = 1; }
    if (this.cfg.scale === 'log' && lo <= 0) lo = Math.max(hi * 1e-3, 1e-6);
    let fLo = this._f(lo), fHi = this._f(hi);
    const span = (fHi - fLo) || (Math.abs(fHi) || 1) * 0.02;
    fLo -= span * 0.08; fHi += span * 0.08;
    if (this.yManual) { fLo = this.yManual.lo; fHi = this.yManual.hi; }
    this.fLo = fLo; this.fHi = fHi;
    this.yLo = this._finv(fLo); this.yHi = this._finv(fHi);
    this.priceK = this.panes.price.h / ((fHi - fLo) || 1);
    this.pctBase = this.bars[this.i0] ? this.bars[this.i0].c : null;
  };
  PriceChart.prototype.xFromIndex = function (i) { return this.padL + (i - this.i0 + 0.5) * this.slotW; };
  PriceChart.prototype.yPrice = function (v) { return this.panes.price.y + (this.fHi - this._f(v)) * this.priceK; };
  PriceChart.prototype.invYPrice = function (py) { return this._finv(this.fHi - (py - this.panes.price.y) / this.priceK); };
  PriceChart.prototype.indexAt = function (px) { return clamp(this.i0 + Math.floor((px - this.padL) / this.slotW), this.i0, this.i1 - 1); };
  PriceChart.prototype._step = function () {
    const b = this.bars, n = b.length;
    if (n < 2) return 86400000;
    const steps = [];
    for (let i = Math.max(1, n - 20); i < n; i++) steps.push(b[i].t - b[i - 1].t);
    steps.sort(function (a, c) { return a - c; });
    return steps[steps.length >> 1] || 86400000;
  };
  // fractional bar index of a timestamp (extrapolated outside the data)
  PriceChart.prototype.idxOfTime = function (t) {
    const b = this.bars, n = b.length;
    if (!n) return 0;
    if (t <= b[0].t) return (t - b[0].t) / this._step();
    if (t >= b[n - 1].t) return (n - 1) + (t - b[n - 1].t) / this._step();
    let lo = 0, hi = n - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (b[mid].t <= t) lo = mid; else hi = mid - 1; }
    return lo + (t - b[lo].t) / ((b[lo + 1].t - b[lo].t) || 1);
  };
  PriceChart.prototype.timeAtIdx = function (k) {
    const b = this.bars, n = b.length;
    if (!n) return 0;
    if (k >= 0 && k < n) return b[k].t;
    return k < 0 ? b[0].t + k * this._step() : b[n - 1].t + (k - n + 1) * this._step();
  };
  PriceChart.prototype.xFromTime = function (t) { return this.xFromIndex(this.idxOfTime(t)); };
  // chart coordinates -> drawing point {t, p}, snapped to bars (+ magnet)
  PriceChart.prototype._pointAt = function (x, y) {
    const k = Math.round(this.i0 + (x - this.padL) / this.slotW - 0.5);
    let p = this.invYPrice(y);
    if (this.cfg.magnet && k >= 0 && k < this.bars.length) {
      const b = this.bars[k], self = this;
      let best = p, bd = Infinity;
      [b.o, b.h, b.l, b.c].forEach(function (v) { if (v == null) return; const d = Math.abs(self.yPrice(v) - y); if (d < bd) { bd = d; best = v; } });
      if (bd < 40) p = best;
    }
    return { t: this.timeAtIdx(k), p: p };
  };

  // =========================================================================
  //  STATIC RENDER
  // =========================================================================
  PriceChart.prototype.requestRender = function () {
    if (this._rsOn) return;
    this._rsOn = true;
    const self = this;
    const run = function () {
      if (!self._rsOn) return;
      self._rsOn = false;
      cancelAnimationFrame(self._rsRaf); clearTimeout(self._rsTimer);
      self.render();
    };
    this._rsRaf = requestAnimationFrame(run);
    this._rsTimer = setTimeout(run, 33);
  };
  PriceChart.prototype.requestOverlay = function () {
    if (this._roOn) return;
    this._roOn = true;
    const self = this;
    const run = function () {
      if (!self._roOn) return;
      self._roOn = false;
      cancelAnimationFrame(self._roRaf); clearTimeout(self._roTimer);
      self.drawOverlay();
    };
    this._roRaf = requestAnimationFrame(run);
    this._roTimer = setTimeout(run, 33);
  };

  PriceChart.prototype._theme = function () {
    const cs = getComputedStyle(this.root);
    const g = function (n, fb) { const v = cs.getPropertyValue(n).trim(); return v || fb; };
    this.UP = g('--up', '#2ec27e'); this.DN = g('--down', '#ff4d4d');
    this.GRID = g('--border', '#1c2128'); this.GRID2 = g('--border-2', '#2a323d');
    this.AXIS = g('--muted', '#7b8794'); this.DIM = g('--dim', '#4b5563'); this.TXT = g('--text', '#d7dde3');
    this.AMBER = g('--amber', '#ff9e16'); this.CYAN = g('--cyan', '#38bdf8'); this.BG = g('--bg', '#06080c');
    this.fontFamily = cs.getPropertyValue('font-family') || 'monospace';
    this.font = '10px ' + this.fontFamily;
  };

  PriceChart.prototype.render = function () {
    if (!this.ctx || !this.cssW) return;
    this._theme(); this._layout();
    const c = this.ctx;
    c.clearRect(0, 0, this.cssW, this.cssH);
    if (!this.bars.length) { this.fHi = null; this._renderPaneLegends(); this.drawOverlay(); return; }
    // keep the visible window inside the data (replay and refreshes can shrink it)
    const n = this.bars.length;
    if (this.i1 > n || this.i1 < 1 || this.i0 >= this.i1) { const span = Math.max(this._minBars(), (this.i1 - this.i0) || 150); this.i1 = n; this.i0 = Math.max(0, n - span); }
    this._computeScales();
    c.font = this.font; c.textBaseline = 'middle';
    this._drawGrid();
    this._drawTimeAxis();
    this._drawPrice();
    const self = this;
    this.paneList.forEach(function (P) { if (P.ind) self._drawPane(P); });
    this._dirtyStatic = false;
    this._renderPaneLegends();
    this.drawOverlay();
  };

  PriceChart.prototype._axisLabel = function (v, dec) {
    if (this.cfg.pct && this.pctBase) { const p = (v / this.pctBase - 1) * 100; return (p >= 0 ? '+' : '') + p.toFixed(Math.abs(p) < 10 ? 2 : 1) + '%'; }
    return fmtPrice(v, dec);
  };
  PriceChart.prototype._drawGrid = function () {
    const c = this.ctx, P = this.panes.price;
    c.strokeStyle = this.GRID; c.lineWidth = 1; c.fillStyle = this.AXIS; c.textAlign = 'left';
    const ticks = [];
    let dec;
    if (this.cfg.scale === 'log') {
      for (let k = 0; k <= 8; k++) {
        const v = this._finv(this.fLo + (this.fHi - this.fLo) * k / 8);
        const mag = Math.pow(10, Math.floor(Math.log10(v)) - 1);
        ticks.push(Math.round(v / mag) * mag);
      }
    } else {
      const step = niceStep(this.yHi - this.yLo, 7);
      for (let v = Math.ceil(this.yLo / step) * step; v <= this.yHi; v += step) ticks.push(v);
      dec = decimalsFor(step);
    }
    let lastY = Infinity;
    for (let i = 0; i < ticks.length; i++) {
      const y = Math.round(this.yPrice(ticks[i])) + 0.5;
      if (y < P.y - 1 || y > P.y + P.h + 1 || Math.abs(lastY - y) < 16) continue;
      lastY = y;
      c.beginPath(); c.moveTo(P.x, y); c.lineTo(P.x + P.w, y); c.stroke();
      c.fillText(this._axisLabel(ticks[i], dec), P.x + P.w + 5, y);
    }
  };
  PriceChart.prototype._drawLastPrice = function () {
    const c = this.ctx, P = this.panes.price;
    const lb = this.bars[this.bars.length - 1], last = lb && lb.c;
    if (last == null) return;
    const y = Math.round(this.yPrice(last)) + 0.5;
    if (y < P.y || y > P.y + P.h) return;
    const prev = this.bars[this.bars.length - 2], up = prev ? last >= prev.c : true;
    c.strokeStyle = up ? this.UP : this.DN; c.setLineDash([2, 2]); c.lineWidth = 1;
    c.beginPath(); c.moveTo(P.x, y); c.lineTo(P.x + P.w, y); c.stroke(); c.setLineDash([]);
    c.fillStyle = up ? this.UP : this.DN;
    c.fillRect(P.x + P.w + 1, y - 7, this.axisR - 2, 14);
    c.fillStyle = '#040608'; c.textAlign = 'left';
    c.fillText(this._axisLabel(last), P.x + P.w + 5, y);
  };

  PriceChart.prototype._drawPrice = function () {
    const c = this.ctx, P = this.panes.price, self = this;
    c.save();
    c.beginPath(); c.rect(P.x, P.y, P.w, P.h); c.clip();
    (this.indOut || []).forEach(function (x) { if (!x.def.pane && x.out.fill) self._drawFill(x); });
    const t = this.cfg.chartType;
    if (t === 'line' || t === 'area' || this.slotW < 2.2) this._drawLineArea(t === 'area');
    else if (t === 'bars') this._drawOHLC();
    else this._drawCandles(t === 'hollow');
    (this.indOut || []).forEach(function (x) {
      if (x.def.pane) return;
      x.out.lines.forEach(function (l) {
        if (l.dirs) self._polylineDir(l.data, l.dirs, l.width || 1.4);
        else self._polyline(l.data, l.color || x.inst.color, l.width || 1.25, l.dash);
      });
    });
    if (this.strat) this._drawStrategy();
    c.restore();
    this._drawLastPrice();
  };

  PriceChart.prototype._drawCandles = function (hollow) {
    const c = this.ctx, D = this.disp, cw = this.candleW, half = cw / 2;
    c.lineWidth = 1;
    for (let i = this.i0; i < this.i1; i++) {
      const b = D[i];
      const o = b.o != null ? b.o : b.c, cl = b.c, hh = b.h != null ? b.h : Math.max(o, cl), ll = b.l != null ? b.l : Math.min(o, cl);
      const up = cl >= o, col = up ? this.UP : this.DN, cx = Math.round(this.xFromIndex(i)) + 0.5;
      const yo = this.yPrice(o), yc = this.yPrice(cl), top = Math.min(yo, yc), h = Math.max(1, Math.abs(yo - yc));
      c.strokeStyle = col;
      c.beginPath(); c.moveTo(cx, this.yPrice(hh)); c.lineTo(cx, top); c.moveTo(cx, top + h); c.lineTo(cx, this.yPrice(ll)); c.stroke();
      if (hollow && up && cw > 2) c.strokeRect(Math.round(cx - half) + 0.5, Math.round(top) + 0.5, cw - 1, Math.max(1, Math.round(h) - 1));
      else { c.fillStyle = col; c.fillRect(Math.round(cx - half), Math.round(top), cw, Math.max(1, Math.round(h))); }
    }
  };
  PriceChart.prototype._drawOHLC = function () {
    const c = this.ctx, D = this.disp, tick = Math.max(2, Math.floor(this.candleW / 2));
    c.lineWidth = 1;
    for (let i = this.i0; i < this.i1; i++) {
      const b = D[i], o = b.o != null ? b.o : b.c, cx = Math.round(this.xFromIndex(i)) + 0.5;
      const yo = Math.round(this.yPrice(o)) + 0.5, yc = Math.round(this.yPrice(b.c)) + 0.5;
      c.strokeStyle = b.c >= o ? this.UP : this.DN;
      c.beginPath();
      c.moveTo(cx, this.yPrice(b.h != null ? b.h : b.c)); c.lineTo(cx, this.yPrice(b.l != null ? b.l : b.c));
      c.moveTo(cx - tick, yo); c.lineTo(cx, yo); c.moveTo(cx, yc); c.lineTo(cx + tick, yc);
      c.stroke();
    }
  };
  PriceChart.prototype._drawLineArea = function (area) {
    const c = this.ctx, P = this.panes.price, D = this.disp, self = this;
    const first = D[this.i0].c, last = D[this.i1 - 1].c, col = last >= first ? this.UP : this.DN;
    const path = function () { c.beginPath(); for (let i = self.i0; i < self.i1; i++) { const x = self.xFromIndex(i), y = self.yPrice(D[i].c); if (i === self.i0) c.moveTo(x, y); else c.lineTo(x, y); } };
    if (area) {
      path();
      c.lineTo(this.xFromIndex(this.i1 - 1), P.y + P.h); c.lineTo(this.xFromIndex(this.i0), P.y + P.h); c.closePath();
      const grad = c.createLinearGradient(0, P.y, 0, P.y + P.h);
      grad.addColorStop(0, this._rgba(col, 0.28)); grad.addColorStop(1, this._rgba(col, 0));
      c.fillStyle = grad; c.fill();
    }
    path();
    c.lineWidth = 1.5; c.strokeStyle = col; c.stroke();
  };
  PriceChart.prototype._polyline = function (data, color, width, dash, yFn) {
    const c = this.ctx, y = yFn || this.yPrice.bind(this);
    c.beginPath(); c.lineWidth = width || 1.2; c.strokeStyle = color; c.setLineDash(dash ? [4, 3] : []);
    let started = false;
    for (let i = this.i0; i < this.i1; i++) {
      const v = data[i]; if (v == null || !isFinite(v)) { started = false; continue; }
      const x = this.xFromIndex(i), yy = y(v);
      if (!started) { c.moveTo(x, yy); started = true; } else c.lineTo(x, yy);
    }
    c.stroke(); c.setLineDash([]);
  };
  PriceChart.prototype._polylineDir = function (data, dirs, width) {
    const c = this.ctx;
    c.lineWidth = width;
    for (let i = Math.max(this.i0 + 1, 1); i < this.i1; i++) {
      if (data[i] == null || data[i - 1] == null || dirs[i] !== dirs[i - 1]) continue;
      c.strokeStyle = dirs[i] > 0 ? this.UP : this.DN;
      c.beginPath(); c.moveTo(this.xFromIndex(i - 1), this.yPrice(data[i - 1])); c.lineTo(this.xFromIndex(i), this.yPrice(data[i])); c.stroke();
    }
  };
  PriceChart.prototype._drawFill = function (x) {
    const c = this.ctx, up = x.out.lines[x.out.fill[0]].data, dn = x.out.lines[x.out.fill[1]].data;
    c.beginPath();
    let st = false;
    for (let i = this.i0; i < this.i1; i++) { if (up[i] == null) continue; const xx = this.xFromIndex(i), y = this.yPrice(up[i]); if (!st) { c.moveTo(xx, y); st = true; } else c.lineTo(xx, y); }
    if (!st) return;
    for (let i = this.i1 - 1; i >= this.i0; i--) { if (dn[i] == null) continue; c.lineTo(this.xFromIndex(i), this.yPrice(dn[i])); }
    c.closePath(); c.fillStyle = this._rgba(x.inst.color, 0.07); c.fill();
  };

  // generic sub-pane
  PriceChart.prototype._drawPane = function (P) {
    const c = this.ctx, x = P.ind, out = x.out, self = this;
    c.save();
    c.strokeStyle = this.GRID2; c.lineWidth = 1;
    c.beginPath(); c.moveTo(P.x, Math.round(P.y) - 2.5); c.lineTo(P.x + P.w + this.axisR, Math.round(P.y) - 2.5); c.stroke();
    let lo = Infinity, hi = -Infinity;
    const consider = function (v) { if (v != null && isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; } };
    if (out.range) { lo = out.range[0]; hi = out.range[1]; }
    else {
      if (out.volume) for (let i = this.i0; i < this.i1; i++) consider(this.bars[i].v);
      if (out.hist) for (let i = this.i0; i < this.i1; i++) consider(out.hist[i]);
      out.lines.forEach(function (l) { for (let i = self.i0; i < self.i1; i++) consider(l.data[i]); });
      if (out.levels) out.levels.forEach(consider);
      if (!isFinite(lo)) { lo = 0; hi = 1; }
      if (out.volume) lo = 0;
      const sp = (hi - lo) || 1; if (!out.volume) lo -= sp * 0.06; hi += sp * 0.06;
    }
    const y = function (v) { return P.y + P.h * (1 - (v - lo) / ((hi - lo) || 1)); };
    P.lo = lo; P.hi = hi;
    c.beginPath(); c.rect(P.x, P.y, P.w, P.h); c.clip();
    if (out.levels) {
      c.strokeStyle = this.GRID2; c.setLineDash([3, 3]);
      out.levels.forEach(function (lv) { const yy = Math.round(y(lv)) + 0.5; c.beginPath(); c.moveTo(P.x, yy); c.lineTo(P.x + P.w, yy); c.stroke(); });
      c.setLineDash([]);
    }
    const w = Math.max(1, this.candleW);
    if (out.volume) {
      for (let i = this.i0; i < this.i1; i++) {
        const b = this.bars[i]; if (b.v == null) continue;
        const prev = this.bars[i - 1], up = b.o != null ? b.c >= b.o : (!prev || b.c >= prev.c), yy = y(b.v);
        c.fillStyle = this._rgba(up ? this.UP : this.DN, 0.45);
        c.fillRect(Math.round(this.xFromIndex(i) - w / 2), Math.round(yy), w, Math.round(P.y + P.h - yy));
      }
    }
    if (out.hist) {
      const z = y(0);
      for (let i = this.i0; i < this.i1; i++) {
        const h = out.hist[i]; if (h == null) continue;
        const yy = y(h);
        c.fillStyle = this._rgba(h >= 0 ? this.UP : this.DN, 0.5);
        c.fillRect(Math.round(this.xFromIndex(i) - w / 2), Math.min(yy, z), w, Math.max(1, Math.abs(yy - z)));
      }
    }
    out.lines.forEach(function (l) { self._polyline(l.data, l.color || x.inst.color, l.width || 1.2, l.dash, y); });
    c.restore();
    c.fillStyle = this.DIM; c.textAlign = 'left'; c.textBaseline = 'middle';
    const labels = out.range ? (out.levels || []) : [hi - (hi - lo) * 0.12, lo + (hi - lo) * 0.12];
    labels.forEach(function (v) { const yy = y(v); if (yy > P.y + 4 && yy < P.y + P.h - 4) c.fillText(out.volume || Math.abs(v) >= 1e5 ? fmtVol(v) : fmtPrice(v, Math.abs(v) < 10 ? 2 : 1), P.x + P.w + 5, yy); });
  };

  PriceChart.prototype._drawTimeAxis = function () {
    const c = this.ctx, y = this.bottomY;
    c.strokeStyle = this.GRID; c.lineWidth = 1; c.beginPath(); c.moveTo(this.padL, y + 0.5); c.lineTo(this.padL + this.plotW, y + 0.5); c.stroke();
    c.textAlign = 'center'; c.textBaseline = 'top';
    const intraday = isIntraday(this.interval);
    const K = Math.max(1, Math.ceil(70 / this.slotW));
    let lastRight = -1e9, prevMonth = -1, prevYear = -1, prevDay = -1;
    for (let i = this.i0; i < this.i1; i += K) {
      const dt = new Date(this.bars[i].t);
      let label;
      if (intraday) { label = dt.getDate() !== prevDay ? MONTHS[dt.getMonth()] + ' ' + dt.getDate() : String(dt.getHours()).padStart(2, '0') + ':' + String(dt.getMinutes()).padStart(2, '0'); prevDay = dt.getDate(); }
      else if (this.interval === '1wk' || this.interval === '1mo') { label = dt.getFullYear() !== prevYear ? String(dt.getFullYear()) : MONTHS[dt.getMonth()]; prevYear = dt.getFullYear(); }
      else if (dt.getFullYear() !== prevYear) { label = String(dt.getFullYear()); prevYear = dt.getFullYear(); prevMonth = dt.getMonth(); }
      else if (dt.getMonth() !== prevMonth) { label = MONTHS[dt.getMonth()]; prevMonth = dt.getMonth(); }
      else label = MONTHS[dt.getMonth()] + ' ' + dt.getDate();
      const x = this.xFromIndex(i), halfW = c.measureText(label).width / 2;
      if (x - halfW < lastRight + 8 || x + halfW > this.padL + this.plotW) continue;
      c.strokeStyle = this._rgba(this.GRID, 0.7);
      c.beginPath(); c.moveTo(Math.round(x) + 0.5, this.panes.price.y); c.lineTo(Math.round(x) + 0.5, y); c.stroke();
      c.fillStyle = this.AXIS; c.fillText(label, x, y + 4);
      lastRight = x + halfW;
    }
    c.textBaseline = 'middle';
  };

  // ---- strategy layer ---------------------------------------------------------
  PriceChart.prototype._drawStrategy = function () {
    const c = this.ctx, a = this.strat, P = this.panes.price, self = this;
    (a.bands || []).forEach(function (bd) {
      c.beginPath(); let st = false;
      for (let i = self.i0; i < self.i1; i++) { if (bd.upper[i] == null) continue; const x = self.xFromIndex(i), y = self.yPrice(bd.upper[i]); if (!st) { c.moveTo(x, y); st = true; } else c.lineTo(x, y); }
      if (!st) return;
      for (let i = self.i1 - 1; i >= self.i0; i--) { if (bd.lower[i] == null) continue; c.lineTo(self.xFromIndex(i), self.yPrice(bd.lower[i])); }
      c.closePath(); c.fillStyle = self._rgba(bd.color, 0.10); c.fill();
    });
    a.lines.forEach(function (l) { self._polyline(l.data, l.color, l.width || 1.2, l.dash); });
    const vis = function (i) { return i != null && i >= self.i0 && i < self.i1; };
    if (a.kind === 'zones') { this._drawZones(a, vis); return; }
    c.fillStyle = this._rgba(ST_COL.setup, 0.75);
    a.setups.forEach(function (s) {
      const i = self._ci(s.i); if (!vis(i)) return;
      const x = self.xFromIndex(i), y = self.yPrice(self.bars[i].l) + 6;
      c.beginPath(); c.moveTo(x, y); c.lineTo(x - 3.5, y + 6); c.lineTo(x + 3.5, y + 6); c.closePath(); c.fill();
    });
    const drawTrade = function (t, ix, live) {
      const ie = self._ci(t.entryIdx);
      if (ix < self.i0 || ie >= self.i1) return;
      const x0 = self.xFromIndex(ie), x1 = self.xFromIndex(ix) + (live ? self.slotW * 0.5 : 0);
      c.lineWidth = 1;
      c.strokeStyle = self._rgba(self.DN, 0.85); c.beginPath(); c.moveTo(x0, self.yPrice(t.stop)); c.lineTo(x1, self.yPrice(t.stop)); c.stroke();
      if (t.target != null) { c.setLineDash([3, 3]); c.strokeStyle = self._rgba(self.UP, 0.8); c.beginPath(); c.moveTo(x0, self.yPrice(t.target)); c.lineTo(x1, self.yPrice(t.target)); c.stroke(); c.setLineDash([]); }
      c.strokeStyle = self._rgba(self.TXT, 0.5); c.beginPath(); c.moveTo(x0, self.yPrice(t.entry)); c.lineTo(x1, self.yPrice(t.entry)); c.stroke();
      if (vis(ie)) { const y = self.yPrice(t.entry); c.fillStyle = self.UP; c.beginPath(); c.moveTo(x0 - 5, y); c.lineTo(x0 - 11, y - 4); c.lineTo(x0 - 11, y + 4); c.closePath(); c.fill(); }
      t.exits.forEach(function (e) { const i = self._ci(e.i); if (!vis(i)) return; c.fillStyle = e.px >= t.entry ? self.UP : self.DN; c.beginPath(); c.arc(self.xFromIndex(i), self.yPrice(e.px), 3, 0, Math.PI * 2); c.fill(); });
      const pctMode = a.measure === 'pct', r = pctMode ? (live ? t.markPct : t.retPct) * 100 : (live ? t.markR : t.Rmult);
      c.font = self.font; c.textAlign = 'center'; c.textBaseline = 'bottom';
      c.fillStyle = self._rgba(r >= 0 ? self.UP : self.DN, live ? 1 : 0.7);
      let topP = t.entry; t.exits.forEach(function (e) { if (e.px > topP) topP = e.px; }); if (t.target != null && t.target > topP) topP = t.target;
      c.fillText((r >= 0 ? '+' : '') + r.toFixed(1) + (pctMode ? '%' : 'R') + (live ? ' open' : '') + (t.sameDayStop ? '?' : ''), (x0 + x1) / 2, self.yPrice(topP) - 8);
      c.textBaseline = 'middle';
    };
    a.trades.forEach(function (t) { drawTrade(t, self._ci(t.exitIdx), false); });
    if (a.open) drawTrade(a.open, this.bars.length - 1, true);
    const g = a.stage;
    if ((g.code === 'setup' || g.code === 'signal') && g.trig != null && this.i1 === this.bars.length) {
      const xe = P.x + P.w, xa = Math.min(this.xFromIndex(this.bars.length - 1) + this.slotW * 0.5, xe - 60);
      const band = function (p1, p2, col, al) { c.fillStyle = self._rgba(col, al); c.fillRect(xa, Math.min(self.yPrice(p1), self.yPrice(p2)), xe - xa, Math.abs(self.yPrice(p1) - self.yPrice(p2))); };
      band(g.trig, g.stop, this.DN, 0.12); if (g.t3 != null) band(g.trig, g.t3, this.UP, 0.07);
      const lvl = function (p, col, label, dash) {
        const y = Math.round(self.yPrice(p)) + 0.5;
        c.strokeStyle = col; c.lineWidth = 1.2; c.setLineDash(dash ? [4, 3] : []);
        c.beginPath(); c.moveTo(xa, y); c.lineTo(xe, y); c.stroke(); c.setLineDash([]);
        c.fillStyle = col; c.textAlign = 'right'; c.textBaseline = 'bottom'; c.fillText(label + ' ' + fmtPrice(p), xe - 3, y - 2); c.textBaseline = 'middle';
      };
      lvl(g.trig, this.AMBER, g.entryType === 'open' ? 'ENTER NEXT OPEN ≈' : 'TRIGGER >', false); lvl(g.stop, this.DN, 'STOP', false);
      if (g.t3 != null) lvl(g.t3, this.UP, '3R', true); if (g.t5 != null) lvl(g.t5, this.UP, '5R', true);
    }
  };
  // DCA zones: Fibonacci levels of the current 126-bar window + tranche markers.
  PriceChart.prototype._drawZones = function (a, vis) {
    const c = this.ctx, P = this.panes.price, self = this;
    if (a.fib) {
      const f = a.fib, i0 = this._ci(f.from), xs = Math.max(P.x, this.xFromIndex(i0 != null ? i0 : this.i0)), xe = P.x + P.w;
      c.fillStyle = 'rgba(8,153,129,0.14)';
      c.fillRect(xs, this.yPrice(f.zHi), xe - xs, this.yPrice(f.zLo) - this.yPrice(f.zHi));
      [[f.f236, '23.6%', [2, 3]], [f.f382, '38.2% add zone', []], [f.f50, '50%', [4, 3]], [f.guard, 'guard', [1, 2]], [f.f618, '61.8%', [2, 3]]].forEach(function (lv) {
        const y = Math.round(self.yPrice(lv[0])) + 0.5;
        c.strokeStyle = lv[1] === 'guard' ? self.DN : 'rgba(8,153,129,0.85)'; c.lineWidth = 1; c.setLineDash(lv[2]);
        c.beginPath(); c.moveTo(xs, y); c.lineTo(xe, y); c.stroke(); c.setLineDash([]);
        c.fillStyle = c.strokeStyle; c.textAlign = 'right'; c.textBaseline = 'bottom'; c.fillText('Fib ' + lv[1] + ' ' + fmtPrice(lv[0]), xe - 3, y - 2); c.textBaseline = 'middle';
      });
    }
    a.tranches.forEach(function (t) {
      const i = self._ci(t.i); if (!vis(i)) return;
      const x = self.xFromIndex(i), y = self.yPrice(self.bars[i].l) + 10;
      c.fillStyle = t.fwd == null ? self.AMBER : t.fwd > 0 ? self.UP : self.DN;
      c.beginPath(); c.moveTo(x, y - 4); c.lineTo(x + 4, y); c.lineTo(x, y + 4); c.lineTo(x - 4, y); c.closePath(); c.fill();
    });
  };

  // ---- legends ------------------------------------------------------------------
  PriceChart.prototype._renderPaneLegends = function () {
    const self = this;
    let html = '';
    (this.paneList || []).forEach(function (P) {
      if (!P.ind) return;
      const inst = P.ind.inst, def = P.ind.def;
      const params = def.params.map(function (p) { return inst.params[p[0]]; }).join(', ');
      html += '<div class="pc-pl" style="top:' + Math.round(P.y + 1) + 'px" data-id="' + esc(inst.id) + '"><span style="color:' + inst.color + '">' + esc(def.short || def.name) + (params ? ' ' + esc(params) : '') + '</span><span class="pc-plv"></span>' +
        '<button type="button" data-a="cfg" title="Settings">' + ICON.gear + '</button><button type="button" data-a="rm" title="Remove">' + ICON.close + '</button></div>';
    });
    this.paneLegends.innerHTML = html;
    this.paneLegends.onclick = function (e) {
      const b = e.target.closest('button'); if (!b) return;
      e.stopPropagation();
      const id = b.closest('.pc-pl').dataset.id, k = self.cfg.indicators.findIndex(function (i) { return i.id === id; });
      if (k < 0) return;
      if (b.dataset.a === 'rm') { self.cfg.indicators.splice(k, 1); self._cfgChanged(true); }
      else { self.menuKind = null; self._toggleIndMenu(); }
    };
  };

  PriceChart.prototype._updateLegend = function (i) {
    const b = this.disp[i] || this.bars[i]; if (!b) return;
    const o = b.o != null ? b.o : b.c, hh = b.h != null ? b.h : b.c, ll = b.l != null ? b.l : b.c, cl = b.c;
    const raw = this.bars[i], prev = i > 0 ? this.bars[i - 1].c : raw.c, chg = raw.c - prev, chgPct = prev ? chg / prev * 100 : 0;
    const cls = chg >= 0 ? 'up' : 'down', dec = decimalsFor(cl);
    let html = '<div><b class="pc-lsym">' + esc(this.symbol || '') + '</b> <span class="k">' + esc(this._tfLabel()) + (this.cfg.chartType === 'heikin' ? ' · HA' : '') + '</span>  ' +
      '<span class="k">O</span>' + fmtPrice(o, dec) + ' <span class="k">H</span>' + fmtPrice(hh, dec) + ' <span class="k">L</span>' + fmtPrice(ll, dec) +
      ' <span class="k">C</span><span class="' + cls + '">' + fmtPrice(cl, dec) + ' ' + (chg >= 0 ? '+' : '') + fmtPrice(chg, dec) + ' (' + (chgPct >= 0 ? '+' : '') + chgPct.toFixed(2) + '%)</span>' +
      (raw.v != null ? ' <span class="k">V</span>' + fmtVol(raw.v) : '') + '</div>';
    (this.indOut || []).forEach(function (x) {
      if (x.def.pane || !x.out.lines.length) return;
      const params = x.def.params.map(function (p) { return x.inst.params[p[0]]; }).join(' ');
      html += '<div><span style="color:' + x.inst.color + '">' + esc(x.def.short || x.def.name) + ' ' + esc(params) + '</span> ' +
        x.out.lines.map(function (l) { const v = l.data[i]; return v == null ? '—' : fmtPrice(v, dec); }).join(' ') + '</div>';
    });
    if (this.strat) {
      html += '<div><span class="k">◆ ' + esc(this.strat.short) + '</span> ' + this.strat.lines.map(function (l) { return '<span style="color:' + l.color + '">' + esc(l.key) + ' ' + fmtPrice(l.data[i], dec) + '</span>'; }).join(' ') + '</div>';
    }
    if (html !== this._legendHtml) { this.legend.innerHTML = html; this._legendHtml = html; }
    this.legend.style.display = 'block';
    const self = this;
    this.paneLegends.querySelectorAll('.pc-pl').forEach(function (el) {
      const P = self.panes[el.dataset.id]; if (!P) return;
      const out = P.ind.out, vals = [];
      if (out.volume && self.bars[i].v != null) vals.push(fmtVol(self.bars[i].v));
      out.lines.forEach(function (l) { const v = l.data[i]; vals.push(v == null ? '—' : Math.abs(v) >= 1e5 ? fmtVol(v) : fmtPrice(v, 2)); });
      if (out.hist && out.hist[i] != null) vals.push(fmtPrice(out.hist[i], 2));
      el.querySelector('.pc-plv').textContent = ' ' + vals.join('  ');
    });
  };
  PriceChart.prototype._tfLabel = function () { const iv = this.interval, t = TIMEFRAMES.find(function (x) { return x[0] === iv; }); return t ? t[1] : iv; };

  // =========================================================================
  //  OVERLAY RENDER (drawings, crosshair, pending tool)
  // =========================================================================
  PriceChart.prototype.drawOverlay = function () {
    if (!this.octx || !this.cssW) return;
    const c = this.octx;
    c.clearRect(0, 0, this.cssW, this.cssH);
    if (!this.bars.length || !this.panes || !this.panes.price || this.fHi == null) { this.legend.style.display = 'none'; return; }
    c.font = this.font || '10px monospace';
    // In replay, drawings anchored after the replay bar would reveal the future: hide them.
    const cutoff = this.replay.active ? this.bars[this.bars.length - 1].t : Infinity;
    const visible = function (d) { return !d.hidden && (d.type === 'hline' || Math.min.apply(null, d.pts.map(function (p) { return p.t; })) <= cutoff); };
    this._visibleDrawing = visible;
    if (!this.hideAll) for (let k = 0; k < this.drawings.length; k++) if (visible(this.drawings[k])) this._drawOne(c, this.drawings[k], k === this.sel, false);
    if (this.pending) this._drawOne(c, this._pendingDrawing(), true, true);
    if (this.replay.picking && this.inside) this._drawReplayPick(c);
    if (this.inside && !(this.drag && this.drag.kind === 'pan') && this.mx >= 0) this._drawCrosshair(c);
    const li = this.inside && this.hoverIdx >= 0 ? this.hoverIdx : this.bars.length - 1;
    this._updateLegend(clamp(li, 0, this.bars.length - 1));
    this._positionStyleBar();
  };

  PriceChart.prototype._drawCrosshair = function (c) {
    const P = this.panes.price, top = P.y, bot = this.bottomY;
    const inPlot = this.mx >= this.padL && this.mx <= this.padL + this.plotW;
    const k = Math.round(this.i0 + (this.mx - this.padL) / this.slotW - 0.5);
    const cx = Math.round(this.xFromIndex(k)) + 0.5, self = this;
    c.save();
    c.strokeStyle = this.AXIS; c.lineWidth = 1; c.setLineDash([3, 3]);
    if (inPlot) { c.beginPath(); c.moveTo(cx, top); c.lineTo(cx, bot); c.stroke(); }
    if (this.my >= top && this.my <= bot && inPlot) { const hy = Math.round(this.my) + 0.5; c.beginPath(); c.moveTo(this.padL, hy); c.lineTo(this.padL + this.plotW, hy); c.stroke(); }
    c.setLineDash([]);
    c.textAlign = 'left'; c.textBaseline = 'middle';
    const tag = function (Q, txt) { c.fillStyle = self.GRID2; c.fillRect(Q.x + Q.w + 1, self.my - 7, self.axisR - 2, 14); c.fillStyle = self.AMBER; c.fillText(txt, Q.x + Q.w + 5, self.my); };
    if (this.my >= P.y && this.my <= P.y + P.h) tag(P, this._axisLabel(this.cfg.magnet && inPlot ? this._pointAt(this.mx, this.my).p : this.invYPrice(this.my)));
    else (this.paneList || []).forEach(function (Q) {
      if (!Q.ind || self.my < Q.y || self.my > Q.y + Q.h || Q.hi == null) return;
      const v = Q.hi - (self.my - Q.y) / Q.h * (Q.hi - Q.lo);
      tag(Q, Q.ind.out.volume || Math.abs(v) >= 1e5 ? fmtVol(v) : fmtPrice(v, 2));
    });
    if (inPlot) {
      const dl = fmtDate(this.timeAtIdx(k), isIntraday(this.interval));
      c.textAlign = 'center';
      const wTag = c.measureText(dl).width + 10, tagX = clamp(cx - wTag / 2, this.padL, this.padL + this.plotW - wTag);
      c.fillStyle = this.GRID2; c.fillRect(tagX, bot + 2, wTag, 14);
      c.fillStyle = this.AMBER; c.fillText(dl, tagX + wTag / 2, bot + 9);
    }
    c.restore();
  };

  PriceChart.prototype._drawReplayPick = function (c) {
    const x = Math.round(this.mx) + 0.5, P = this.panes.price;
    c.save();
    c.fillStyle = 'rgba(41,98,255,0.10)'; c.fillRect(x, P.y, this.padL + this.plotW - x, this.bottomY - P.y);
    c.strokeStyle = '#2962ff'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(x, P.y); c.lineTo(x, this.bottomY); c.stroke();
    c.fillStyle = '#5b8cff'; c.textAlign = 'left'; c.fillText('Click to start replay from here', x + 6, P.y + 12);
    c.restore();
  };

  // ---- drawings: geometry + render ------------------------------------------------
  PriceChart.prototype._pendingDrawing = function () {
    const pd = this.pending, pts = pd.pts.slice();
    if (pd.hover && pts.length < TOOLS[pd.type].n) pts.push(pd.hover);
    return this._finalizeShape({ type: pd.type, pts: pts, style: pd.style });
  };
  // long/short store a 3rd (target) point; default 3R from entry/stop
  PriceChart.prototype._finalizeShape = function (d) {
    if ((d.type === 'long' || d.type === 'short') && d.pts.length === 2) {
      const e = d.pts[0], s = d.pts[1];
      d = Object.assign({}, d, { pts: [e, s, { t: s.t, p: e.p + 3 * (e.p - s.p) }] });
    }
    return d;
  };
  PriceChart.prototype._lineStyle = function (c, d, sel) {
    const st = d.style || {};
    c.strokeStyle = st.color || DEFAULT_COLOR[d.type] || '#2962ff';
    c.lineWidth = (st.width || 1) + (sel ? 0.6 : 0);
    c.setLineDash(st.dash === 'dash' ? [6, 4] : st.dash === 'dot' ? [1.5, 3] : []);
  };
  // extend segment a->b to the plot edges (both directions, or forward only)
  PriceChart.prototype._extend = function (ax, ay, bx, by, both) {
    const P = this.panes.price, x0 = P.x, x1 = P.x + P.w;
    if (Math.abs(bx - ax) < 1e-6) return both ? [ax, P.y, ax, P.y + P.h] : [ax, ay, bx, by > ay ? P.y + P.h : P.y];
    const m = (by - ay) / (bx - ax), fx = bx >= ax ? x1 : x0;
    if (!both) return [ax, ay, fx, ay + m * (fx - ax)];
    const sx = bx >= ax ? x0 : x1;
    return [sx, ay + m * (sx - ax), fx, ay + m * (fx - ax)];
  };
  PriceChart.prototype._channelOffset = function (pts) {
    const i0 = this.idxOfTime(pts[0].t), i1 = this.idxOfTime(pts[1].t), i2 = this.idxOfTime(pts[2].t);
    const slope = (pts[1].p - pts[0].p) / ((i1 - i0) || 1);
    return pts[2].p - (pts[0].p + slope * (i2 - i0));
  };

  PriceChart.prototype._drawOne = function (c, d, sel, preview) {
    const P = this.panes.price, self = this;
    const X = function (pt) { return self.xFromTime(pt.t); }, Y = function (pt) { return self.yPrice(pt.p); };
    const pts = d.pts, col = (d.style && d.style.color) || DEFAULT_COLOR[d.type] || '#2962ff';
    c.save();
    c.beginPath(); c.rect(P.x, P.y, P.w, (d.type === 'vline' ? this.bottomY : P.y + P.h) - P.y); c.clip();
    this._lineStyle(c, d, sel);
    c.font = this.font; c.textBaseline = 'middle';
    const seg = function (a, b) { c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke(); };
    switch (d.type) {
      case 'trend': if (pts[1]) seg([X(pts[0]), Y(pts[0])], [X(pts[1]), Y(pts[1])]); break;
      case 'ray': case 'ext': if (pts[1]) { const e = this._extend(X(pts[0]), Y(pts[0]), X(pts[1]), Y(pts[1]), d.type === 'ext'); seg([e[0], e[1]], [e[2], e[3]]); } break;
      case 'hline': { const y = Y(pts[0]); seg([P.x, y], [P.x + P.w, y]); c.setLineDash([]); c.fillStyle = col; c.textAlign = 'left'; c.fillText(fmtPrice(pts[0].p), P.x + 4, y - 7); break; }
      case 'hray': { const y = Y(pts[0]); seg([X(pts[0]), y], [P.x + P.w, y]); c.setLineDash([]); c.fillStyle = col; c.textAlign = 'right'; c.fillText(fmtPrice(pts[0].p), P.x + P.w - 4, y - 7); break; }
      case 'vline': { const x = X(pts[0]); seg([x, P.y], [x, this.bottomY]); break; }
      case 'channel': {
        if (!pts[1]) break;
        const a = [X(pts[0]), Y(pts[0])], b = [X(pts[1]), Y(pts[1])];
        seg(a, b);
        if (pts[2]) {
          const off = this._channelOffset(pts);
          const a2 = [a[0], this.yPrice(pts[0].p + off)], b2 = [b[0], this.yPrice(pts[1].p + off)];
          seg(a2, b2);
          c.setLineDash([3, 3]); seg([a[0], this.yPrice(pts[0].p + off / 2)], [b[0], this.yPrice(pts[1].p + off / 2)]); c.setLineDash([]);
          c.fillStyle = this._rgba(col, 0.08);
          c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.lineTo(b2[0], b2[1]); c.lineTo(a2[0], a2[1]); c.closePath(); c.fill();
        }
        break;
      }
      case 'rect': {
        if (!pts[1]) break;
        const x0 = X(pts[0]), y0 = Y(pts[0]), x1 = X(pts[1]), y1 = Y(pts[1]);
        c.fillStyle = this._rgba(col, 0.12); c.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
        c.strokeRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
        break;
      }
      case 'fib': if (pts[1]) this._drawFibLevels(c, d, FIB_LEVELS, pts[1].p, pts[0].p - pts[1].p, Math.min(X(pts[0]), X(pts[1]))); break;
      case 'fibext': {
        if (!pts[1]) break;
        seg([X(pts[0]), Y(pts[0])], [X(pts[1]), Y(pts[1])]);
        if (pts[2]) { seg([X(pts[1]), Y(pts[1])], [X(pts[2]), Y(pts[2])]); this._drawFibLevels(c, d, FIBEXT_LEVELS, pts[2].p, pts[1].p - pts[0].p, X(pts[2])); }
        break;
      }
      case 'text': {
        const x = X(pts[0]), y = Y(pts[0]), lines = (d.text || 'Text').split('\n');
        c.font = 'bold 12px ' + this.fontFamily;
        const w = Math.max.apply(null, lines.map(function (l) { return c.measureText(l).width; })) + 10;
        c.fillStyle = 'rgba(0,0,0,0.55)'; c.fillRect(x, y - 9, w, lines.length * 15 + 4);
        c.fillStyle = col; c.textAlign = 'left';
        lines.forEach(function (l, k) { c.fillText(l, x + 5, y + k * 15); });
        if (sel) { c.setLineDash([2, 2]); c.strokeRect(x, y - 9, w, lines.length * 15 + 4); }
        break;
      }
      case 'arrowup': case 'arrowdn': {
        const x = X(pts[0]), y = Y(pts[0]), s = d.type === 'arrowup' ? 1 : -1;
        c.fillStyle = col; c.beginPath();
        c.moveTo(x, y); c.lineTo(x - 7, y + s * 10); c.lineTo(x - 3, y + s * 10); c.lineTo(x - 3, y + s * 20); c.lineTo(x + 3, y + s * 20); c.lineTo(x + 3, y + s * 10); c.lineTo(x + 7, y + s * 10); c.closePath(); c.fill();
        if (d.text) { c.textAlign = 'center'; c.fillText(d.text, x, y + s * 28); }
        break;
      }
      case 'long': case 'short': this._drawPosition(c, d); break;
      case 'measure': this._drawMeasure(c, d); break;
      case 'avwap': this._drawAvwap(c, d); break;
    }
    c.setLineDash([]);
    c.restore();
    if (sel && !preview) this._drawHandles(c, d);
  };

  PriceChart.prototype._drawFibLevels = function (c, d, levels, base, span, xStart) {
    const P = this.panes.price, x1 = P.x + P.w, self = this, st = d.style || {};
    const custom = st.color && st.color !== DEFAULT_COLOR[d.type];
    let prevY = null;
    levels.forEach(function (lv, k) {
      const price = base + span * lv, y = self.yPrice(price), col = custom ? st.color : FIB_COLORS[k % FIB_COLORS.length];
      if (prevY != null) { c.fillStyle = self._rgba(col, 0.06); c.fillRect(xStart, Math.min(prevY, y), x1 - xStart, Math.abs(y - prevY)); }
      c.strokeStyle = col; c.lineWidth = st.width || 1; c.setLineDash([]);
      c.beginPath(); c.moveTo(xStart, y); c.lineTo(x1, y); c.stroke();
      c.fillStyle = col; c.textAlign = 'left'; c.fillText(String(lv) + ' (' + fmtPrice(price) + ')', xStart + 4, y - 6);
      prevY = y;
    });
  };

  PriceChart.prototype._posGeom = function (d) {
    const P = this.panes.price, xa = this.xFromTime(d.pts[0].t);
    const xb = Math.max(xa + 90, this.xFromTime(d.pts[1] ? d.pts[1].t : d.pts[0].t), d.pts[2] ? this.xFromTime(d.pts[2].t) : 0);
    return { xa: xa, xe: Math.min(xb, P.x + P.w) };
  };
  PriceChart.prototype._drawPosition = function (c, d) {
    const P = this.panes.price, self = this, pts = d.pts;
    const long = d.type === 'long', e = pts[0].p, s = pts[1] ? pts[1].p : e, t = pts[2] ? pts[2].p : e;
    const g = this._posGeom(d), xa = g.xa, xe = g.xe;
    const ye = this.yPrice(e), ys = this.yPrice(s), yt = this.yPrice(t);
    const valid = long ? s < e && t > e : s > e && t < e;
    c.fillStyle = this._rgba(this.DN, 0.18); c.fillRect(xa, Math.min(ye, ys), xe - xa, Math.abs(ys - ye));
    c.fillStyle = this._rgba(this.UP, 0.16); c.fillRect(xa, Math.min(ye, yt), xe - xa, Math.abs(yt - ye));
    c.setLineDash([]); c.lineWidth = 1;
    const hl = function (y, col) { c.strokeStyle = col; c.beginPath(); c.moveTo(xa, Math.round(y) + 0.5); c.lineTo(xe, Math.round(y) + 0.5); c.stroke(); };
    hl(ye, this.TXT); hl(ys, this.DN); hl(yt, this.UP);
    const risk = Math.abs(e - s), reward = Math.abs(t - e);
    // outcome: first later bar inside the box that touches the stop or the target
    let outcome = '';
    if (valid) {
      const iStart = Math.floor(this.idxOfTime(pts[0].t)) + 1;
      const iEnd = Math.min(this.bars.length - 1, Math.floor(this.i0 + (xe - this.padL) / this.slotW - 0.5));
      for (let i = Math.max(0, iStart); i <= iEnd; i++) {
        const b = this.bars[i], hitS = long ? b.l <= s : b.h >= s, hitT = long ? b.h >= t : b.l <= t;
        if (hitS && hitT) { outcome = 'Stop and target same bar ' + fmtDate(b.t); break; }
        if (hitS) { outcome = 'Stop hit ' + fmtDate(b.t); break; }
        if (hitT) { outcome = 'Target hit ' + fmtDate(b.t); break; }
      }
    }
    const z = window.FinStrategy && valid ? window.FinStrategy.size(Object.assign(this._sizerVals(), { entry: long ? e : s, stop: long ? s : e })) : null;
    const tag = function (y, txt, bg) {
      c.font = self.font; const w = c.measureText(txt).width + 10, x = clamp((xa + xe) / 2 - w / 2, P.x, P.x + P.w - w);
      c.fillStyle = bg; c.fillRect(x, y - 8, w, 15); c.fillStyle = '#fff'; c.textAlign = 'left'; c.fillText(txt, x + 5, y);
    };
    const tp = (t / e - 1) * 100, sp = (s / e - 1) * 100;
    tag(long ? yt - 10 : yt + 10, 'Target ' + fmtPrice(t) + ' (' + (tp >= 0 ? '+' : '') + tp.toFixed(2) + '%)', this._rgba(this.UP, 0.9));
    tag(long ? ys + 10 : ys - 10, 'Stop ' + fmtPrice(s) + ' (' + (sp >= 0 ? '+' : '') + sp.toFixed(2) + '%)', this._rgba(this.DN, 0.9));
    const shares = z && z.ok ? ' · ' + z.shares + ' sh · risk ' + fmtPrice(z.risk, 0) : '';
    tag(ye, (valid ? (long ? 'Long' : 'Short') + ' · R:R ' + (reward / risk).toFixed(2) : (long ? 'Long: stop below, target above entry' : 'Short: stop above, target below entry')) + shares + (outcome ? ' · ' + outcome : ''), 'rgba(40,46,58,0.92)');
  };

  PriceChart.prototype._drawMeasure = function (c, d) {
    const pts = d.pts; if (!pts[1]) return;
    const x0 = this.xFromTime(pts[0].t), x1 = this.xFromTime(pts[1].t), y0 = this.yPrice(pts[0].p), y1 = this.yPrice(pts[1].p);
    const up = pts[1].p >= pts[0].p, col = up ? '#2962ff' : '#f23645';
    c.fillStyle = this._rgba(col, 0.16); c.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
    c.strokeStyle = col; c.lineWidth = 1; c.setLineDash([]);
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    c.beginPath(); c.moveTo(mx, y0); c.lineTo(mx, y1); c.moveTo(x0, my); c.lineTo(x1, my); c.stroke();
    const dp = pts[1].p - pts[0].p, pc = dp / pts[0].p * 100, bars = Math.round(this.idxOfTime(pts[1].t) - this.idxOfTime(pts[0].t));
    const days = Math.round((pts[1].t - pts[0].t) / 86400000);
    const txt = (dp >= 0 ? '+' : '') + fmtPrice(dp) + ' (' + (pc >= 0 ? '+' : '') + pc.toFixed(2) + '%) · ' + bars + ' bars, ' + days + 'd';
    c.font = this.font; const w = c.measureText(txt).width + 12, ty = up ? Math.min(y0, y1) - 12 : Math.max(y0, y1) + 12;
    c.fillStyle = col; c.fillRect(mx - w / 2, ty - 8, w, 16); c.fillStyle = '#fff'; c.textAlign = 'center'; c.fillText(txt, mx, ty);
  };

  PriceChart.prototype._avwapData = function (d) {
    const i = Math.max(0, Math.round(this.idxOfTime(d.pts[0].t)));
    if (i >= this.bars.length) return null;
    if (!this._avCache || this._avCache.bars !== this.bars) this._avCache = { bars: this.bars, m: {} };
    if (!this._avCache.m[i]) this._avCache.m[i] = IND_LIB.anchoredVwap(this.bars, i);
    return { data: this._avCache.m[i], from: i };
  };
  PriceChart.prototype._drawAvwap = function (c, d) {
    const r = this._avwapData(d); if (!r) return;
    let st = false, lx = 0, ly = 0;
    c.beginPath();
    for (let i = Math.max(this.i0, r.from); i < this.i1; i++) {
      const v = r.data[i]; if (v == null) continue;
      const x = this.xFromIndex(i), y = this.yPrice(v);
      if (!st) { c.moveTo(x, y); st = true; } else c.lineTo(x, y);
      lx = x; ly = y;
    }
    c.stroke();
    if (st) { c.setLineDash([]); c.fillStyle = (d.style && d.style.color) || DEFAULT_COLOR.avwap; c.textAlign = 'right'; c.fillText('AVWAP ' + fmtPrice(r.data[this.i1 - 1]), lx - 2, ly - 8); }
  };

  // handle positions in screen coords
  PriceChart.prototype._handles = function (d) {
    const P = this.panes.price, self = this;
    if (d.type === 'hline') return [[P.x + P.w / 2, this.yPrice(d.pts[0].p)]];
    if (d.type === 'vline') return [[this.xFromTime(d.pts[0].t), P.y + P.h / 2]];
    if (d.type === 'avwap') { const r = this._avwapData(d); return r ? [[this.xFromIndex(r.from), this.yPrice(r.data[r.from])]] : []; }
    if (d.type === 'long' || d.type === 'short') {
      const g = this._posGeom(d);
      return [[g.xa, this.yPrice(d.pts[0].p)], [g.xa, this.yPrice(d.pts[1].p)], [g.xa, this.yPrice(d.pts[2].p)], [g.xe, this.yPrice(d.pts[0].p)]];
    }
    return d.pts.map(function (p) { return [self.xFromTime(p.t), self.yPrice(p.p)]; });
  };
  PriceChart.prototype._drawHandles = function (c, d) {
    const self = this;
    c.save();
    this._handles(d).forEach(function (h) {
      c.fillStyle = self.BG; c.strokeStyle = d.locked ? self.DIM : '#2962ff'; c.lineWidth = 1.5;
      c.beginPath(); c.arc(h[0], h[1], 4.5, 0, Math.PI * 2); c.fill(); c.stroke();
    });
    c.restore();
  };

  // hit test: returns {k, handle} (handle = point index, -1 for the body)
  PriceChart.prototype._hit = function (px, py) {
    if (this.hideAll) return null;
    const TH = 6, self = this;
    if (this.sel >= 0 && this.drawings[this.sel]) {
      const hs = this._handles(this.drawings[this.sel]);
      for (let j = 0; j < hs.length; j++) if (Math.hypot(px - hs[j][0], py - hs[j][1]) <= 7) return { k: this.sel, handle: j };
    }
    const X = function (pt) { return self.xFromTime(pt.t); }, Y = function (pt) { return self.yPrice(pt.p); };
    for (let k = this.drawings.length - 1; k >= 0; k--) {
      const d = this.drawings[k]; if (d.hidden || (this._visibleDrawing && !this._visibleDrawing(d))) continue;
      const pts = d.pts;
      let hit = false;
      switch (d.type) {
        case 'trend': hit = distToSeg(px, py, X(pts[0]), Y(pts[0]), X(pts[1]), Y(pts[1])) <= TH; break;
        case 'ray': case 'ext': { const e = this._extend(X(pts[0]), Y(pts[0]), X(pts[1]), Y(pts[1]), d.type === 'ext'); hit = distToSeg(px, py, e[0], e[1], e[2], e[3]) <= TH; break; }
        case 'hline': hit = Math.abs(py - Y(pts[0])) <= TH; break;
        case 'hray': hit = px >= X(pts[0]) - TH && Math.abs(py - Y(pts[0])) <= TH; break;
        case 'vline': hit = Math.abs(px - X(pts[0])) <= TH; break;
        case 'channel': {
          const off = this._channelOffset(pts), xa = X(pts[0]), xb = X(pts[1]);
          hit = distToSeg(px, py, xa, Y(pts[0]), xb, Y(pts[1])) <= TH || distToSeg(px, py, xa, this.yPrice(pts[0].p + off), xb, this.yPrice(pts[1].p + off)) <= TH;
          break;
        }
        case 'rect': case 'measure': {
          const x0 = Math.min(X(pts[0]), X(pts[1])), x1 = Math.max(X(pts[0]), X(pts[1])), y0 = Math.min(Y(pts[0]), Y(pts[1])), y1 = Math.max(Y(pts[0]), Y(pts[1]));
          hit = px >= x0 - TH && px <= x1 + TH && py >= y0 - TH && py <= y1 + TH;
          break;
        }
        case 'fib': case 'fibext': {
          const lv = d.type === 'fib' ? FIB_LEVELS : FIBEXT_LEVELS;
          const base = d.type === 'fib' ? pts[1].p : pts[2].p, span = d.type === 'fib' ? pts[0].p - pts[1].p : pts[1].p - pts[0].p;
          const xs = d.type === 'fib' ? Math.min(X(pts[0]), X(pts[1])) : X(pts[2]);
          if (px >= xs - TH) for (let j = 0; j < lv.length; j++) if (Math.abs(py - this.yPrice(base + span * lv[j])) <= TH) { hit = true; break; }
          if (!hit && d.type === 'fibext') hit = distToSeg(px, py, X(pts[0]), Y(pts[0]), X(pts[1]), Y(pts[1])) <= TH || distToSeg(px, py, X(pts[1]), Y(pts[1]), X(pts[2]), Y(pts[2])) <= TH;
          break;
        }
        case 'text': hit = px >= X(pts[0]) - 4 && px <= X(pts[0]) + 200 && py >= Y(pts[0]) - 12 && py <= Y(pts[0]) + 15 * ((d.text || '').split('\n').length) + 2; break;
        case 'arrowup': hit = Math.abs(px - X(pts[0])) <= 8 && py >= Y(pts[0]) - 2 && py <= Y(pts[0]) + 22; break;
        case 'arrowdn': hit = Math.abs(px - X(pts[0])) <= 8 && py <= Y(pts[0]) + 2 && py >= Y(pts[0]) - 22; break;
        case 'long': case 'short': {
          const g = this._posGeom(d), ys = [Y(pts[0]), Y(pts[1]), Y(pts[2])];
          hit = px >= g.xa - TH && px <= g.xe + TH && py >= Math.min.apply(null, ys) - TH && py <= Math.max.apply(null, ys) + TH;
          break;
        }
        case 'avwap': {
          const r = this._avwapData(d), i = this.indexAt(px);
          hit = !!(r && i >= r.from && r.data[i] != null && Math.abs(py - this.yPrice(r.data[i])) <= TH);
          break;
        }
      }
      if (hit) return { k: k, handle: -1 };
    }
    return null;
  };

  // ---- selection + style toolbar --------------------------------------------------
  PriceChart.prototype.select = function (k) {
    this.sel = this.drawings[k] ? k : -1;
    this._renderStyleBar();
    this.requestOverlay();
  };
  PriceChart.prototype._renderStyleBar = function () {
    const sb = this.styleBar, self = this, d = this.drawings[this.sel];
    if (!d) { sb.style.display = 'none'; return; }
    const st = d.style || {}, color = st.color || DEFAULT_COLOR[d.type];
    let html = '<span class="pc-sname">' + esc(TOOLS[d.type] ? TOOLS[d.type].name.split(' (')[0] : d.type) + '</span>';
    if (d.type !== 'long' && d.type !== 'short' && d.type !== 'measure') {
      html += PALETTE.map(function (p) { return '<button type="button" class="pc-sw' + (p === color ? ' on' : '') + '" data-c="' + p + '" style="background:' + p + '" title="' + p + '"></button>'; }).join('');
      html += '<span class="sep"></span>' + [1, 2, 3, 4].map(function (w) { return '<button type="button" class="ctbtn' + ((st.width || 1) === w ? ' on' : '') + '" data-w="' + w + '">' + w + 'px</button>'; }).join('');
      html += [['solid', '━'], ['dash', '╍'], ['dot', '┉']].map(function (s) { return '<button type="button" class="ctbtn' + ((st.dash || 'solid') === s[0] ? ' on' : '') + '" data-dash="' + s[0] + '" title="' + s[0] + '">' + s[1] + '</button>'; }).join('');
    }
    if (d.type === 'text' || d.type === 'arrowup' || d.type === 'arrowdn') html += '<span class="sep"></span><textarea class="pc-stext" rows="1" maxlength="500" placeholder="Text">' + esc(d.text || '') + '</textarea>';
    if (d.type === 'long' || d.type === 'short') html += '<button type="button" class="ctbtn pc-accent" data-act="log" title="Log this position to the journal">' + ICON.journal + ' Log</button>';
    html += '<span class="sep"></span>' +
      '<button type="button" class="ctbtn tool' + (d.locked ? ' on' : '') + '" data-act="lock" title="Lock">' + ICON.lock + '</button>' +
      '<button type="button" class="ctbtn tool" data-act="clone" title="Clone">' + ICON.clone + '</button>' +
      '<button type="button" class="ctbtn tool" data-act="del" title="Delete (Del)">' + ICON.trash + '</button>';
    sb.innerHTML = html;
    sb.style.display = 'flex';
    sb.onmousedown = function (e) { e.stopPropagation(); };
    sb.onclick = function (e) {
      e.stopPropagation();
      const b = e.target.closest('button'); if (!b) return;
      const cur = self.drawings[self.sel]; if (!cur) return;
      if (b.dataset.act === 'del') { self.deleteSelected(); return; }
      if (b.dataset.act === 'log') { self.logTrade(); return; }
      self._pushUndo();
      if (b.dataset.c) cur.style = Object.assign({}, cur.style, { color: b.dataset.c });
      else if (b.dataset.w) cur.style = Object.assign({}, cur.style, { width: Number(b.dataset.w) });
      else if (b.dataset.dash) cur.style = Object.assign({}, cur.style, { dash: b.dataset.dash });
      else if (b.dataset.act === 'lock') cur.locked = !cur.locked;
      else if (b.dataset.act === 'clone') {
        const cl = JSON.parse(JSON.stringify(cur)); cl.id = uid(); delete cl.locked;
        const k = Math.max(1, Math.round((self.i1 - self.i0) * 0.03));
        cl.pts = cl.pts.map(function (p) { return { t: self.timeAtIdx(Math.round(self.idxOfTime(p.t)) + k), p: p.p }; });
        self.drawings.push(cl); self.sel = self.drawings.length - 1;
      }
      self._saveDrawings(); self._renderStyleBar(); self.requestOverlay();
    };
    const ta = sb.querySelector('.pc-stext');
    if (ta) {
      ta.addEventListener('keydown', function (e) { e.stopPropagation(); if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ta.blur(); } });
      ta.addEventListener('focus', function () { self._pushUndo(); });
      ta.addEventListener('input', function () { const cur = self.drawings[self.sel]; if (cur) { cur.text = ta.value; self.requestOverlay(); } });
      ta.addEventListener('change', function () { self._saveDrawings(); });
    }
  };
  PriceChart.prototype._positionStyleBar = function () {
    if (this.sel < 0 || this.styleBar.style.display === 'none') return;
    this.styleBar.style.left = Math.max(4, (this.cssW - this.styleBar.offsetWidth) / 2) + 'px';
  };

  // ---- undo / redo / persistence ---------------------------------------------------
  PriceChart.prototype._snap = function () { return JSON.stringify(this.drawings); };
  PriceChart.prototype._pushUndo = function () {
    this.undoStack.push(this._snap()); if (this.undoStack.length > 80) this.undoStack.shift();
    this.redoStack = []; this._syncControls();
  };
  PriceChart.prototype.undo = function () {
    if (!this.undoStack.length) return;
    this.redoStack.push(this._snap()); this.drawings = JSON.parse(this.undoStack.pop());
    this.select(-1); this._saveDrawings();
  };
  PriceChart.prototype.redo = function () {
    if (!this.redoStack.length) return;
    this.undoStack.push(this._snap()); this.drawings = JSON.parse(this.redoStack.pop());
    this.select(-1); this._saveDrawings();
  };
  PriceChart.prototype.deleteSelected = function () {
    if (this.sel < 0) return;
    this._pushUndo(); this.drawings.splice(this.sel, 1); this.select(-1); this._saveDrawings();
  };
  PriceChart.prototype.clearDrawings = function () {
    if (!this.drawings.length) return;
    if (!window.confirm('Remove all ' + this.drawings.length + ' drawings on ' + this.symbol + '? Undo can restore them.')) return;
    this._pushUndo(); this.drawings = []; this.select(-1); this._saveDrawings();
  };

  PriceChart.prototype._drawKey = function (sym) { return 'finsight-draw:' + (sym || this.symbol); };
  // v1 shapes {type, price | a:{t,price}, b:{t,price}} -> v2 {id, type, pts:[{t,p}], style}
  function convertDrawings(raw) {
    if (!Array.isArray(raw)) return [];
    const okPt = function (p) { return p && typeof p.t === 'number' && (typeof p.p === 'number' || typeof p.price === 'number'); };
    const pt = function (p) { return { t: p.t, p: typeof p.p === 'number' ? p.p : p.price }; };
    return raw.map(function (d) {
      if (!d || typeof d !== 'object') return null;
      if (Array.isArray(d.pts)) {
        if (!TOOLS[d.type] || d.type === 'cursor' || !d.pts.length || !d.pts.every(okPt)) return null;
        const out = { id: typeof d.id === 'string' ? d.id : uid(), type: d.type, pts: d.pts.map(pt), style: d.style && typeof d.style === 'object' ? d.style : {} };
        if (typeof d.text === 'string') out.text = d.text;
        if (d.locked) out.locked = true;
        if ((out.type === 'long' || out.type === 'short') && out.pts.length < 3) return null;
        if ((out.type === 'channel' || out.type === 'fibext') && out.pts.length < 3) return null;
        return out;
      }
      if (d.type === 'hline' && typeof d.price === 'number') return { id: uid(), type: 'hline', pts: [{ t: 0, p: d.price }], style: {} };
      if (d.type === 'avwap' && d.a && typeof d.a.t === 'number') return { id: uid(), type: 'avwap', pts: [{ t: d.a.t, p: 0 }], style: {} };
      if ((d.type === 'trend' || d.type === 'fib') && okPt(d.a) && okPt(d.b)) return { id: uid(), type: d.type, pts: [pt(d.a), pt(d.b)], style: {} };
      if (d.type === 'risk' && okPt(d.a) && okPt(d.b)) { const e = pt(d.a), s = pt(d.b); if (!(s.p < e.p)) return null; return { id: uid(), type: 'long', pts: [e, s, { t: s.t, p: e.p + 3 * (e.p - s.p) }], style: {} }; }
      return null;
    }).filter(Boolean);
  }
  PriceChart.prototype._loadDrawings = function (sym) {
    let local = [];
    try { local = convertDrawings(JSON.parse(localStorage.getItem(this._drawKey(sym)) || '[]')); } catch (e) { local = []; }
    this.drawings = local;
    const self = this, token = (this._drawToken = (this._drawToken || 0) + 1);
    api('/api/charts/drawings?symbol=' + encodeURIComponent(sym)).then(function (r) {
      if (token !== self._drawToken || self.symbol !== sym) return;
      const server = convertDrawings(r.drawings || []);
      if (server.length) { self.drawings = server; self._cacheLocal(); }
      else if (local.length) self._saveDrawings(); // migrate browser-only drawings to the server
      self._setSaveState('saved');
      self.requestOverlay();
    }).catch(function () { if (token === self._drawToken) self._setSaveState('local'); });
  };
  PriceChart.prototype._cacheLocal = function () { try { localStorage.setItem(this._drawKey(), JSON.stringify(this.drawings)); } catch (e) { /* ignore */ } };
  PriceChart.prototype._saveDrawings = function () {
    if (!this.symbol) return;
    this._cacheLocal();
    const self = this, sym = this.symbol, data = JSON.parse(JSON.stringify(this.drawings));
    this._setSaveState('saving');
    clearTimeout(this._saveT);
    this._saveT = setTimeout(function () {
      api('/api/charts/drawings', { symbol: sym, drawings: data }).then(function () { self._setSaveState('saved'); }).catch(function () { self._setSaveState('local'); });
    }, 350);
    this._syncControls();
  };

  // ---- pointer events ----------------------------------------------------------------
  PriceChart.prototype._evtXY = function (e) { const r = this.overlayCv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  PriceChart.prototype._zone = function (x, y) {
    const P = this.panes && this.panes.price; if (!P) return 'none';
    if (x > P.x + P.w && y >= P.y && y <= P.y + P.h) return 'yaxis';
    if (y > this.bottomY && x <= P.x + P.w) return 'xaxis';
    return 'plot';
  };

  PriceChart.prototype._onMove = function (e) {
    const p = this._evtXY(e);
    this.mx = p.x; this.my = p.y;
    if (!this.drag) this.inside = p.x >= 0 && p.y >= 0 && p.x <= this.cssW && p.y <= this.cssH;
    if (!this.bars.length || !this.panes || this.fHi == null) return;
    const dr = this.drag;
    if (dr) {
      if (dr.kind === 'pan') {
        const dBars = Math.round((dr.x - p.x) / this.slotW), span = dr.span, n = this.bars.length;
        let ni0 = dr.i0 + dBars, ni1 = ni0 + span;
        if (ni0 < 0) { ni0 = 0; ni1 = span; }
        if (ni1 > n) { ni1 = n; ni0 = Math.max(0, n - span); }
        if (dr.manualY) { const df = (p.y - dr.y) / this.priceK; this.yManual = { lo: dr.lo + df, hi: dr.hi + df }; }
        this.setRange(ni0, ni1);
      } else if (dr.kind === 'yaxis') {
        const f = Math.exp((p.y - dr.y) / 200), mid = (dr.lo + dr.hi) / 2, half = (dr.hi - dr.lo) / 2 * f;
        this.yManual = { lo: mid - half, hi: mid + half }; this._dirty();
      } else if (dr.kind === 'xaxis') {
        const f = Math.exp((p.x - dr.x) / 250), n = this.bars.length;
        const newN = clamp(Math.round(dr.span / f), this._minBars(), n);
        this.setRange(dr.i1 - newN, dr.i1);
      } else if (dr.kind === 'handle' || dr.kind === 'move') {
        const d = this.drawings[dr.k];
        if (!d || d.locked) return;
        if (!dr.moved) { if (Math.hypot(p.x - dr.x, p.y - dr.y) < 3) return; this.undoStack.push(dr.before); this.redoStack = []; dr.moved = true; }
        if (dr.kind === 'handle') {
          const np = this._pointAt(p.x, p.y);
          if (d.type === 'long' || d.type === 'short') {
            if (dr.handle === 3) { d.pts[1] = { t: np.t, p: d.pts[1].p }; d.pts[2] = { t: np.t, p: d.pts[2].p }; }
            else if (dr.handle === 0) d.pts[0] = np;
            else d.pts[dr.handle] = { t: d.pts[dr.handle].t, p: np.p };
          } else if (d.type === 'hline') d.pts[0] = { t: d.pts[0].t, p: np.p };
          else if (d.type === 'vline' || d.type === 'avwap') d.pts[0] = { t: np.t, p: d.pts[0].p };
          else d.pts[dr.handle] = np;
        } else {
          const self = this, dIdx = Math.round((p.x - dr.x) / this.slotW);
          const p0 = this.invYPrice(dr.y), p1 = this.invYPrice(p.y);
          d.pts = dr.orig.map(function (o) {
            const t = d.type === 'hline' ? o.t : self.timeAtIdx(Math.round(self.idxOfTime(o.t)) + dIdx);
            const np = d.type === 'vline' || d.type === 'avwap' ? o.p : self.cfg.scale === 'log' ? o.p * p1 / p0 : o.p + (p1 - p0);
            return { t: t, p: np };
          });
        }
        this.requestOverlay();
      }
      return;
    }
    if (this.pending) { this.pending.hover = this._pointAt(p.x, p.y); this.requestOverlay(); return; }
    this.hoverIdx = this.indexAt(p.x);
    if (this.tool === 'cursor' && !this.replay.picking) {
      const z = this._zone(p.x, p.y), h = z === 'plot' ? this._hit(p.x, p.y) : null;
      this.overlayCv.style.cursor = z === 'yaxis' ? 'ns-resize' : z === 'xaxis' ? 'ew-resize' : h ? (h.handle >= 0 ? 'grab' : 'pointer') : 'crosshair';
    }
    this.requestOverlay();
  };

  PriceChart.prototype._onDown = function (e) {
    if (e.button !== 0 || !this.bars.length || !this.panes || this.fHi == null) return;
    this.overlayCv.focus({ preventScroll: true });
    this._closeMenus();
    const p = this._evtXY(e);
    if (this.replay.picking) {
      const k = clamp(Math.round(this.i0 + (p.x - this.padL) / this.slotW - 0.5), 1, Math.max(1, this.allBars.length - 2));
      this.startReplayAt(k); return;
    }
    if (this.tool !== 'cursor') {
      if (this._zone(p.x, p.y) !== 'plot') return;
      const pt = this._pointAt(p.x, p.y), need = TOOLS[this.tool].n;
      if (!this.pending) {
        this.pending = { type: this.tool, pts: [pt], style: { color: DEFAULT_COLOR[this.tool] }, downX: p.x, downY: p.y, hover: pt };
        if (need === 1) this._commitPending();
      } else {
        this.pending.pts.push(pt); this.pending.downX = p.x; this.pending.downY = p.y;
        if (this.pending.pts.length >= need) this._commitPending();
      }
      this.requestOverlay(); return;
    }
    const z = this._zone(p.x, p.y);
    if (z === 'yaxis') { this.drag = { kind: 'yaxis', y: p.y, lo: this.fLo, hi: this.fHi }; return; }
    if (z === 'xaxis') { this.drag = { kind: 'xaxis', x: p.x, span: this.i1 - this.i0, i1: this.i1 }; return; }
    const h = this._hit(p.x, p.y);
    if (h) {
      if (h.k !== this.sel) this.select(h.k);
      const d = this.drawings[h.k];
      this.drag = { kind: h.handle >= 0 ? 'handle' : 'move', k: h.k, handle: h.handle, x: p.x, y: p.y, before: this._snap(), orig: d.pts.map(function (q) { return { t: q.t, p: q.p }; }) };
      this.overlayCv.style.cursor = d.locked ? 'not-allowed' : 'grabbing';
      return;
    }
    if (this.sel >= 0) this.select(-1);
    this.drag = { kind: 'pan', x: p.x, y: p.y, i0: this.i0, span: this.i1 - this.i0, manualY: !!this.yManual, lo: this.fLo, hi: this.fHi };
    this.overlayCv.style.cursor = 'grabbing';
  };

  PriceChart.prototype._onUp = function (e) {
    const p = this._evtXY(e);
    if (this.pending && this.pending.pts.length === 1 && TOOLS[this.pending.type].n >= 2 && Math.hypot(p.x - this.pending.downX, p.y - this.pending.downY) > 6) {
      // drag-to-place: release adds the second point
      this.pending.pts.push(this._pointAt(p.x, p.y));
      if (this.pending.pts.length >= TOOLS[this.pending.type].n) this._commitPending();
      this.requestOverlay();
      return;
    }
    if (!this.drag) return;
    const dr = this.drag; this.drag = null;
    if ((dr.kind === 'handle' || dr.kind === 'move') && dr.moved) { this._saveDrawings(); this._syncControls(); }
    this.overlayCv.style.cursor = this.tool === 'cursor' ? 'crosshair' : 'cell';
    this.inside = p.x >= 0 && p.y >= 0 && p.x <= this.cssW && p.y <= this.cssH;
    this.requestOverlay();
  };

  PriceChart.prototype._commitPending = function () {
    const pd = this.pending; this.pending = null;
    const d = this._finalizeShape({ id: uid(), type: pd.type, pts: pd.pts.slice(0, TOOLS[pd.type].n), style: pd.style });
    if (d.type === 'text') d.text = 'Note';
    if (d.pts.length >= 2 && d.type !== 'long' && d.type !== 'short') {
      const a = d.pts[0], b = d.pts[1];
      if (a.t === b.t && Math.abs(this.yPrice(a.p) - this.yPrice(b.p)) < 2) { this.setTool('cursor'); return; }
    }
    if (d.type === 'long' || d.type === 'short') {
      if (Math.abs(this.yPrice(d.pts[0].p) - this.yPrice(d.pts[1].p)) < 3) { this.setTool('cursor'); return; }
      // the stop side decides the direction
      const e = d.pts[0].p, s = d.pts[1].p;
      d.type = s < e ? 'long' : 'short';
      d.pts[2] = { t: d.pts[1].t, p: e + 3 * (e - s) };
      d.style = { color: DEFAULT_COLOR[d.type] };
    }
    this._pushUndo();
    this.drawings.push(d);
    this._saveDrawings();
    this.setTool('cursor');
    this.select(this.drawings.length - 1);
    if (d.type === 'text') { const ta = this.styleBar.querySelector('.pc-stext'); if (ta) { ta.focus(); ta.select(); } }
  };

  PriceChart.prototype._onWheel = function (e) {
    if (!this.bars.length || !this.panes) return;
    e.preventDefault();
    const p = this._evtXY(e), n = this.i1 - this.i0, N = this.bars.length;
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY) && !e.ctrlKey) {
      const d = Math.round(e.deltaX / Math.max(2, this.slotW));
      if (d) { const a = clamp(this.i0 + d, 0, Math.max(0, N - n)); this.setRange(a, a + n); }
      return;
    }
    const anchorFrac = clamp((p.x - this.padL) / this.plotW, 0, 1), anchorIdx = this.i0 + anchorFrac * n;
    const newN = clamp(Math.round(n * (e.deltaY < 0 ? 0.88 : 1 / 0.88)), this._minBars(), N);
    let ni0 = Math.round(anchorIdx - anchorFrac * newN), ni1 = ni0 + newN;
    if (ni0 < 0) { ni0 = 0; ni1 = newN; }
    if (ni1 > N) { ni1 = N; ni0 = N - newN; }
    this.setRange(ni0, ni1);
  };
  PriceChart.prototype._onDblClick = function (e) {
    const p = this._evtXY(e), z = this._zone(p.x, p.y);
    if (z === 'yaxis') { this.yManual = null; this._dirty(); return; }
    if (z === 'xaxis') { const n = this.bars.length; this.setRange(n - Math.min(n, 150), n); return; }
    const h = this._hit(p.x, p.y);
    if (h) { this.select(h.k); const ta = this.styleBar.querySelector('.pc-stext'); if (ta) ta.focus(); }
  };

  // ---- replay ---------------------------------------------------------------------------
  PriceChart.prototype.startReplayPick = function () {
    if (this.allBars.length < 3) return;
    this.setTool('cursor');
    this.replay.picking = true;
    this.replayBtn.classList.add('on');
    this.overlayCv.style.cursor = 'col-resize';
    this._flash('Click a bar to start the replay (Esc cancels)');
  };
  PriceChart.prototype.startReplayAt = function (k) {
    this.replay.picking = false; this.replay.active = true; this.replay.idx = k;
    this.replayBar.style.display = 'flex';
    this._applyReplaySlice(); this._computeIndicators();
    const n = this.bars.length, span = Math.min(n, Math.max(60, this.i1 - this.i0));
    this.setRange(n - span, n);
    this._renderReplayBar(); this.resize();
  };
  PriceChart.prototype.replayStep = function (d) {
    if (!this.replay.active) return;
    const k = clamp(this.replay.idx + d, 1, this.allBars.length - 1);
    if (k === this.replay.idx) { if (this.replay.playing) this.replayToggle(); return; }
    const atEnd = this.i1 === this.bars.length, span = this.i1 - this.i0;
    this.replay.idx = k;
    this._applyReplaySlice(); this._computeIndicators();
    const n = this.bars.length;
    if (atEnd) this.setRange(Math.max(0, n - span), n); else this._dirty();
    this._renderReplayBar();
  };
  PriceChart.prototype.replayToggle = function () {
    const r = this.replay, self = this;
    r.playing = !r.playing;
    clearInterval(r.timer);
    if (r.playing) r.timer = setInterval(function () { self.replayStep(1); }, 1000 / r.speed);
    this._renderReplayBar();
  };
  PriceChart.prototype.stopReplay = function (silent) {
    const r = this.replay, was = r.active;
    clearInterval(r.timer);
    r.active = false; r.picking = false; r.playing = false;
    this.replayBar.style.display = 'none';
    this.replayBtn.classList.remove('on');
    this.overlayCv.style.cursor = 'crosshair';
    if (was && !silent) {
      const span = this.i1 - this.i0 || 150;
      this._applyReplaySlice(); this._computeIndicators();
      const n = this.bars.length;
      this.resize();
      this.setRange(n - Math.min(n, span), n);
    }
    this.requestOverlay();
  };
  PriceChart.prototype._renderReplayBar = function () {
    const r = this.replay, b = this.allBars[r.idx];
    this.replayBar.querySelector('.rb-label').textContent = 'REPLAY · ' + (b ? fmtDate(b.t, isIntraday(this.interval)) : '') + ' · bar ' + (r.idx + 1) + ' / ' + this.allBars.length;
    this.replayBar.querySelector('[data-a=play]').textContent = r.playing ? '❚❚' : '▶';
    this.replayBtn.classList.toggle('on', r.active);
  };

  // ---- snapshot + journal -----------------------------------------------------------------
  PriceChart.prototype.snapshot = function () {
    if (!this.cssW || !this.bars.length) return null;
    const dpr = this.dpr || 1, head = 26;
    const cv = document.createElement('canvas');
    cv.width = Math.round(this.cssW * dpr); cv.height = Math.round((this.cssH + head) * dpr);
    const c = cv.getContext('2d');
    c.fillStyle = this.BG || '#06080c'; c.fillRect(0, 0, cv.width, cv.height);
    const hov = this.inside; this.inside = false; this.drawOverlay(); // no crosshair in the image
    c.drawImage(this.staticCv, 0, head * dpr); c.drawImage(this.overlayCv, 0, head * dpr);
    this.inside = hov; this.requestOverlay();
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.font = 'bold 12px ' + this.fontFamily;
    c.fillStyle = this.AMBER || '#ff9e16'; c.textBaseline = 'middle';
    const last = this.bars[this.bars.length - 1];
    c.fillText((this.symbol || '') + ' · ' + this._tfLabel() + ' · ' + fmtDate(last.t, isIntraday(this.interval)) + (this.replay.active ? ' · REPLAY' : '') + (this.strat ? ' · ' + this.strat.stage.label : ''), 8, head / 2);
    c.fillStyle = this.DIM || '#4b5563'; c.textAlign = 'right'; c.fillText('FinSight', this.cssW - 8, head / 2);
    return cv.toDataURL('image/png');
  };
  PriceChart.prototype.downloadSnapshot = function () {
    const url = this.snapshot(); if (!url) return;
    const a = document.createElement('a'), last = this.bars[this.bars.length - 1];
    a.href = url; a.download = (this.symbol || 'chart') + '_' + this._tfLabel() + '_' + new Date(last.t).toISOString().slice(0, 10) + '.png';
    document.body.appendChild(a); a.click(); a.remove();
    this._flash('Image saved');
  };
  // Prefill a journal entry from the selected (else latest) position tool, else the strategy setup.
  PriceChart.prototype.logPrefill = function () {
    const last = this.bars[this.bars.length - 1];
    const pre = { symbol: this.symbol, interval: this._tfLabel(), price: last ? last.c : null, chartAt: last ? last.t : null,
      kind: this.replay.active ? 'replay' : 'idea', status: 'watching', side: 'long',
      entryDate: last ? new Date(last.t).toISOString().slice(0, 10) : '' };
    let pos = this.drawings[this.sel];
    if (!pos || (pos.type !== 'long' && pos.type !== 'short')) pos = this.drawings.slice().reverse().find(function (d) { return d.type === 'long' || d.type === 'short'; });
    if (pos) { pre.side = pos.type; pre.entry = pos.pts[0].p; pre.stop = pos.pts[1].p; pre.target = pos.pts[2].p; pre.setup = 'Chart position tool'; }
    else if (this.strat && (this.strat.stage.code === 'setup' || this.strat.stage.code === 'signal') && this.strat.stage.trig != null && this.strat.kind !== 'zones') {
      const g = this.strat.stage; pre.entry = g.trig; pre.stop = g.stop; pre.target = g.t3; pre.setup = this.strat.short + ': ' + g.label.toLowerCase(); pre.tags = this.strat.id;
    }
    else if (this.strat && this.strat.open) {
      const o = this.strat.open; pre.entry = o.entry; pre.stop = o.stop; pre.target = o.target; pre.status = 'open';
      pre.setup = this.strat.short + ': simulated trade (entered ' + new Date(this.bars[this._ci(o.entryIdx)].t).toISOString().slice(0, 10) + ')'; pre.tags = this.strat.id;
    }
    if (this.strat && pre.setup === undefined) { pre.setup = this.strat.short + ': ' + this.strat.stage.label; pre.tags = this.strat.id; }
    const round = function (v) { return v == null ? v : +v.toFixed(decimalsFor(v)); };
    pre.entry = round(pre.entry); pre.stop = round(pre.stop); pre.target = round(pre.target); pre.price = round(pre.price);
    if (pre.entry != null && pre.stop != null && window.FinStrategy) {
      const long = pre.side !== 'short';
      const z = window.FinStrategy.size(Object.assign(this._sizerVals(), { entry: long ? pre.entry : pre.stop, stop: long ? pre.stop : pre.entry }));
      if (z.ok) pre.qty = z.shares;
    }
    return pre;
  };
  PriceChart.prototype.logTrade = function () {
    const pre = this.logPrefill(), img = this.snapshot();
    if (this.onLog) this.onLog(pre, img);
    else if (window.FinJournal) window.FinJournal.openNew(pre, img, { onOpenChart: this.onSymbol });
  };

  // ---- util ---------------------------------------------------------------------------------
  PriceChart.prototype._rgba = function (col, a) {
    col = (col || '').trim();
    if (col[0] === '#') {
      let h = col.slice(1);
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      return 'rgba(' + parseInt(h.slice(0, 2), 16) + ',' + parseInt(h.slice(2, 4), 16) + ',' + parseInt(h.slice(4, 6), 16) + ',' + a + ')';
    }
    return col;
  };
  PriceChart.prototype.destroy = function () {
    if (this.ro) this.ro.disconnect();
    window.removeEventListener('mouseup', this._onUpWin);
    window.removeEventListener('mousemove', this._onMoveWin);
    window.removeEventListener('keydown', this._onKey);
    window.removeEventListener('resize', this._onWinResize);
    document.removeEventListener('click', this._onDocClick);
    clearInterval(this.replay.timer);
    cancelAnimationFrame(this._rsRaf); cancelAnimationFrame(this._roRaf);
    clearTimeout(this._rsTimer); clearTimeout(this._roTimer);
  };

  PriceChart.TOOLS = TOOLS; PriceChart.IND = IND; PriceChart.convertDrawings = convertDrawings;
  window.PriceChart = PriceChart;
})();
