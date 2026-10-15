'use strict';
// Chart workspace persistence: drawings per symbol, the current chart settings
// and named layouts. Stored in DATA_DIR/charts.json (outside the repo for a
// personal profile), written atomically.
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./config');

const FILE = () => path.join(DATA_DIR, 'charts.json');
const MAX_DRAWINGS = 500;
const MAX_LAYOUTS = 50;
const MAX_BYTES = 4e6;
const SYMBOL_RE = /^[A-Za-z0-9.^=\-_:]{1,24}$/;
const NAME_RE = /^[\w .\-()&+]{1,40}$/;

function empty() { return { version: 1, drawings: {}, layouts: {}, current: null }; }

function load() {
  try {
    const d = JSON.parse(fs.readFileSync(FILE(), 'utf8'));
    if (!d || typeof d !== 'object') return empty();
    return { version: 1, drawings: d.drawings && typeof d.drawings === 'object' ? d.drawings : {},
      layouts: d.layouts && typeof d.layouts === 'object' ? d.layouts : {}, current: d.current || null };
  } catch { return empty(); }
}

function save(d) {
  const text = JSON.stringify(d);
  if (text.length > MAX_BYTES) throw new Error('Chart workspace too large');
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = FILE() + '.tmp';
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, FILE());
}

const finite = (v) => typeof v === 'number' && isFinite(v);

// Accept only well-formed drawings; unknown fields are dropped.
function cleanDrawing(d) {
  if (!d || typeof d !== 'object' || typeof d.type !== 'string' || !/^[a-z0-9]{2,16}$/i.test(d.type)) return null;
  if (!Array.isArray(d.pts) || d.pts.length < 1 || d.pts.length > 5) return null;
  const pts = d.pts.map((p) => (p && finite(p.t) && finite(p.p) ? { t: p.t, p: p.p } : null));
  if (pts.some((p) => !p)) return null;
  const st = d.style && typeof d.style === 'object' ? d.style : {};
  const out = {
    id: typeof d.id === 'string' && /^[\w-]{1,40}$/.test(d.id) ? d.id : null,
    type: d.type, pts,
    style: {
      color: typeof st.color === 'string' && /^#[0-9a-f]{6}$/i.test(st.color) ? st.color : undefined,
      width: [1, 2, 3, 4].includes(st.width) ? st.width : undefined,
      dash: ['solid', 'dash', 'dot'].includes(st.dash) ? st.dash : undefined,
    },
  };
  if (typeof d.text === 'string') out.text = d.text.slice(0, 500);
  if (d.locked === true) out.locked = true;
  if (d.hidden === true) out.hidden = true;
  return out.id ? out : null;
}

function getDrawings(symbol) {
  if (!SYMBOL_RE.test(String(symbol || ''))) throw new Error('Bad symbol');
  return load().drawings[symbol.toUpperCase()] || [];
}

function putDrawings(symbol, drawings) {
  if (!SYMBOL_RE.test(String(symbol || ''))) throw new Error('Bad symbol');
  if (!Array.isArray(drawings)) throw new Error('drawings must be an array');
  const clean = drawings.slice(0, MAX_DRAWINGS).map(cleanDrawing).filter(Boolean);
  const d = load();
  if (clean.length) d.drawings[symbol.toUpperCase()] = clean;
  else delete d.drawings[symbol.toUpperCase()];
  save(d);
  return clean.length;
}

// Layout/current config is opaque UI settings: bound its size and shape only.
function cleanCfg(cfg) {
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) throw new Error('layout must be an object');
  const text = JSON.stringify(cfg);
  if (text.length > 20000) throw new Error('layout too large');
  return JSON.parse(text);
}

function getLayouts() { const d = load(); return { layouts: d.layouts, current: d.current }; }

function putCurrent(cfg) { const d = load(); d.current = cleanCfg(cfg); save(d); }

function saveLayout(name, cfg) {
  if (!NAME_RE.test(String(name || ''))) throw new Error('Layout name: 1–40 letters, numbers, spaces or . - ( ) & +');
  const d = load();
  if (!d.layouts[name] && Object.keys(d.layouts).length >= MAX_LAYOUTS) throw new Error('Too many layouts');
  d.layouts[name] = Object.assign(cleanCfg(cfg), { savedAt: Date.now() });
  save(d);
}

function deleteLayout(name) {
  const d = load();
  if (!(name in d.layouts)) return false;
  delete d.layouts[name]; save(d); return true;
}

module.exports = { getDrawings, putDrawings, getLayouts, putCurrent, saveLayout, deleteLayout, cleanDrawing };
