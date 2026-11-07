// Thesis tracker (FEAT-014 §2): one written thesis per symbol, following the
// owner's policy §6 — role, value mechanism, valuation range, invalidation
// triggers, review cadence and dated checks. FinSight never writes a thesis or a
// verdict on its own; it only stores what the owner enters and reports what is due.
// Stored in DATA_DIR/theses.json (personal), written atomically.
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.ts';
import { ROLES, TRIGGER_KINDS, VERDICTS } from '../shared/theses.ts';
import type { Role, Thesis, ThesisCheck, ThesisReport, ThesisRow, Trigger, TriggerKind, Verdict } from '../shared/theses.ts';
export type { Thesis, ThesisReport, ThesisRow };

const FILE = () => path.join(DATA_DIR, 'theses.json');
const SYMBOL_RE = /^[A-Z0-9.^=\-_:]{1,24}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_TEXT = 2000;
const MAX_CHECKS = 200;

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const num = (v: unknown) => v === '' || v == null ? undefined : typeof v === 'string' ? Number(v) : v;
const text = (v: unknown, max = MAX_TEXT) => typeof v === 'string' ? v.trim().slice(0, max) : '';
export const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const dayMs = (d: string) => Date.parse(d + 'T00:00:00Z');
const addDays = (d: string, n: number) => isoDay(dayMs(d) + n * 86400000);
const validDay = (d: unknown): d is string => typeof d === 'string' && DATE_RE.test(d) && Number.isFinite(dayMs(d)) && isoDay(dayMs(d)) === d;

export function cleanSymbol(v: unknown): string {
  const s = String(v ?? '').trim().toUpperCase();
  if (!SYMBOL_RE.test(s)) throw new Error('A valid symbol is required');
  return s;
}

/** Validate an owner-entered thesis. Checks are kept from `prev`; they are added only through addCheck. */
export function cleanThesis(x: unknown, prev: Thesis | undefined, now = Date.now()): Thesis {
  const t = (x && typeof x === 'object' ? x : {}) as Record<string, any>;
  const symbol = cleanSymbol(t.symbol);
  const role = (ROLES as readonly string[]).includes(t.role) ? t.role as Role : null;
  if (!role) throw new Error('Role must be core, tactical or unclassified');
  const mechanism = text(t.mechanism);
  if (role !== 'unclassified' && !mechanism) throw new Error('Describe how the holding creates value (the mechanism)');
  const triggers: Trigger[] = [];
  for (const g of Array.isArray(t.triggers) ? t.triggers.slice(0, 20) : []) {
    const tx = text(g?.text, 500);
    if (!tx) continue;
    const kind = (TRIGGER_KINDS as readonly string[]).includes(g?.kind) ? g.kind as TriggerKind : 'business';
    triggers.push({ text: tx, kind, urgent: g?.urgent === true });
  }
  if (role !== 'unclassified' && !triggers.length) throw new Error('Add at least one condition that would disprove the thesis');
  const reviewEveryDays = num(t.reviewEveryDays) ?? 90;
  if (!finite(reviewEveryDays) || reviewEveryDays < 1 || reviewEveryDays > 730 || !Number.isInteger(reviewEveryDays)) throw new Error('Review interval must be 1–730 whole days');
  const out: Thesis = {
    symbol, role, mechanism, triggers, reviewEveryDays,
    nextReview: validDay(t.nextReview) ? t.nextReview : prev?.nextReview ?? addDays(isoDay(now), reviewEveryDays),
    checks: prev?.checks ?? [], createdAt: prev?.createdAt ?? now, updatedAt: now,
  };
  const v = t.valuation && typeof t.valuation === 'object' ? t.valuation : {};
  const low = num(v.low), high = num(v.high);
  if (low !== undefined && (!finite(low) || low <= 0)) throw new Error('Valuation low must be a positive number');
  if (high !== undefined && (!finite(high) || high <= 0)) throw new Error('Valuation high must be a positive number');
  if (finite(low) && finite(high) && low > high) throw new Error('Valuation low is above valuation high');
  const val = { low: low as number | undefined, high: high as number | undefined, currency: text(v.currency, 5).toUpperCase() || undefined, note: text(v.note, 500) || undefined };
  if (val.low !== undefined || val.high !== undefined || val.note) out.valuation = Object.fromEntries(Object.entries(val).filter(([, x]) => x !== undefined));
  const mw = num(t.maxWeightPct);
  if (mw !== undefined) {
    if (!finite(mw) || mw <= 0 || mw > 100) throw new Error('Maximum weight must be a percentage above 0 and up to 100');
    out.maxWeightPct = Math.round(mw * 100) / 100;
  }
  return out;
}

function load(): Record<string, Thesis> {
  try {
    const d = JSON.parse(fs.readFileSync(FILE(), 'utf8'));
    return d && typeof d.theses === 'object' && d.theses ? d.theses : {};
  } catch { return {}; }
}
function save(all: Record<string, Thesis>) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = FILE() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ version: 1, theses: all }, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, FILE());
}

export function list(): Thesis[] { return Object.values(load()); }
export function get(symbol: string): Thesis | undefined { return load()[cleanSymbol(symbol)]; }

export function upsert(x: unknown, now = Date.now()): Thesis {
  const all = load();
  const sym = cleanSymbol((x as any)?.symbol);
  const t = cleanThesis(x, all[sym], now);
  all[sym] = t; save(all);
  return t;
}
export function remove(symbol: unknown): boolean {
  const all = load(); const sym = cleanSymbol(symbol);
  if (!all[sym]) return false;
  delete all[sym]; save(all); return true;
}
/** Record a dated review. The next review moves to date + interval. */
export function addCheck(symbol: unknown, x: unknown, now = Date.now()): Thesis {
  const all = load(); const sym = cleanSymbol(symbol);
  const t = all[sym];
  if (!t) throw new Error(`No thesis for ${sym}`);
  const c = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
  const verdict = (VERDICTS as readonly string[]).includes(String(c.verdict)) ? c.verdict as Verdict : null;
  if (!verdict) throw new Error('Verdict must be intact, weakened, broken or insufficient');
  const date = c.date == null || c.date === '' ? isoDay(now) : c.date;
  if (!validDay(date)) throw new Error('Check date must be YYYY-MM-DD');
  if (dayMs(date) > now + 86400000) throw new Error('Check date cannot be in the future');
  const check: ThesisCheck = { date, verdict };
  const note = text(c.note, 1000); if (note) check.note = note;
  t.checks = [check, ...t.checks].sort((a, b) => b.date.localeCompare(a.date)).slice(0, MAX_CHECKS);
  t.nextReview = addDays(t.checks[0]!.date, t.reviewEveryDays);
  t.updatedAt = now;
  save(all); return t;
}

export interface Holding { symbol: string; weight: number; last: number; currency: string }
/** Pure: join theses with current holdings. Held symbols without a thesis are listed; theses on sold symbols stay. */
export function report(holdings: Holding[], theses: Thesis[], now = Date.now()): ThesisReport {
  const today = isoDay(now);
  const held = new Map<string, Holding>();
  for (const h of holdings) {
    const k = h.symbol.toUpperCase(), cur = held.get(k);
    held.set(k, cur ? { ...cur, weight: cur.weight + h.weight } : { ...h, symbol: k });
  }
  const bySym = new Map(theses.map((t) => [t.symbol, t]));
  const syms = [...new Set([...held.keys(), ...bySym.keys()])];
  const rows: ThesisRow[] = syms.map((s) => {
    const h = held.get(s), t = bySym.get(s) ?? null;
    const dueInDays = t ? Math.round((dayMs(t.nextReview) - dayMs(today)) / 86400000) : null;
    let vsValuation: ThesisRow['vsValuation'] = null;
    const v = t?.valuation;
    if (h && v && (v.low !== undefined || v.high !== undefined) && (!v.currency || v.currency === h.currency)) {
      vsValuation = v.low !== undefined && h.last < v.low ? 'below' : v.high !== undefined && h.last > v.high ? 'above' : 'within';
    }
    const weightPct = h ? Math.round(h.weight * 100) / 100 : null;
    return { symbol: s, held: !!h, weightPct, last: h?.last ?? null, currency: h?.currency ?? null, thesis: t, dueInDays, vsValuation,
      overMaxWeight: !!(t?.maxWeightPct && weightPct != null && weightPct > t.maxWeightPct) };
  });
  // Overdue first, then due soonest, then held without a thesis, then by weight.
  const rank = (r: ThesisRow) => r.thesis ? 0 : r.held ? 1 : 2;
  rows.sort((a, b) => rank(a) - rank(b) || (a.dueInDays ?? 1e9) - (b.dueInDays ?? 1e9) || (b.weightPct ?? 0) - (a.weightPct ?? 0) || a.symbol.localeCompare(b.symbol));
  const counts = {
    held: rows.filter((r) => r.held).length,
    withThesis: rows.filter((r) => r.held && r.thesis).length,
    overdue: rows.filter((r) => r.dueInDays != null && r.dueInDays < 0).length,
    broken: rows.filter((r) => r.thesis?.checks[0]?.verdict === 'broken').length,
  };
  return { asOf: now, today, rows, counts };
}
