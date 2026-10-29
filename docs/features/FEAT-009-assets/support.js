// Minimal local runtime for the FEAT-009 design mockups (*.dc.html), so they open
// straight from disk without the design canvas. It supports only what these files
// use: {{dotted.path}} holes, <sc-for>, <sc-if>, on* handlers, <helmet>, and a
// `class Component extends DCLogic` with state, setState and componentDidMount.
// Props come from each file's data-props defaults, overridden by the URL query,
// e.g. KestrelCards.dc.html?theme=light&stage=done
(function () {
  class DCLogic {
    constructor(props) { this.props = props; this.state = {}; }
    setState(update) {
      const patch = typeof update === 'function' ? update(this.state, this.props) : update;
      this.state = Object.assign({}, this.state, patch);
      schedule();
    }
    forceUpdate() { schedule(); }
  }

  let template = null, host = null, comp = null, queued = false;
  const HOLE = /\{\{\s*([^}]+?)\s*\}\}/g;
  const WHOLE = /^\{\{\s*([^}]+?)\s*\}\}$/;

  function lookup(expr, scope) {
    const e = expr.trim();
    if (e === 'true') return true;
    if (e === 'false') return false;
    if (e === 'null') return null;
    if (/^-?\d+(\.\d+)?$/.test(e)) return Number(e);
    if (/^(['"]).*\1$/.test(e)) return e.slice(1, -1);
    return e.split('.').reduce((v, k) => (v == null ? undefined : v[k]), scope);
  }
  const str = (v) => (v == null || v === false ? '' : String(v));

  function render(node, scope, out) {
    if (node.nodeType === 3) { out.push(document.createTextNode(node.data.replace(HOLE, (_, p) => str(lookup(p, scope))))); return; }
    if (node.nodeType !== 1) return;
    const tag = node.tagName.toLowerCase();
    if (tag === 'helmet') return;
    if (tag === 'sc-for') {
      const list = lookup((WHOLE.exec(node.getAttribute('list') || '') || [])[1] || '', scope) || [];
      const as = node.getAttribute('as') || 'item';
      list.forEach((item, i) => { const s = Object.assign({}, scope, { [as]: item, $index: i }); node.childNodes.forEach((c) => render(c, s, out)); });
      return;
    }
    if (tag === 'sc-if') {
      if (lookup((WHOLE.exec(node.getAttribute('value') || '') || [])[1] || '', scope)) node.childNodes.forEach((c) => render(c, scope, out));
      return;
    }
    const el = node.namespaceURI === 'http://www.w3.org/2000/svg' ? document.createElementNS(node.namespaceURI, node.tagName) : document.createElement(tag);
    el._h = {};
    for (const a of node.attributes) {
      if (a.name.startsWith('hint-')) continue;
      const whole = WHOLE.exec(a.value);
      if (whole && /^on[a-z]/i.test(a.name)) { el._h[a.name.slice(2).toLowerCase()] = lookup(whole[1], scope); continue; }
      const v = whole ? lookup(whole[1], scope) : a.value.replace(HOLE, (_, p) => str(lookup(p, scope)));
      if (v === undefined || v === null) continue;
      el.setAttribute(a.name, typeof v === 'boolean' ? String(v) : String(v));
    }
    const kids = [];
    node.childNodes.forEach((c) => render(c, scope, kids));
    kids.forEach((k) => el.appendChild(k));
    out.push(el);
  }

  // Patch the live DOM in place so CSS animations keep running between renders.
  function bind(el) {
    if (!el._h) return;
    el._bound = el._bound || {};
    for (const type of Object.keys(el._h)) if (!el._bound[type]) {
      el._bound[type] = true;
      el.addEventListener(type, (e) => { const f = el._h && el._h[type]; if (typeof f === 'function') f(e); });
    }
  }
  function bindAll(el) { if (el.nodeType !== 1) return; bind(el); el.childNodes.forEach(bindAll); }
  function morph(a, b) {
    if (a.nodeType !== b.nodeType || a.nodeName !== b.nodeName) { a.replaceWith(b); bindAll(b); return; }
    if (a.nodeType === 3) { if (a.data !== b.data) a.data = b.data; return; }
    for (const at of [...a.attributes]) if (!b.hasAttribute(at.name)) a.removeAttribute(at.name);
    for (const at of b.attributes) if (a.getAttribute(at.name) !== at.value) a.setAttribute(at.name, at.value);
    a._h = b._h; bind(a);
    morphChildren(a, b);
  }
  function morphChildren(a, b) {
    const ak = [...a.childNodes], bk = [...b.childNodes];
    bk.forEach((n, i) => { if (ak[i]) morph(ak[i], n); else { a.appendChild(n); bindAll(n); } });
    for (let i = bk.length; i < ak.length; i++) ak[i].remove();
  }

  function paint() {
    queued = false;
    const vals = comp.renderVals() || {};
    const out = [];
    template.childNodes.forEach((c) => render(c, vals, out));
    const next = document.createElement('div');
    out.forEach((n) => next.appendChild(n));
    morphChildren(host, next);
  }
  function schedule() { if (!queued && template) { queued = true; requestAnimationFrame(paint); } }

  function boot() {
    const xdc = document.querySelector('x-dc');
    const script = document.querySelector('script[data-dc-script]');
    if (!xdc || !script) return;
    const helmet = xdc.querySelector('helmet');
    if (helmet) [...helmet.children].forEach((c) => document.head.appendChild(c.cloneNode(true)));
    template = xdc.cloneNode(true);
    host = document.createElement('div');
    xdc.replaceWith(host);

    let spec = {};
    try { spec = JSON.parse(script.getAttribute('data-props') || '{}'); } catch (e) { /* no props */ }
    const props = {};
    for (const [k, v] of Object.entries(spec)) if (k[0] !== '$' && v && 'default' in v) props[k] = v.default;
    for (const [k, v] of new URLSearchParams(location.search)) props[k] = /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v;

    const Component = new Function('DCLogic', script.textContent + '\nreturn Component;')(DCLogic);
    comp = new Component(props);
    comp.props = props;
    comp.state = comp.state || {};
    paint();
    if (typeof comp.componentDidMount === 'function') comp.componentDidMount();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
