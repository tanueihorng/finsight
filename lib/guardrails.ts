// Policy guardrails (FEAT-017): compares the book's live exposures with limits
// the user enters. FinSight never invents a limit: every kind starts UNSET, and a
// limit is "proposed" until the user marks it "accepted". A breach is a flag for
// review, never an order. Limits live in DATA_DIR/guardrails.json (personal,
// outside the repo), written atomically.
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.ts';

import { KINDS } from '../shared/guardrails.ts';
import type { Kind, Limit, LimitStatus, CheckState, Observation, Check, GuardrailInput, GuardrailReport } from '../shared/guardrails.ts';
export { KINDS };
export type { Kind, Limit, LimitStatus, CheckState, Observation, Check, GuardrailInput, GuardrailReport };

const FILE = () => path.join(DATA_DIR, 'guardrails.json');
const SYMBOL_RE = /^[A-Z0-9.^=\-_:]{1,24}$/;
/** A reading within this share of its limit (e.g. 22.5% against 25%) is "near". */
export const NEAR = 0.9;

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const r2 = (v: number) => Math.round(v * 100) / 100;

/** Validate one limit from an untrusted body or file; throws a readable message. */
export function cleanLimit(x: unknown, now = Date.now()): Limit {
  const l = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
  const kind = String(l.kind) as Kind;
  if (!(kind in KINDS)) throw new Error(`Unknown limit kind: ${String(l.kind)}`);
  const pct = typeof l.pct === 'string' ? Number(l.pct) : l.pct;
  if (!finite(pct) || pct < 0 || pct > 100) throw new Error(`${KINDS[kind].label}: limit must be a percentage from 0 to 100`);
  const status = l.status === 'accepted' ? 'accepted' : l.status === 'proposed' || l.status == null ? 'proposed' : null;
  if (!status) throw new Error('Status must be proposed or accepted');
  const out: Limit = { kind, pct: r2(pct), status, updatedAt: finite(l.updatedAt) ? l.updatedAt : now };
  if (kind === 'symbolMax') {
    const sym = String(l.symbol ?? '').trim().toUpperCase();
    if (!SYMBOL_RE.test(sym)) throw new Error('Named holding needs a valid symbol');
    out.symbol = sym;
  }
  const note = typeof l.note === 'string' ? l.note.trim().slice(0, 200) : '';
  if (note) out.note = note;
  return out;
}

/** One limit per kind (per symbol for named holdings); the later entry wins. */
export function cleanLimits(list: unknown, now = Date.now()): Limit[] {
  if (!Array.isArray(list)) throw new Error('limits must be a list');
  if (list.length > 100) throw new Error('Too many limits');
  const byKey = new Map<string, Limit>();
  for (const x of list) { const l = cleanLimit(x, now); byKey.set(l.kind + ':' + (l.symbol ?? ''), l); }
  const lim = [...byKey.values()];
  const min = lim.find((l) => l.kind === 'cashMin'), max = lim.find((l) => l.kind === 'cashMax');
  if (min && max && min.pct > max.pct) throw new Error('Cash floor is above the cash ceiling');
  return lim;
}

export function loadLimits(): Limit[] {
  let raw: string;
  try { raw = fs.readFileSync(FILE(), 'utf8'); } catch { return []; }
  try {
    const d = JSON.parse(raw);
    const out: Limit[] = [];
    for (const x of Array.isArray(d?.limits) ? d.limits : []) { try { out.push(cleanLimit(x)); } catch { /* drop a malformed entry */ } }
    return out;
  } catch { return []; }
}

/** Replace the stored limits. Unchanged entries keep their updatedAt. */
export function saveLimits(list: unknown): Limit[] {
  const prev = new Map(loadLimits().map((l) => [l.kind + ':' + (l.symbol ?? ''), l]));
  const now = Date.now();
  const next = cleanLimits(list, now).map((l) => {
    const p = prev.get(l.kind + ':' + (l.symbol ?? ''));
    return p && p.pct === l.pct && p.status === l.status && p.note === l.note ? { ...l, updatedAt: p.updatedAt } : { ...l, updatedAt: now };
  });
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = FILE() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ version: 1, limits: next }, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, FILE());
  return next;
}

/** Pure: evaluate every kind against the exposures. Kinds without a limit are reported UNSET. */
export function evaluate(input: GuardrailInput, limits: Limit[], now = Date.now()): GuardrailReport {
  const base = input.base;
  const posValue = input.positions.reduce((s, p) => s + (finite(p.marketValue) ? p.marketValue : 0), 0);
  const cashValue = input.cash.reduce((s, c) => s + (finite(c.base) ? c.base : 0), 0);
  const netWorth = posValue + cashValue;
  const notes: string[] = [];
  const ok = netWorth > 0;
  if (!ok) notes.push('Net worth is zero or negative, so no weights can be computed.');
  const pctOf = (v: number) => ok ? r2((v / netWorth) * 100) : 0;
  const obs = (key: string, value: number): Observation => ({ key, value: r2(value), pct: pctOf(value) });

  // Same symbol in several accounts counts once (issuer exposure, not account rows).
  const bySymbol = new Map<string, number>();
  for (const p of input.positions) bySymbol.set(p.symbol.toUpperCase(), (bySymbol.get(p.symbol.toUpperCase()) ?? 0) + (finite(p.marketValue) ? p.marketValue : 0));
  const holdings = [...bySymbol].map(([k, v]) => obs(k, v)).sort((a, b) => b.value - a.value);
  const byCcy = new Map<string, number>();
  for (const p of input.positions) byCcy.set(p.currency, (byCcy.get(p.currency) ?? 0) + (finite(p.marketValue) ? p.marketValue : 0));
  for (const c of input.cash) byCcy.set(c.ccy, (byCcy.get(c.ccy) ?? 0) + (finite(c.base) ? c.base : 0));
  const foreign = [...byCcy].filter(([k]) => k !== base).map(([k, v]) => obs(k, v)).sort((a, b) => b.value - a.value);
  const accounts = input.accounts.map((a) => obs(a.name, a.netWorth)).sort((a, b) => b.value - a.value);
  const cash = obs('Cash', cashValue);

  const unquoted = input.positions.filter((p) => p.quoted === false).map((p) => p.symbol);
  if (unquoted.length) notes.push(`No live quote for ${[...new Set(unquoted)].join(', ')}: their stored price is used.`);
  notes.push('Funds count as one holding each; their underlying companies are not looked through, so true single-company exposure can be higher.');

  const limitFor = (kind: Kind, symbol?: string) => limits.find((l) => l.kind === kind && (kind !== 'symbolMax' || l.symbol === symbol));
  const check = (kind: Kind, rows: Observation[], dir: 'max' | 'min', symbol?: string): Check => {
    const l = limitFor(kind, symbol);
    const label = symbol ? `${symbol}` : KINDS[kind].label;
    const worst = rows.length ? (dir === 'max' ? rows.reduce((a, b) => b.pct > a.pct ? b : a) : rows.reduce((a, b) => b.pct < a.pct ? b : a)) : null;
    let state: CheckState = 'unset', over: Observation[] = [];
    if (l) {
      if (!ok) state = 'no-data';
      else if (dir === 'max') {
        over = rows.filter((r) => r.pct > l.pct);
        state = over.length ? 'breach' : worst && worst.pct >= l.pct * NEAR && l.pct > 0 ? 'near' : 'ok';
      } else {
        over = rows.filter((r) => r.pct < l.pct);
        state = over.length ? 'breach' : worst && l.pct > 0 && worst.pct <= l.pct / NEAR ? 'near' : 'ok';
      }
    }
    return { kind, symbol, label, unit: KINDS[kind].unit, limit: l ? { pct: l.pct, status: l.status, note: l.note, updatedAt: l.updatedAt } : null, state, worst, over };
  };

  const checks: Check[] = [
    check('positionMax', holdings, 'max'),
    check('currencyMax', foreign, 'max'),
    check('accountMax', input.accounts.length > 1 ? accounts : [], 'max'),
    check('cashMin', [cash], 'min'),
    check('cashMax', [cash], 'max'),
    ...limits.filter((l) => l.kind === 'symbolMax').map((l) => check('symbolMax', [holdings.find((h) => h.key === l.symbol) ?? obs(l.symbol!, 0)], 'max', l.symbol)),
  ];
  if (input.accounts.length <= 1) notes.push('Only one account, so the per-account limit has nothing to compare.');
  const counts = { breach: 0, near: 0, ok: 0, unset: 0 };
  for (const c of checks) if (c.state in counts) counts[c.state as keyof typeof counts]++;
  return { base, netWorth: r2(netWorth), asOf: now, checks, counts, notes };
}
