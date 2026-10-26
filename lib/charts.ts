// Chart workspace persistence: drawings per symbol, the current chart settings
// and named layouts. Stored in DATA_DIR/charts.json (outside the repo for a
// personal profile), written atomically.
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.ts';

/** Untrusted JSON from a request body or the workspace file. */
type Loose = Record<string, any>;
export interface Drawing {
  id: string | null; type: string; pts: { t: number; p: number }[];
  style: { color: string | undefined; width: number | undefined; dash: string | undefined };
  text?: string; locked?: true; hidden?: true;
}
/** Opaque UI settings (validated for size and shape only). */
export type ChartCfg = Loose;
interface Workspace { version: 1; drawings: Record<string, Drawing[]>; layouts: Record<string, ChartCfg>; current: ChartCfg | null }

const FILE = () => path.join(DATA_DIR, 'charts.json');
const MAX_DRAWINGS = 500;
const MAX_LAYOUTS = 50;
const MAX_BYTES = 4e6;
const SYMBOL_RE = /^[A-Za-z0-9.^=\-_:]{1,24}$/;
const NAME_RE = /^[\w .\-()&+]{1,40}$/;

function empty(): Workspace { return { version: 1, drawings: {}, layouts: {}, current: null }; }

function load(): Workspace {
  try {
    const d = JSON.parse(fs.readFileSync(FILE(), 'utf8'));
    if (!d || typeof d !== 'object') return empty();
    return { version: 1, drawings: d.drawings && typeof d.drawings === 'object' ? d.drawings : {},
      layouts: d.layouts && typeof d.layouts === 'object' ? d.layouts : {}, current: d.current || null };
  } catch { return empty(); }
}

function save(d: Workspace) {
  const text = JSON.stringify(d);
  if (text.length > MAX_BYTES) throw new Error('Chart workspace too large');
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = FILE() + '.tmp';
  fs.writeFileSync(tmp, text, { mode: 0o600 }); // drawings can carry personal notes
  fs.renameSync(tmp, FILE());
}

const finite = (v: unknown): v is number => typeof v === 'number' && isFinite(v);

// Accept only well-formed drawings; unknown fields are dropped.
export function cleanDrawing(d: Loose | null | undefined): Drawing | null {
  if (!d || typeof d !== 'object' || typeof d.type !== 'string' || !/^[a-z0-9]{2,16}$/i.test(d.type)) return null;
  if (!Array.isArray(d.pts) || d.pts.length < 1 || d.pts.length > (d.type === "brush" ? 400 : 5)) return null;
  const pts = d.pts.map((p: Loose | null) => (p && finite(p.t) && finite(p.p) ? { t: p.t, p: p.p } : null));
  if (pts.some((p: unknown) => !p)) return null;
  const st: Loose = d.style && typeof d.style === 'object' ? d.style : {};
  const out: Drawing = {
    id: typeof d.id === 'string' && /^[\w-]{1,40}$/.test(d.id) ? d.id : null,
    type: d.type, pts: pts as Drawing['pts'], // no nulls: checked above
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

export function getDrawings(symbol: string | null | undefined): Drawing[] {
  if (!SYMBOL_RE.test(String(symbol || ''))) throw new Error('Bad symbol');
  return load().drawings[symbol!.toUpperCase()] || [];
}

export function putDrawings(symbol: unknown, drawings: unknown): number {
  if (!SYMBOL_RE.test(String(symbol || ''))) throw new Error('Bad symbol');
  if (!Array.isArray(drawings)) throw new Error('drawings must be an array');
  const sym = (symbol as string).toUpperCase();
  const clean = drawings.slice(0, MAX_DRAWINGS).map(cleanDrawing).filter((x): x is Drawing => Boolean(x));
  const d = load();
  if (clean.length) d.drawings[sym] = clean;
  else delete d.drawings[sym];
  save(d);
  return clean.length;
}

// Layout/current config is opaque UI settings: bound its size and shape only.
function cleanCfg(cfg: unknown): ChartCfg {
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) throw new Error('layout must be an object');
  const text = JSON.stringify(cfg);
  if (text.length > 20000) throw new Error('layout too large');
  return JSON.parse(text);
}

export function getLayouts() { const d = load(); return { layouts: d.layouts, current: d.current }; }

export function putCurrent(cfg: unknown): void { const d = load(); d.current = cleanCfg(cfg); save(d); }

export function saveLayout(name: unknown, cfg: unknown): void {
  const n = String(name || '');
  // '__proto__' would set the object's prototype instead of creating an own
  // key, so the layout would silently never be stored.
  if (!NAME_RE.test(n) || n === '__proto__') throw new Error('Layout name: 1–40 letters, numbers, spaces or . - ( ) & +');
  const d = load();
  const key = name as string;
  if (!d.layouts[key] && Object.keys(d.layouts).length >= MAX_LAYOUTS) throw new Error('Too many layouts');
  d.layouts[key] = Object.assign(cleanCfg(cfg), { savedAt: Date.now() });
  save(d);
}

export function deleteLayout(name: unknown): boolean {
  const d = load();
  if (!((name as string) in d.layouts)) return false;
  delete d.layouts[name as string]; save(d); return true;
}
