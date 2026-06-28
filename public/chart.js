/* ===========================================================================
 *  chart.js — FinSight interactive price chart (zero-dependency, offline)
 * ---------------------------------------------------------------------------
 *  A self-contained canvas trading chart for the SECURITY DETAIL panel:
 *  candlestick / line / area, moving averages (SMA/EMA) + Bollinger Bands,
 *  RSI & MACD sub-panes, volume strip, crosshair OHLC readout, pan + wheel
 *  zoom, and drawing tools (trendline, horizontal line, Fibonacci retracement)
 *  persisted per-symbol in localStorage.
 *
 *  Wrapped in an IIFE so it shares no top-level identifiers with app.js
 *  (which loads after it). Exposes only `window.PriceChart`.
 *  Consumes the /api/history point shape {t,o,h,l,c,v} produced by server.js.
 * ======================================================================== */
(function () {
  'use strict';

  // ---- technical indicators (reference-grade; see design spec) ------------
  // All return arrays aligned 1:1 with bars, null during warm-up so the line
  // simply doesn't draw. They read only close (`c`), which is never null.

  function sma(bars, period) {
    const out = new Array(bars.length).fill(null);
    if (period <= 0) return out;
    let sum = 0;
    for (let i = 0; i < bars.length; i++) {
      sum += bars[i].c;
      if (i >= period) sum -= bars[i - period].c;
      if (i >= period - 1) out[i] = sum / period;
    }
    return out;
  }

  function ema(bars, period) {
    const out = new Array(bars.length).fill(null);
    if (period <= 0 || bars.length < period) return out;
    const k = 2 / (period + 1);
    let seed = 0;
    for (let i = 0; i < period; i++) seed += bars[i].c; // seed = SMA of first `period`
    seed /= period;
    out[period - 1] = seed;
    let prev = seed;
    for (let i = period; i < bars.length; i++) {
      prev = bars[i].c * k + prev * (1 - k);
      out[i] = prev;
    }
    return out;
  }

  function bollinger(bars, period, mult) {
    period = period || 20; mult = mult || 2;
    const out = bars.map(function () { return { middle: null, upper: null, lower: null }; });
    if (period <= 0 || bars.length < period) return out;
    for (let i = period - 1; i < bars.length; i++) {
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) sum += bars[j].c;
      const mean = sum / period;
      let sq = 0;
      for (let j = i - period + 1; j <= i; j++) { const d = bars[j].c - mean; sq += d * d; }
      const sd = Math.sqrt(sq / period); // population std (divide by N)
      out[i] = { middle: mean, upper: mean + mult * sd, lower: mean - mult * sd };
    }
    return out;
  }

  function rsi(bars, period) {
    period = period || 14;
    const n = bars.length;
    const out = new Array(n).fill(null);
    if (period <= 0 || n <= period) return out;
    let gainSum = 0, lossSum = 0;
    for (let i = 1; i <= period; i++) {
      const ch = bars[i].c - bars[i - 1].c;
      if (ch >= 0) gainSum += ch; else lossSum += -ch;
    }
    let avgGain = gainSum / period, avgLoss = lossSum / period;
    out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    for (let i = period + 1; i < n; i++) {
      const ch = bars[i].c - bars[i - 1].c;
      const gain = ch > 0 ? ch : 0;
      const loss = ch < 0 ? -ch : 0;
      avgGain = (avgGain * (period - 1) + gain) / period; // Wilder smoothing
      avgLoss = (avgLoss * (period - 1) + loss) / period;
      out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    }
    return out;
  }

  function macd(bars, fast, slow, signal) {
    fast = fast || 12; slow = slow || 26; signal = signal || 9;
    const n = bars.length;
    const fastE = ema(bars, fast), slowE = ema(bars, slow);
    const macdLine = new Array(n).fill(null);
    for (let i = 0; i < n; i++) {
      if (fastE[i] != null && slowE[i] != null) macdLine[i] = fastE[i] - slowE[i];
    }
    const signalLine = new Array(n).fill(null);
    const histogram = new Array(n).fill(null);
    let start = macdLine.findIndex(function (v) { return v != null; });
    if (start === -1 || n - start < signal) return { macdLine, signalLine, histogram };
    const k = 2 / (signal + 1);
    let seed = 0;
    for (let i = start; i < start + signal; i++) seed += macdLine[i];
    seed /= signal;
    let prev = seed;
    const seedIdx = start + signal - 1;
    signalLine[seedIdx] = prev;
    histogram[seedIdx] = macdLine[seedIdx] - prev;
    for (let i = seedIdx + 1; i < n; i++) {
      prev = macdLine[i] * k + prev * (1 - k);
      signalLine[i] = prev;
      histogram[i] = macdLine[i] - prev;
    }
    return { macdLine, signalLine, histogram };
  }

  // ---- small helpers ------------------------------------------------------
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.272, 1.618, 2.618];
  const clamp = function (v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; };

  function decimalsFor(v) {
    v = Math.abs(v);
    if (!isFinite(v) || v === 0) return 2;
    if (v >= 1000) return 2;
    if (v >= 1) return 2;
    if (v >= 0.1) return 4;
    if (v >= 0.001) return 5;
    return 6;
  }
  function fmtPrice(v, dec) {
    if (v == null || !isFinite(v)) return '—';
    return v.toFixed(dec == null ? decimalsFor(v) : dec);
  }
  function fmtVol(v) {
    if (v == null || !isFinite(v)) return '—';
    const a = Math.abs(v);
    if (a >= 1e9) return (v / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return (v / 1e6).toFixed(2) + 'M';
    if (a >= 1e3) return (v / 1e3).toFixed(1) + 'K';
    return String(Math.round(v));
  }

  function niceStep(range, target) {
    target = target || 6;
    const raw = range / target;
    if (!(raw > 0)) return 1;
    const pow = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw / pow;
    const nice = f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10;
    return nice * pow;
  }

  // point -> segment distance (for trendline hit-testing)
  function distToSeg(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy || 1;
    let t = ((px - ax) * dx + (py - ay) * dy) / len2;
    t = clamp(t, 0, 1);
    const cx = ax + t * dx, cy = ay + t * dy;
    return Math.hypot(px - cx, py - cy);
  }

  // ---- toolbar definitions ------------------------------------------------
  const MODES = [['candles', 'Candles'], ['line', 'Line'], ['area', 'Area']];
  // overlay key, label, kind, period, colour
  const OVERLAYS = [
    ['sma20', 'MA20', 'sma', 20, '#ffd166'],
    ['sma50', 'MA50', 'sma', 50, '#38bdf8'],
    ['sma200', 'MA200', 'sma', 200, '#c678dd'],
    ['ema21', 'EMA21', 'ema', 21, '#a78bfa'],
    ['bb', 'BBANDS', 'bb', 20, '#7b8794'],
  ];
  const PANES = [['vol', 'VOL'], ['rsi', 'RSI'], ['macd', 'MACD']];
  const TOOLS = [['cursor', 'Cursor', '✛'], ['trend', 'Trend', '╱'], ['hline', 'H-Line', '─'], ['fib', 'Fib', 'ƒ']];

  const CFG_KEY = 'finsight-chart-cfg';
  function loadCfg() {
    const def = {
      mode: 'candles',
      overlays: { sma20: true, sma50: true, sma200: false, ema21: false, bb: false },
      panes: { vol: true, rsi: false, macd: false },
    };
    try {
      const raw = JSON.parse(localStorage.getItem(CFG_KEY) || '{}');
      if (raw && typeof raw === 'object') {
        if (raw.mode) def.mode = raw.mode;
        if (raw.overlays) Object.assign(def.overlays, raw.overlays);
        if (raw.panes) Object.assign(def.panes, raw.panes);
      }
    } catch (e) { /* ignore corrupt prefs */ }
    return def;
  }

  // =========================================================================
  //  PriceChart
  // =========================================================================
  function PriceChart(root) {
    this.root = root;
    root.__priceChart = this; // back-reference for the host app / debugging
    this.cfg = loadCfg();
    this.tool = 'cursor';
    this.symbol = null;
    this.interval = '1d';
    this.bars = [];
    this.ind = { ma: [], bb: null, rsi: null, macd: null };
    this.drawings = [];
    this.i0 = 0; this.i1 = 0;
    this.hoverIdx = -1; this.mx = -1; this.my = -1; this.inside = false;
    this.dragging = false; this.drawingNow = false; this.pending = null;
    this.selDrawing = -1;
    this._rsOn = false; this._rsRaf = 0; this._rsTimer = 0;
    this._roOn = false; this._roRaf = 0; this._roTimer = 0;
    this._lastAreaH = 0;

    this._build();
    const self = this;
    this.ro = (typeof ResizeObserver !== 'undefined')
      ? new ResizeObserver(function () { self.resize(); })
      : null;
    if (this.ro) this.ro.observe(this.area);
    else window.addEventListener('resize', function () { self.resize(); });
    this._bind();
    this.resize();
  }

  PriceChart.prototype._build = function () {
    const self = this;
    this.root.innerHTML = '';
    // toolbar
    const tb = document.createElement('div');
    tb.className = 'chart-toolbar';
    this.toolbar = tb;

    function group(labelText, btns) {
      const g = document.createElement('span'); g.className = 'grp';
      if (labelText) { const l = document.createElement('span'); l.className = 'ct-label'; l.textContent = labelText; g.appendChild(l); }
      btns.forEach(function (b) { g.appendChild(b); });
      return g;
    }
    function btn(text, title) {
      const b = document.createElement('button');
      b.className = 'ctbtn'; b.textContent = text; if (title) b.title = title;
      return b;
    }
    function sep() { const s = document.createElement('span'); s.className = 'sep'; return s; }

    // chart type
    this.modeBtns = {};
    const modeEls = MODES.map(function (m) {
      const b = btn(m[1], m[1] + ' chart');
      b.classList.toggle('on', self.cfg.mode === m[0]);
      b.addEventListener('click', function () { self.setMode(m[0]); });
      self.modeBtns[m[0]] = b; return b;
    });
    tb.appendChild(group('', modeEls));
    tb.appendChild(sep());

    // overlays (MAs + bbands)
    this.ovBtns = {};
    const ovEls = OVERLAYS.map(function (o) {
      const b = btn(o[1], o[1] + ' overlay');
      b.classList.toggle('on', !!self.cfg.overlays[o[0]]);
      b.style.setProperty('--ind-c', o[4]);
      if (self.cfg.overlays[o[0]]) b.style.borderColor = o[4];
      b.addEventListener('click', function () { self.toggleOverlay(o[0]); });
      self.ovBtns[o[0]] = b; return b;
    });
    tb.appendChild(group('IND', ovEls));
    tb.appendChild(sep());

    // panes (vol/rsi/macd)
    this.paneBtns = {};
    const paneEls = PANES.map(function (p) {
      const b = btn(p[1], p[1] + ' pane');
      b.classList.toggle('on', !!self.cfg.panes[p[0]]);
      b.addEventListener('click', function () { self.togglePane(p[0]); });
      self.paneBtns[p[0]] = b; return b;
    });
    tb.appendChild(group('', paneEls));
    tb.appendChild(sep());

    // drawing tools
    this.toolBtns = {};
    const toolEls = TOOLS.map(function (t) {
      const b = btn(t[2], t[1] + ' tool');
      b.classList.add('tool');
      b.classList.toggle('on', self.tool === t[0]);
      b.addEventListener('click', function () { self.setTool(t[0]); });
      self.toolBtns[t[0]] = b; return b;
    });
    const clearBtn = btn('✕', 'Clear drawings');
    clearBtn.classList.add('tool');
    clearBtn.addEventListener('click', function () { self.clearDrawings(); });
    toolEls.push(clearBtn);
    tb.appendChild(group('DRAW', toolEls));

    this.root.appendChild(tb);

    // chart area: static + overlay canvases + floating legend
    const area = document.createElement('div');
    area.className = 'chart-area';
    this.area = area;
    this.staticCv = document.createElement('canvas');
    this.overlayCv = document.createElement('canvas');
    this.staticCv.className = 'chart-static';
    this.overlayCv.className = 'chart-overlay';
    this.legend = document.createElement('div');
    this.legend.className = 'chart-legend';
    this.legend.style.display = 'none';
    area.appendChild(this.staticCv);
    area.appendChild(this.overlayCv);
    area.appendChild(this.legend);
    this.root.appendChild(area);

    this.ctx = this.staticCv.getContext('2d');
    this.octx = this.overlayCv.getContext('2d');
  };

  PriceChart.prototype._bind = function () {
    const self = this;
    const ov = this.overlayCv;
    ov.addEventListener('mousemove', function (e) { self._onMove(e); });
    ov.addEventListener('mousedown', function (e) { self._onDown(e); });
    // mouseup on window (not the canvas) so a drag that releases off-canvas still ends.
    this._onUpWin = function (e) { self._onUp(e); };
    window.addEventListener('mouseup', this._onUpWin);
    ov.addEventListener('mouseleave', function () { self._onLeave(); });
    ov.addEventListener('mouseenter', function () { self.inside = true; });
    ov.addEventListener('wheel', function (e) { self._onWheel(e); }, { passive: false });
    ov.addEventListener('dblclick', function (e) { self._onDblClick(e); });
  };

  // ---- data load ----------------------------------------------------------
  PriceChart.prototype.load = function (symbol, bars, meta, ctx) {
    const sameSym = symbol === this.symbol;
    const sameView = sameSym && ctx && this.interval === ctx.interval && this.range === ctx.range;
    this.symbol = symbol;
    this.meta = meta || {};
    this.interval = (ctx && ctx.interval) || '1d';
    this.range = (ctx && ctx.range) || '1mo';
    this.bars = Array.isArray(bars) ? bars : [];
    if (!sameSym) { this.drawings = this._loadDrawings(symbol); this.selDrawing = -1; this.tool = 'cursor'; this._syncToolBtns(); }
    this._computeIndicators();
    const n = this.bars.length;
    if (sameView && this.i1 > 0 && this.i1 <= n) {
      // 30s refresh of same view: keep the window but absorb a freshly-added bar
      const grew = n - this._prevN;
      if (grew > 0 && this.i1 >= this._prevN) { this.i0 += grew; this.i1 += grew; }
      this.i1 = Math.min(this.i1, n); this.i0 = clamp(this.i0, 0, Math.max(0, this.i1 - this._minBars()));
      this._dirtyStatic = true; this.requestRender();
    } else {
      const span = Math.min(n, 140);
      this.setRange(n - span, n);
    }
    this._prevN = n;
  };

  PriceChart.prototype._minBars = function () { return Math.min(this.bars.length || 1, 20); };

  PriceChart.prototype.setRange = function (i0, i1) {
    const n = this.bars.length;
    this.i1 = Math.min(n, Math.max(1, Math.round(i1)));
    this.i0 = Math.max(0, Math.min(Math.round(i0), this.i1 - this._minBars()));
    this._dirtyStatic = true;
    this.requestRender();
  };

  // ---- toolbar actions ----------------------------------------------------
  PriceChart.prototype._saveCfg = function () {
    try { localStorage.setItem(CFG_KEY, JSON.stringify({ mode: this.cfg.mode, overlays: this.cfg.overlays, panes: this.cfg.panes })); } catch (e) { /* ignore */ }
  };
  PriceChart.prototype.setMode = function (m) {
    this.cfg.mode = m;
    for (const k in this.modeBtns) this.modeBtns[k].classList.toggle('on', k === m);
    this._saveCfg(); this._dirtyStatic = true; this.requestRender();
  };
  PriceChart.prototype.toggleOverlay = function (k) {
    this.cfg.overlays[k] = !this.cfg.overlays[k];
    const def = OVERLAYS.find(function (o) { return o[0] === k; });
    const b = this.ovBtns[k];
    b.classList.toggle('on', this.cfg.overlays[k]);
    b.style.borderColor = this.cfg.overlays[k] && def ? def[4] : '';
    this._saveCfg(); this._computeIndicators(); this._dirtyStatic = true; this.requestRender();
  };
  PriceChart.prototype.togglePane = function (k) {
    this.cfg.panes[k] = !this.cfg.panes[k];
    this.paneBtns[k].classList.toggle('on', this.cfg.panes[k]);
    this._saveCfg(); this._computeIndicators(); this.resize(); // height may change
  };
  PriceChart.prototype.setTool = function (t) {
    this.tool = t; this.drawingNow = false; this.pending = null;
    this._syncToolBtns();
    this.overlayCv.style.cursor = t === 'cursor' ? 'crosshair' : 'cell';
    this.requestOverlay();
  };
  PriceChart.prototype._syncToolBtns = function () {
    for (const k in this.toolBtns) this.toolBtns[k].classList.toggle('on', k === this.tool);
  };
  PriceChart.prototype.clearDrawings = function () {
    if (!this.drawings.length) return;
    this.drawings = []; this.selDrawing = -1; this._saveDrawings(); this.requestOverlay();
  };

  PriceChart.prototype._computeIndicators = function () {
    const b = this.bars;
    this.ind = { ma: [], bb: null, rsi: null, macd: null };
    const ov = this.cfg.overlays;
    OVERLAYS.forEach(function (o) {
      if (o[2] === 'bb') return;
      if (ov[o[0]]) this.ind.ma.push({ key: o[0], color: o[4], data: o[2] === 'ema' ? ema(b, o[3]) : sma(b, o[3]) });
    }, this);
    if (ov.bb) this.ind.bb = bollinger(b, 20, 2);
    if (this.cfg.panes.rsi) this.ind.rsi = rsi(b, 14);
    if (this.cfg.panes.macd) this.ind.macd = macd(b, 12, 26, 9);
  };

  // ---- sizing / layout ----------------------------------------------------
  PriceChart.prototype._desiredHeight = function () {
    let h = 340; // price + volume
    if (this.cfg.panes.rsi) h += 96;
    if (this.cfg.panes.macd) h += 96;
    return h;
  };
  PriceChart.prototype.resize = function () {
    const want = this._desiredHeight();
    if (want !== this._lastAreaH) { this.area.style.height = want + 'px'; this._lastAreaH = want; }
    const r = this.area.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return; // hidden panel — wait for show
    const dpr = window.devicePixelRatio || 1;
    this.cssW = r.width; this.cssH = r.height; this.dpr = dpr;
    [this.staticCv, this.overlayCv].forEach(function (cv) {
      cv.width = Math.round(r.width * dpr);
      cv.height = Math.round(r.height * dpr);
      cv.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
    });
    this._dirtyStatic = true;
    this.render();
  };

  PriceChart.prototype._layout = function () {
    const padTop = 6, padLeft = 4, axisRight = 58, axisBottom = 20, gap = 8;
    this.padL = padLeft; this.axisR = axisRight;
    this.plotW = this.cssW - axisRight - padLeft;
    const panes = [{ id: 'price', w: 3.0 }];
    if (this.cfg.panes.vol) panes.push({ id: 'vol', w: 0.7 });
    if (this.cfg.panes.rsi) panes.push({ id: 'rsi', w: 1.0 });
    if (this.cfg.panes.macd) panes.push({ id: 'macd', w: 1.0 });
    const plotH = this.cssH - padTop - axisBottom - gap * (panes.length - 1);
    let totW = 0; panes.forEach(function (p) { totW += p.w; });
    let y = padTop;
    this.panes = {};
    for (let i = 0; i < panes.length; i++) {
      const ph = plotH * panes[i].w / totW;
      this.panes[panes[i].id] = { x: padLeft, y: y, w: this.plotW, h: ph };
      y += ph + gap;
    }
    this.bottomY = y - gap; // bottom of lowest pane (where time axis sits)
  };

  // ---- scales / transforms ------------------------------------------------
  PriceChart.prototype._computeScales = function () {
    const n = this.i1 - this.i0;
    this.slotW = this.plotW / Math.max(1, n);
    this.candleW = Math.max(1, Math.floor(this.slotW * 0.66));
    if (this.candleW % 2 === 0) this.candleW = Math.max(1, this.candleW - 1);
    // price domain from visible highs/lows + visible overlay extents
    let lo = Infinity, hi = -Infinity;
    for (let i = this.i0; i < this.i1; i++) {
      const b = this.bars[i];
      const h = (b.h != null ? b.h : b.c), l = (b.l != null ? b.l : b.c);
      if (l < lo) lo = l; if (h > hi) hi = h;
    }
    const consider = function (v) { if (v != null && isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; } };
    this.ind.ma.forEach(function (m) { for (let i = this.i0; i < this.i1; i++) consider(m.data[i]); }, this);
    if (this.ind.bb) for (let i = this.i0; i < this.i1; i++) { consider(this.ind.bb[i].upper); consider(this.ind.bb[i].lower); }
    if (!isFinite(lo) || !isFinite(hi)) { lo = 0; hi = 1; }
    const span = (hi - lo) || (Math.abs(hi) || 1);
    const pad = span * 0.08;
    this.yLo = lo - pad; this.yHi = hi + pad;
    const P = this.panes.price;
    this.priceK = P.h / ((this.yHi - this.yLo) || 1);
    // volume max
    if (this.panes.vol) {
      let mv = 0;
      for (let i = this.i0; i < this.i1; i++) { const v = this.bars[i].v; if (v != null && v > mv) mv = v; }
      this.maxVol = mv || 1;
    }
  };

  PriceChart.prototype.xFromIndex = function (i) { return this.padL + (i - this.i0 + 0.5) * this.slotW; };
  PriceChart.prototype.yPrice = function (v) { return this.panes.price.y + (this.yHi - v) * this.priceK; };
  PriceChart.prototype.invYPrice = function (py) { return this.yHi - (py - this.panes.price.y) / this.priceK; };
  PriceChart.prototype.indexAt = function (px) {
    return clamp(this.i0 + Math.floor((px - this.padL) / this.slotW), this.i0, this.i1 - 1);
  };
  // map a timestamp to fractional bar index (for projecting persisted drawings)
  PriceChart.prototype.xFromTime = function (t) {
    const b = this.bars, n = b.length;
    if (!n) return this.padL;
    if (n === 1) return this.xFromIndex(0);
    if (t <= b[0].t) { const step = b[1].t - b[0].t || 1; return this.xFromIndex((t - b[0].t) / step); }
    if (t >= b[n - 1].t) { const step = b[n - 1].t - b[n - 2].t || 1; return this.xFromIndex((n - 1) + (t - b[n - 1].t) / step); }
    let lo = 0, hi = n - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (b[mid].t <= t) lo = mid; else hi = mid - 1; }
    const frac = (t - b[lo].t) / ((b[lo + 1].t - b[lo].t) || 1);
    return this.xFromIndex(lo + frac);
  };

  // =========================================================================
  //  STATIC RENDER
  // =========================================================================
  // Coalesce bursts to one paint per frame, but fall back to a timer so the
  // chart still renders when rAF is throttled (background tab / headless /
  // some webviews). Whichever of rAF or the timer fires first runs and cancels
  // the other; the `scheduled` flag dedups a burst into a single render.
  PriceChart.prototype.requestRender = function () {
    if (this._rsOn) return;
    this._rsOn = true;
    const self = this;
    const run = function () {
      if (!self._rsOn) return;
      self._rsOn = false;
      if (self._rsRaf) cancelAnimationFrame(self._rsRaf);
      if (self._rsTimer) clearTimeout(self._rsTimer);
      self._rsRaf = self._rsTimer = 0;
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
      if (self._roRaf) cancelAnimationFrame(self._roRaf);
      if (self._roTimer) clearTimeout(self._roTimer);
      self._roRaf = self._roTimer = 0;
      self.drawOverlay();
    };
    this._roRaf = requestAnimationFrame(run);
    this._roTimer = setTimeout(run, 33);
  };

  PriceChart.prototype._theme = function () {
    const cs = getComputedStyle(this.root);
    const g = function (n, fb) { const v = cs.getPropertyValue(n).trim(); return v || fb; };
    this.UP = g('--up', '#2ec27e');
    this.DN = g('--down', '#ff4d4d');
    this.GRID = g('--border', '#1c2128');
    this.GRID2 = g('--border-2', '#2a323d');
    this.AXIS = g('--muted', '#7b8794');
    this.DIM = g('--dim', '#4b5563');
    this.TXT = g('--text', '#d7dde3');
    this.AMBER = g('--amber', '#ff9e16');
    this.CYAN = g('--cyan', '#38bdf8');
    this.font = '10px ' + (cs.getPropertyValue('font-family') || 'monospace');
  };

  PriceChart.prototype.render = function () {
    if (!this.ctx || !this.cssW) return;
    if (!this.bars.length) { this.ctx.clearRect(0, 0, this.cssW, this.cssH); this.drawOverlay(); return; }
    this._theme(); this._layout(); this._computeScales();
    const c = this.ctx;
    c.clearRect(0, 0, this.cssW, this.cssH);
    c.font = this.font; c.textBaseline = 'middle';
    this._drawGrid();
    this._drawPrice();
    if (this.panes.vol) this._drawVolume();
    if (this.panes.rsi) this._drawPaneRSI();
    if (this.panes.macd) this._drawPaneMACD();
    this._drawTimeAxis();
    this._dirtyStatic = false;
    this.drawOverlay();
  };

  PriceChart.prototype._drawGrid = function () {
    const c = this.ctx, P = this.panes.price;
    const step = niceStep(this.yHi - this.yLo, 6);
    const dec = decimalsFor(step);
    c.strokeStyle = this.GRID; c.lineWidth = 1; c.fillStyle = this.AXIS; c.textAlign = 'left';
    let start = Math.ceil(this.yLo / step) * step;
    for (let v = start; v <= this.yHi; v += step) {
      const y = Math.round(this.yPrice(v)) + 0.5;
      if (y < P.y - 1 || y > P.y + P.h + 1) continue;
      c.beginPath(); c.moveTo(P.x, y); c.lineTo(P.x + P.w, y); c.stroke();
      c.fillText(fmtPrice(v, dec), P.x + P.w + 5, y);
    }
    // last price marker line
    const last = this.bars[this.i1 - 1].c;
    if (last != null) {
      const y = Math.round(this.yPrice(last)) + 0.5;
      if (y >= P.y && y <= P.y + P.h) {
        const up = this.bars[this.i1 - 1].c >= this.bars[this.i1 - 1].o;
        c.strokeStyle = up ? this.UP : this.DN; c.setLineDash([2, 2]);
        c.beginPath(); c.moveTo(P.x, y); c.lineTo(P.x + P.w, y); c.stroke(); c.setLineDash([]);
        c.fillStyle = up ? this.UP : this.DN;
        c.fillRect(P.x + P.w + 1, y - 7, this.axisR - 2, 14);
        c.fillStyle = '#040608'; // dark text on the coloured last-price tag
        c.fillText(fmtPrice(last, dec), P.x + P.w + 5, y);
      }
    }
  };

  PriceChart.prototype._drawPrice = function () {
    const c = this.ctx, P = this.panes.price;
    c.save();
    c.beginPath(); c.rect(P.x, P.y, P.w + this.axisR, P.h); c.clip();
    // Bollinger channel first (behind price)
    if (this.ind.bb) this._drawBB();
    if (this.cfg.mode === 'candles' && this.slotW >= 3) this._drawCandles();
    else this._drawLineArea(this.cfg.mode === 'area');
    // MA / EMA overlays
    this.ind.ma.forEach(function (m) { this._polyline(m.data, m.color, 1.3); }, this);
    c.restore();
  };

  PriceChart.prototype._drawCandles = function () {
    const c = this.ctx;
    const cw = this.candleW, half = cw / 2;
    for (let i = this.i0; i < this.i1; i++) {
      const b = this.bars[i];
      const o = b.o != null ? b.o : b.c, cl = b.c, hh = b.h != null ? b.h : Math.max(o, cl), ll = b.l != null ? b.l : Math.min(o, cl);
      const up = cl >= o;
      const col = up ? this.UP : this.DN;
      const cx = Math.round(this.xFromIndex(i)) + 0.5;
      c.strokeStyle = col; c.lineWidth = 1;
      c.beginPath(); c.moveTo(cx, this.yPrice(hh)); c.lineTo(cx, this.yPrice(ll)); c.stroke();
      const yo = this.yPrice(o), yc = this.yPrice(cl);
      const top = Math.min(yo, yc), h = Math.max(1, Math.abs(yo - yc));
      c.fillStyle = col;
      c.fillRect(Math.round(cx - half), Math.round(top), cw, Math.round(h));
    }
  };

  PriceChart.prototype._drawLineArea = function (area) {
    const c = this.ctx, P = this.panes.price;
    const first = this.bars[this.i0].c, last = this.bars[this.i1 - 1].c;
    const col = last >= first ? this.UP : this.DN;
    c.beginPath();
    let started = false;
    for (let i = this.i0; i < this.i1; i++) {
      const x = this.xFromIndex(i), y = this.yPrice(this.bars[i].c);
      if (!started) { c.moveTo(x, y); started = true; } else c.lineTo(x, y);
    }
    if (area) {
      const grad = c.createLinearGradient(0, P.y, 0, P.y + P.h);
      grad.addColorStop(0, this._rgba(col, 0.28)); grad.addColorStop(1, this._rgba(col, 0));
      c.save();
      c.lineTo(this.xFromIndex(this.i1 - 1), P.y + P.h);
      c.lineTo(this.xFromIndex(this.i0), P.y + P.h);
      c.closePath(); c.fillStyle = grad; c.fill();
      c.restore();
      // redraw the top line crisply
      c.beginPath(); started = false;
      for (let i = this.i0; i < this.i1; i++) {
        const x = this.xFromIndex(i), y = this.yPrice(this.bars[i].c);
        if (!started) { c.moveTo(x, y); started = true; } else c.lineTo(x, y);
      }
    }
    c.lineWidth = 1.5; c.strokeStyle = col; c.stroke();
  };

  PriceChart.prototype._polyline = function (data, color, width) {
    const c = this.ctx;
    c.beginPath(); c.lineWidth = width || 1.2; c.strokeStyle = color;
    let started = false;
    for (let i = this.i0; i < this.i1; i++) {
      const v = data[i]; if (v == null) { started = false; continue; }
      const x = this.xFromIndex(i), y = this.yPrice(v);
      if (!started) { c.moveTo(x, y); started = true; } else c.lineTo(x, y);
    }
    c.stroke();
  };

  PriceChart.prototype._drawBB = function () {
    const c = this.ctx, bb = this.ind.bb;
    // faint channel fill between upper and lower
    c.beginPath();
    let started = false;
    for (let i = this.i0; i < this.i1; i++) { const u = bb[i].upper; if (u == null) { continue; } const x = this.xFromIndex(i), y = this.yPrice(u); if (!started) { c.moveTo(x, y); started = true; } else c.lineTo(x, y); }
    for (let i = this.i1 - 1; i >= this.i0; i--) { const l = bb[i].lower; if (l == null) continue; c.lineTo(this.xFromIndex(i), this.yPrice(l)); }
    c.closePath(); c.fillStyle = this._rgba('#7b8794', 0.07); c.fill();
    const band = function (key, dash) {
      c.beginPath(); c.lineWidth = 1; c.strokeStyle = this._rgba('#9aa7b4', 0.7);
      if (dash) c.setLineDash([3, 3]);
      let st = false;
      for (let i = this.i0; i < this.i1; i++) { const v = bb[i][key]; if (v == null) { st = false; continue; } const x = this.xFromIndex(i), y = this.yPrice(v); if (!st) { c.moveTo(x, y); st = true; } else c.lineTo(x, y); }
      c.stroke(); c.setLineDash([]);
    };
    band.call(this, 'upper', false); band.call(this, 'lower', false); band.call(this, 'middle', true);
  };

  PriceChart.prototype._drawVolume = function () {
    const c = this.ctx, V = this.panes.vol;
    const base = V.y + V.h;
    const w = Math.max(1, this.candleW);
    for (let i = this.i0; i < this.i1; i++) {
      const b = this.bars[i]; const v = b.v; if (v == null) continue;
      const up = (b.c != null && b.o != null) ? b.c >= b.o : true;
      const h = (v / this.maxVol) * (V.h - 1);
      const cx = this.xFromIndex(i);
      c.fillStyle = this._rgba(up ? this.UP : this.DN, 0.42);
      c.fillRect(Math.round(cx - w / 2), Math.round(base - h), w, Math.round(h));
    }
    c.fillStyle = this.DIM; c.textAlign = 'left'; c.textBaseline = 'top';
    c.fillText('Vol ' + fmtVol(this.maxVol), V.x + 2, V.y + 2);
    c.textBaseline = 'middle';
  };

  PriceChart.prototype._drawPaneRSI = function () {
    const c = this.ctx, R = this.panes.rsi, data = this.ind.rsi;
    const y = function (v) { return R.y + R.h * (1 - v / 100); };
    // guide lines 70 / 50 / 30
    c.lineWidth = 1; c.textAlign = 'left'; c.fillStyle = this.DIM;
    [[70, this.GRID2], [50, this.GRID], [30, this.GRID2]].forEach(function (g) {
      const yy = Math.round(y(g[0])) + 0.5;
      c.strokeStyle = g[1]; c.setLineDash(g[0] === 50 ? [] : [3, 3]);
      c.beginPath(); c.moveTo(R.x, yy); c.lineTo(R.x + R.w, yy); c.stroke();
      c.fillText(String(g[0]), R.x + R.w + 5, y(g[0]));
    });
    c.setLineDash([]);
    c.beginPath(); c.lineWidth = 1.2; c.strokeStyle = this.AMBER;
    let started = false;
    for (let i = this.i0; i < this.i1; i++) { const v = data[i]; if (v == null) { started = false; continue; } const x = this.xFromIndex(i), yy = y(v); if (!started) { c.moveTo(x, yy); started = true; } else c.lineTo(x, yy); }
    c.stroke();
    c.fillStyle = this.DIM; c.textBaseline = 'top'; c.fillText('RSI 14', R.x + 2, R.y + 2); c.textBaseline = 'middle';
  };

  PriceChart.prototype._drawPaneMACD = function () {
    const c = this.ctx, M = this.panes.macd, d = this.ind.macd;
    let m = 1e-9;
    for (let i = this.i0; i < this.i1; i++) {
      [d.macdLine[i], d.signalLine[i], d.histogram[i]].forEach(function (v) { if (v != null) m = Math.max(m, Math.abs(v)); });
    }
    const y = function (v) { return M.y + M.h * (1 - (v + m) / (2 * m)); };
    const zeroY = Math.round(y(0)) + 0.5;
    c.strokeStyle = this.GRID; c.lineWidth = 1;
    c.beginPath(); c.moveTo(M.x, zeroY); c.lineTo(M.x + M.w, zeroY); c.stroke();
    // histogram
    const w = Math.max(1, this.candleW);
    for (let i = this.i0; i < this.i1; i++) {
      const h = d.histogram[i]; if (h == null) continue;
      const cx = this.xFromIndex(i); const yy = y(h);
      c.fillStyle = this._rgba(h >= 0 ? this.UP : this.DN, 0.5);
      c.fillRect(Math.round(cx - w / 2), Math.min(yy, zeroY), w, Math.max(1, Math.abs(yy - zeroY)));
    }
    const line = function (arr, col) {
      c.beginPath(); c.lineWidth = 1.2; c.strokeStyle = col; let st = false;
      for (let i = this.i0; i < this.i1; i++) { const v = arr[i]; if (v == null) { st = false; continue; } const x = this.xFromIndex(i), yy = y(v); if (!st) { c.moveTo(x, yy); st = true; } else c.lineTo(x, yy); }
      c.stroke();
    };
    line.call(this, d.macdLine, this.CYAN); line.call(this, d.signalLine, this.AMBER);
    c.fillStyle = this.DIM; c.textAlign = 'left'; c.textBaseline = 'top'; c.fillText('MACD 12,26,9', M.x + 2, M.y + 2); c.textBaseline = 'middle';
  };

  PriceChart.prototype._drawTimeAxis = function () {
    const c = this.ctx;
    const y = this.bottomY;
    c.strokeStyle = this.GRID; c.beginPath(); c.moveTo(this.padL, y + 0.5); c.lineTo(this.padL + this.plotW, y + 0.5); c.stroke();
    c.fillStyle = this.AXIS; c.textAlign = 'center'; c.textBaseline = 'top';
    const intraday = /m|h/.test(this.interval);
    const minLabelPx = 64;
    const K = Math.max(1, Math.ceil(minLabelPx / this.slotW));
    let lastRight = -1e9, prevMonth = -1, prevYear = -1, prevDay = -1;
    for (let i = this.i0; i < this.i1; i += K) {
      const b = this.bars[i]; const dt = new Date(b.t);
      let label;
      if (intraday) {
        const hh = String(dt.getHours()).padStart(2, '0'), mm = String(dt.getMinutes()).padStart(2, '0');
        label = (dt.getDate() !== prevDay) ? (MONTHS[dt.getMonth()] + ' ' + dt.getDate()) : (hh + ':' + mm);
        prevDay = dt.getDate();
      } else if (this.interval === '1wk' || this.interval === '1mo') {
        label = (dt.getFullYear() !== prevYear) ? String(dt.getFullYear()) : MONTHS[dt.getMonth()];
        prevYear = dt.getFullYear();
      } else {
        if (dt.getFullYear() !== prevYear) { label = String(dt.getFullYear()); prevYear = dt.getFullYear(); prevMonth = dt.getMonth(); }
        else if (dt.getMonth() !== prevMonth) { label = MONTHS[dt.getMonth()]; prevMonth = dt.getMonth(); }
        else label = MONTHS[dt.getMonth()] + ' ' + dt.getDate();
      }
      const x = this.xFromIndex(i);
      const halfW = c.measureText(label).width / 2;
      if (x - halfW < lastRight + 6) continue;
      if (x + halfW > this.padL + this.plotW) continue;
      c.fillStyle = this.AXIS;
      c.fillText(label, x, y + 4);
      lastRight = x + halfW;
    }
    c.textBaseline = 'middle';
  };

  // =========================================================================
  //  OVERLAY RENDER (crosshair, legend, drawings)
  // =========================================================================
  PriceChart.prototype.drawOverlay = function () {
    if (!this.octx || !this.cssW) return;
    const c = this.octx;
    c.clearRect(0, 0, this.cssW, this.cssH);
    c.font = this.font || '10px monospace';
    this._drawDrawings(c);
    if (this.pending) this._drawOne(c, this.pending, true);
    if (this.inside && !this.dragging && this.hoverIdx >= 0 && this.bars.length) this._drawCrosshair(c);
    else this.legend.style.display = 'none';
  };

  PriceChart.prototype._drawCrosshair = function (c) {
    const P = this.panes.price;
    const i = clamp(this.hoverIdx, this.i0, this.i1 - 1);
    const cx = Math.round(this.xFromIndex(i)) + 0.5;
    const top = P.y, bot = this.bottomY;
    c.save();
    c.strokeStyle = this.AXIS; c.lineWidth = 1; c.setLineDash([3, 3]);
    // vertical across all panes
    c.beginPath(); c.moveTo(cx, top); c.lineTo(cx, bot); c.stroke();
    // horizontal at mouse y (only within plot width)
    if (this.my >= top && this.my <= bot) {
      const hy = Math.round(this.my) + 0.5;
      c.beginPath(); c.moveTo(this.padL, hy); c.lineTo(this.padL + this.plotW, hy); c.stroke();
    }
    c.setLineDash([]);
    // price tag on right axis (only when cursor in price pane)
    if (this.my >= P.y && this.my <= P.y + P.h) {
      const price = this.invYPrice(this.my);
      const txt = fmtPrice(price);
      c.fillStyle = this.GRID2; c.fillRect(P.x + P.w + 1, this.my - 7, this.axisR - 2, 14);
      c.fillStyle = this.AMBER; c.textAlign = 'left'; c.fillText(txt, P.x + P.w + 5, this.my);
    }
    // date tag on bottom axis
    const b = this.bars[i]; const dt = new Date(b.t);
    const intraday = /m|h/.test(this.interval);
    const dlabel = intraday
      ? (MONTHS[dt.getMonth()] + ' ' + dt.getDate() + ' ' + String(dt.getHours()).padStart(2, '0') + ':' + String(dt.getMinutes()).padStart(2, '0'))
      : (MONTHS[dt.getMonth()] + ' ' + dt.getDate() + ' ' + dt.getFullYear());
    c.textAlign = 'center'; c.textBaseline = 'middle';
    const wTag = c.measureText(dlabel).width + 10;
    let tagX = clamp(cx - wTag / 2, this.padL, this.padL + this.plotW - wTag);
    c.fillStyle = this.GRID2; c.fillRect(tagX, bot + 2, wTag, 14);
    c.fillStyle = this.AMBER; c.fillText(dlabel, tagX + wTag / 2, bot + 9);
    c.restore();
    this._updateLegend(i);
  };

  PriceChart.prototype._updateLegend = function (i) {
    const b = this.bars[i];
    const o = b.o != null ? b.o : b.c, hh = b.h != null ? b.h : b.c, ll = b.l != null ? b.l : b.c, cl = b.c;
    const prev = i > 0 ? this.bars[i - 1].c : o;
    const chg = cl - prev, chgPct = prev ? (chg / prev) * 100 : 0;
    const cls = chg >= 0 ? 'up' : 'down';
    const dec = decimalsFor(cl);
    let html = '<span class="k">O</span> ' + fmtPrice(o, dec) +
      '  <span class="k">H</span> ' + fmtPrice(hh, dec) +
      '  <span class="k">L</span> ' + fmtPrice(ll, dec) +
      '  <span class="k">C</span> <span class="' + cls + '">' + fmtPrice(cl, dec) +
      ' ' + (chg >= 0 ? '+' : '') + fmtPrice(chg, dec) + ' (' + (chgPct >= 0 ? '+' : '') + chgPct.toFixed(2) + '%)</span>';
    if (b.v != null) html += '  <span class="k">V</span> ' + fmtVol(b.v);
    // MA values
    this.ind.ma.forEach(function (m) {
      const v = m.data[i];
      if (v != null) html += '  <span style="color:' + m.color + '">' + m.key.toUpperCase() + ' ' + fmtPrice(v, dec) + '</span>';
    });
    this.legend.innerHTML = html;
    this.legend.style.display = 'block';
  };

  // ---- drawings -----------------------------------------------------------
  PriceChart.prototype._drawDrawings = function (c) {
    for (let k = 0; k < this.drawings.length; k++) this._drawOne(c, this.drawings[k], false, k === this.selDrawing);
  };
  PriceChart.prototype._drawOne = function (c, d, preview, selected) {
    const P = this.panes.price;
    c.save();
    c.beginPath(); c.rect(P.x, P.y, P.w, P.h); c.clip();
    const col = preview ? this.AMBER : (selected ? this.CYAN : '#8aa0b5');
    c.lineWidth = selected ? 2 : 1.4; c.strokeStyle = col;
    if (d.type === 'hline') {
      const y = this.yPrice(d.price);
      c.setLineDash([6, 3]); c.beginPath(); c.moveTo(P.x, y); c.lineTo(P.x + P.w, y); c.stroke(); c.setLineDash([]);
      c.fillStyle = col; c.textAlign = 'left'; c.textBaseline = 'bottom';
      c.fillText(fmtPrice(d.price), P.x + 4, y - 2);
    } else if (d.type === 'trend') {
      const ax = this.xFromTime(d.a.t), ay = this.yPrice(d.a.price);
      const bx = this.xFromTime(d.b.t), by = this.yPrice(d.b.price);
      c.beginPath(); c.moveTo(ax, ay); c.lineTo(bx, by); c.stroke();
      if (selected || preview) { c.fillStyle = col; this._dot(c, ax, ay); this._dot(c, bx, by); }
    } else if (d.type === 'fib') {
      this._drawFib(c, d, col, preview || selected);
    }
    c.restore();
  };
  PriceChart.prototype._dot = function (c, x, y) { c.beginPath(); c.arc(x, y, 3, 0, Math.PI * 2); c.fill(); };

  PriceChart.prototype._drawFib = function (c, d, col, anchors) {
    const P = this.panes.price;
    const pA = d.a.price, pB = d.b.price; // 0% at second anchor (b), 100% at first (a)
    const ax = this.xFromTime(d.a.t), bx = this.xFromTime(d.b.t);
    const x0 = Math.min(ax, bx), x1 = P.x + P.w; // span from earliest anchor to right edge
    c.textAlign = 'left'; c.textBaseline = 'middle';
    const dec = decimalsFor(pB || pA || 1);
    for (let k = 0; k < FIB_LEVELS.length; k++) {
      const lv = FIB_LEVELS[k];
      const price = pB + (pA - pB) * lv; // lv=0 -> pB (end), lv=1 -> pA (start)
      const y = this.yPrice(price);
      if (y < P.y - 1 || y > P.y + P.h + 1) continue;
      c.strokeStyle = this._rgba(col, lv === 0 || lv === 1 ? 0.9 : 0.5);
      c.lineWidth = (lv === 0 || lv === 1) ? 1.4 : 1;
      c.beginPath(); c.moveTo(x0, y); c.lineTo(x1, y); c.stroke();
      c.fillStyle = this._rgba(col, 0.95);
      c.fillText((lv * 100).toFixed(1) + '%  ' + fmtPrice(price, dec), x0 + 4, y - 6);
    }
    if (anchors) {
      c.fillStyle = col; this._dot(c, ax, this.yPrice(pA)); this._dot(c, bx, this.yPrice(pB));
      c.strokeStyle = this._rgba(col, 0.6); c.setLineDash([2, 2]);
      c.beginPath(); c.moveTo(ax, this.yPrice(pA)); c.lineTo(bx, this.yPrice(pB)); c.stroke(); c.setLineDash([]);
    }
  };

  // ---- events -------------------------------------------------------------
  PriceChart.prototype._evtXY = function (e) {
    const r = this.overlayCv.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  PriceChart.prototype._pointAt = function (x, y) {
    const i = this.indexAt(x);
    return { t: this.bars[i].t, price: this.invYPrice(y) };
  };

  PriceChart.prototype._onMove = function (e) {
    const p = this._evtXY(e); this.mx = p.x; this.my = p.y; this.inside = true;
    if (this.dragging) { // pan — preserve the window WIDTH captured at drag start,
      const dBars = Math.round((this.dragStartX - p.x) / this.slotW); // clamping at edges
      const span = this.dragSpan;
      let ni0 = this.dragI0 + dBars, ni1 = ni0 + span;
      if (ni0 < 0) { ni0 = 0; ni1 = span; }
      if (ni1 > this.bars.length) { ni1 = this.bars.length; ni0 = ni1 - span; }
      this.setRange(ni0, ni1);
      return;
    }
    if (this.drawingNow && this.pending) {
      if (this.pending.type === 'hline') this.pending.price = this.invYPrice(p.y);
      else this.pending.b = this._pointAt(p.x, p.y);
      this.requestOverlay();
      return;
    }
    this.hoverIdx = this.bars.length ? this.indexAt(p.x) : -1;
    this.requestOverlay();
  };
  PriceChart.prototype._onDown = function (e) {
    if (e.button !== 0) return;
    const p = this._evtXY(e);
    if (this.tool === 'cursor') {
      this.dragging = true; this.dragStartX = p.x; this.dragI0 = this.i0; this.dragSpan = this.i1 - this.i0;
      this.overlayCv.style.cursor = 'grabbing';
      this.legend.style.display = 'none';
    } else {
      this.drawingNow = true;
      if (this.tool === 'hline') this.pending = { type: 'hline', price: this.invYPrice(p.y) };
      else { const a = this._pointAt(p.x, p.y); this.pending = { type: this.tool, a: a, b: { t: a.t, price: a.price } }; }
      this.requestOverlay();
    }
  };
  PriceChart.prototype._onUp = function (e) {
    if (this.dragging) { this.dragging = false; this.overlayCv.style.cursor = this.tool === 'cursor' ? 'crosshair' : 'cell'; this.requestOverlay(); return; }
    if (this.drawingNow && this.pending) {
      const d = this.pending; this.drawingNow = false; this.pending = null;
      let ok = true;
      if (d.type !== 'hline') {
        // discard zero-length (no drag): same bar AND <2px vertical move
        if (d.a.t === d.b.t && Math.abs(this.yPrice(d.a.price) - this.yPrice(d.b.price)) < 2) ok = false;
      }
      if (ok) { this.drawings.push(d); this._saveDrawings(); this.setTool('cursor'); }
      else { this.setTool('cursor'); }
      this.requestOverlay();
    }
  };
  PriceChart.prototype._onLeave = function () { this.inside = false; this.requestOverlay(); };
  PriceChart.prototype._onWheel = function (e) {
    if (!this.bars.length) return;
    e.preventDefault();
    const p = this._evtXY(e);
    const n = this.i1 - this.i0;
    const anchorFrac = clamp((p.x - this.padL) / this.plotW, 0, 1);
    const anchorIdx = this.i0 + anchorFrac * n;
    const factor = e.deltaY < 0 ? 0.85 : 1 / 0.85;
    let newN = clamp(Math.round(n * factor), this._minBars(), this.bars.length);
    let ni0 = Math.round(anchorIdx - anchorFrac * newN);
    let ni1 = ni0 + newN;
    if (ni0 < 0) { ni0 = 0; ni1 = newN; }
    if (ni1 > this.bars.length) { ni1 = this.bars.length; ni0 = ni1 - newN; }
    this.setRange(ni0, ni1);
  };
  PriceChart.prototype._onDblClick = function (e) {
    const p = this._evtXY(e);
    const hit = this._hitTest(p.x, p.y);
    if (hit >= 0) { this.drawings.splice(hit, 1); this.selDrawing = -1; this._saveDrawings(); this.requestOverlay(); }
  };
  PriceChart.prototype._hitTest = function (px, py) {
    const TH = 6;
    for (let k = this.drawings.length - 1; k >= 0; k--) {
      const d = this.drawings[k];
      if (d.type === 'hline') { if (Math.abs(py - this.yPrice(d.price)) <= TH) return k; }
      else if (d.type === 'trend') {
        const ax = this.xFromTime(d.a.t), ay = this.yPrice(d.a.price), bx = this.xFromTime(d.b.t), by = this.yPrice(d.b.price);
        if (distToSeg(px, py, ax, ay, bx, by) <= TH) return k;
      } else if (d.type === 'fib') {
        const x0 = Math.min(this.xFromTime(d.a.t), this.xFromTime(d.b.t));
        if (px < x0 - TH) continue;
        for (let j = 0; j < FIB_LEVELS.length; j++) {
          const price = d.b.price + (d.a.price - d.b.price) * FIB_LEVELS[j];
          if (Math.abs(py - this.yPrice(price)) <= TH) return k;
        }
      }
    }
    return -1;
  };

  // ---- persistence --------------------------------------------------------
  PriceChart.prototype._drawKey = function (sym) { return 'finsight-draw:' + (sym || this.symbol); };
  PriceChart.prototype._loadDrawings = function (sym) {
    try {
      const raw = JSON.parse(localStorage.getItem(this._drawKey(sym)) || '[]');
      if (!Array.isArray(raw)) return [];
      // Drop malformed entries so the overlay paint / hit-test never dereferences
      // an undefined anchor (guards against externally-corrupted localStorage).
      const okPt = function (p) { return p && typeof p.t === 'number' && typeof p.price === 'number'; };
      return raw.filter(function (d) {
        if (!d || typeof d !== 'object') return false;
        if (d.type === 'hline') return typeof d.price === 'number';
        if (d.type === 'trend' || d.type === 'fib') return okPt(d.a) && okPt(d.b);
        return false;
      });
    } catch (e) { return []; }
  };
  PriceChart.prototype._saveDrawings = function () {
    try { localStorage.setItem(this._drawKey(), JSON.stringify(this.drawings)); } catch (e) { /* ignore */ }
  };

  // ---- util ---------------------------------------------------------------
  PriceChart.prototype._rgba = function (col, a) {
    col = (col || '').trim();
    if (col[0] === '#') {
      let h = col.slice(1);
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
      return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
    }
    return col; // non-hex (rgb/named) — return as-is
  };

  PriceChart.prototype.destroy = function () {
    if (this.ro) this.ro.disconnect();
    if (this._onUpWin) window.removeEventListener('mouseup', this._onUpWin);
    if (this._rsRaf) cancelAnimationFrame(this._rsRaf);
    if (this._roRaf) cancelAnimationFrame(this._roRaf);
    if (this._rsTimer) clearTimeout(this._rsTimer);
    if (this._roTimer) clearTimeout(this._roTimer);
  };

  window.PriceChart = PriceChart;
})();
