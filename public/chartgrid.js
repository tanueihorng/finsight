/* ===========================================================================
 *  chartgrid.js — FinSight multi-chart workspace (1 / 2 / 4 charts)
 * ---------------------------------------------------------------------------
 *  Wraps the main PriceChart. With 2 or 4 charts the workspace opens full
 *  screen: the main chart moves into slot 1 and secondary charts fill the
 *  rest. Each secondary keeps its own timeframe and indicators (its own
 *  browser settings key); symbols can be linked, crosshairs synced by date.
 *  Drawings stay shared per symbol through the chart's save events.
 *  Exposes window.ChartGrid.
 * ======================================================================== */
(function () {
  'use strict';
  const KEY = 'finsight-grid';
  const DEFAULT_IVS = ['1wk', '60m', '1mo'];
  const TF_RANGE = { '1m': '5d', '5m': '1mo', '15m': '1mo', '60m': '1y', '1d': '5y', '1wk': '10y', '1mo': '30y' };

  function loadState() {
    let s = {};
    try { s = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { s = {}; }
    return {
      n: [1, 2, 4].indexOf(s.n) >= 0 ? s.n : 1,
      linkSym: s.linkSym !== false, syncCross: s.syncCross !== false,
      ivs: Array.isArray(s.ivs) ? s.ivs.slice(0, 3).map(function (v, k) { return TF_RANGE[v] ? v : DEFAULT_IVS[k]; }) : DEFAULT_IVS.slice(),
      syms: Array.isArray(s.syms) ? s.syms.slice(0, 3).map(function (v) { return typeof v === 'string' && /^[A-Za-z0-9.^=\-_:]{1,24}$/.test(v) ? v : null; }) : [],
    };
  }

  // opts: { loader(sym, interval) -> Promise<{points, meta}>, onMainSymbol(sym), setupChart(chart) }
  function ChartGrid(opts) {
    this.opts = opts || {};
    this.main = null;
    this.st = loadState();
    this.st.n = 1; // the workspace always starts as one chart; 2 / 4 open on request
    this.subs = [];
    this.wrap = null;
    this._timer = 0;
  }
  ChartGrid.prototype._save = function () {
    try { localStorage.setItem(KEY, JSON.stringify({ n: this.st.n, linkSym: this.st.linkSym, syncCross: this.st.syncCross, ivs: this.st.ivs, syms: this.st.syms })); } catch (e) { /* ignore */ }
  };
  // (re)attach to the host's main chart; called whenever the host creates it
  ChartGrid.prototype.attach = function (chart) {
    const self = this;
    this.main = chart;
    chart.gridState = this.st;
    chart.onGrid = function (o) { self.set(o); };
    chart.onCrosshair = function (t) { self._cross(chart, t); };
  };
  ChartGrid.prototype.charts = function () { return [this.main].concat(this.subs.map(function (s) { return s.chart; })).filter(Boolean); };
  ChartGrid.prototype._cross = function (src, t) {
    if (!this.st.syncCross || this.st.n === 1) return;
    this.charts().forEach(function (c) { if (c !== src) c.setExtCrosshair(t); });
  };
  ChartGrid.prototype.set = function (o) {
    if ('linkSym' in o) { this.st.linkSym = !!o.linkSym; if (this.st.linkSym) this.syncSymbols(); }
    if ('syncCross' in o) { this.st.syncCross = !!o.syncCross; if (!o.syncCross) this.charts().forEach(function (c) { c.setExtCrosshair(null); }); }
    if ('n' in o) this.setN(o.n);
    this._save();
    this.charts().forEach(function (c) { c.gridState = this.st; if (c.menuKind === 'grid') c._renderGridMenu(); }, this);
  };
  ChartGrid.prototype.setN = function (n) {
    const m = this.main; if (!m) return;
    n = [1, 2, 4].indexOf(n) >= 0 ? n : 1;
    if (n === this.st.n && (n === 1 || this.wrap)) return;
    this.st.n = n;
    if (n === 1) { this._teardown(); this._save(); return; }
    if (m.maxed) m.toggleMax(false);
    if (!this.wrap) {
      this.wrap = document.createElement('div');
      this.wrap.className = 'pc-grid';
      document.body.appendChild(this.wrap);
      document.body.classList.add('chart-max-open');
      this._home = { parent: m.root.parentNode, next: m.root.nextSibling };
    }
    this.wrap.dataset.n = n;
    // slot 0 holds the main chart; build or drop secondaries to reach n
    while (this.subs.length > n - 1) this._dropSub();
    if (!this.wrap.firstChild || this.wrap.firstChild.firstChild !== m.root) {
      const s0 = document.createElement('div'); s0.className = 'pc-gslot';
      this.wrap.insertBefore(s0, this.wrap.firstChild); s0.appendChild(m.root);
    }
    while (this.subs.length < n - 1) this._addSub(this.subs.length);
    const self = this;
    this.charts().forEach(function (c) {
      c.fit = true;
      c.onMax = function () { self.set({ n: 1 }); };
      c.onEscape = function () { self.set({ n: 1 }); };
      c.maxBtn.title = 'Back to one chart (Esc)';
      c.resize();
    });
    clearInterval(this._timer);
    this._timer = setInterval(function () { self.subs.forEach(function (s) { self._loadSub(s, true); }); }, 60000);
    this._save();
  };
  ChartGrid.prototype._addSub = function (k) {
    const slot = document.createElement('div'); slot.className = 'pc-gslot';
    const host = document.createElement('div'); slot.appendChild(host);
    this.wrap.appendChild(slot);
    const chart = new window.PriceChart(host, { cfgKey: 'finsight-chart-cfg-g' + (k + 1) });
    const sub = { chart: chart, slot: slot, k: k, interval: this.st.ivs[k] || DEFAULT_IVS[k], symbol: null };
    const self = this;
    chart.gridState = this.st;
    chart.onGrid = function (o) { self.set(o); };
    chart.onCrosshair = function (t) { self._cross(chart, t); };
    chart.onRequest = function (r) { sub.interval = r.interval; self.st.ivs[k] = r.interval; self._save(); self._loadSub(sub); };
    chart.onSymbol = function (sym) {
      if (self.st.linkSym) { if (self.opts.onMainSymbol) self.opts.onMainSymbol(sym); }
      else { sub.symbol = sym; self.st.syms[k] = sym; self._save(); self._loadSub(sub); }
    };
    if (this.opts.setupChart) this.opts.setupChart(chart);
    this.subs.push(sub);
    this._loadSub(sub);
  };
  ChartGrid.prototype._dropSub = function () {
    const s = this.subs.pop(); if (!s) return;
    s.chart.destroy(); s.slot.remove();
  };
  ChartGrid.prototype._symFor = function (sub) { return this.st.linkSym || !this.st.syms[sub.k] ? this.main.symbol : this.st.syms[sub.k]; };
  ChartGrid.prototype._loadSub = function (sub, refresh) {
    const sym = this._symFor(sub), iv = sub.interval, self = this;
    if (!sym || !this.opts.loader) return;
    const token = (sub.token = (sub.token || 0) + 1);
    this.opts.loader(sym, iv, TF_RANGE[iv] || '1y').then(function (h) {
      if (token !== sub.token || self.subs.indexOf(sub) < 0) return;
      sub.symbol = sym;
      sub.chart.load(sym, h.points || [], h.meta || {}, { interval: iv, range: TF_RANGE[iv] || '1y', fetchRange: TF_RANGE[iv] || '1y' });
    }).catch(function (e) { if (!refresh) sub.chart._flash('Could not load ' + sym + ': ' + e.message, true); });
  };
  // main chart changed symbol: linked secondaries follow
  ChartGrid.prototype.syncSymbols = function () {
    if (this.st.n === 1) return;
    const self = this;
    this.subs.forEach(function (s) { if (self._symFor(s) !== s.symbol) self._loadSub(s); });
  };
  ChartGrid.prototype._teardown = function () {
    clearInterval(this._timer);
    while (this.subs.length) this._dropSub();
    const m = this.main;
    if (m) {
      m.fit = false; m.onMax = null; m.onEscape = null; m.maxBtn.title = 'Expand chart (Esc to exit)';
      m.setExtCrosshair(null);
      if (this._home && this._home.parent) this._home.parent.insertBefore(m.root, this._home.next && this._home.next.parentNode === this._home.parent ? this._home.next : null);
    }
    if (this.wrap) { this.wrap.remove(); this.wrap = null; }
    document.body.classList.remove('chart-max-open');
    this._home = null;
    if (m) m.resize();
  };
  ChartGrid.prototype.active = function () { return this.st.n > 1; };

  window.ChartGrid = ChartGrid;
})();
