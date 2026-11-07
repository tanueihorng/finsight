// Cost-basis review (FEAT-015 §3): finds average costs that look like
// placeholders or import artefacts, lets the owner mark each one confirmed or
// placeholder, and applies a corrected average cost through the ledger with
// undo. FinSight never guesses a cost: flags state a reason, and only a cost the
// owner types is written. Marks live in DATA_DIR/cost-review.json (0600).
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.ts';
import { loadPortfolio, savePortfolio, recalcPosition, withLock, withUndo } from './store.ts';
import { getHistory } from './market.ts';
import type { StoredAccount, StoredPortfolio, StoredPosition } from './model.ts';
import type { CostFlag, CostMark, CostReview, CostReviewRow, LotCheck, MarkStatus } from '../shared/costbasis.ts';
export type { CostReview, CostReviewRow, CostMark };

const FILE = () => path.join(DATA_DIR, 'cost-review.json');
const DAY = (t: number) => new Date(t).toISOString().slice(0, 10);
/** Positions sharing one purchase day in one account before that day looks like an import date. */
export const BULK_MIN = 3;
/** Slack around the week's high/low (rounding, odd fills, currency of record). */
export const RANGE_SLACK = 0.02;
const key = (accountId: string, symbol: string) => `${accountId}|${symbol.toUpperCase()}`;

export function loadMarks(): Record<string, CostMark> {
  try { const v = JSON.parse(fs.readFileSync(FILE(), 'utf8')); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; }
}
function saveMarks(m: Record<string, CostMark>) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = FILE() + '.tmp.' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(m, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, FILE());
}

/** Why a position's cost can't be rewritten here (transferred lots must be fixed at their source). */
export function editBlock(acc: StoredAccount, pos: StoredPosition): string | undefined {
  if (!pos.lots.length) return 'No open lots';
  for (const l of pos.lots) {
    if (!l.tx) continue;
    const tx = acc.transactions.find((t) => t.id === l.tx);
    if (!tx) continue;
    if (tx.type !== 'BUY') return 'Some lots came from a transfer; fix them in the account they came from';
    if (tx.transferred) return 'Some lots have been transferred; use the ledger to edit each buy';
  }
  if (!(pos.avgCost > 0) && pos.lots.length > 1) return 'Average cost is zero across several lots; edit each buy in the ledger';
  return undefined;
}

/** Pure: flags from the stored book, the marks and (optionally) price-range checks. */
export function review(p: Pick<StoredPortfolio, 'accounts'>, marks: Record<string, CostMark>,
  opts: { unquoted?: Set<string>; lotChecks?: Map<string, LotCheck[]>; now?: number } = {}): CostReview {
  const rows: CostReviewRow[] = [];
  for (const acc of p.accounts) {
    // Days on which several positions in this account were all bought: likely the import date.
    const perDay = new Map<string, number>();
    for (const pos of acc.positions) for (const d of new Set(pos.lots.filter((l) => l.t != null).map((l) => DAY(l.t!)))) perDay.set(d, (perDay.get(d) ?? 0) + 1);
    for (const pos of acc.positions) {
      if (!(pos.quantity > 0)) continue;
      const S = pos.symbol.toUpperCase(), k = key(acc.id, S);
      const flags: { flag: CostFlag; reason: string }[] = [];
      const days = new Set(pos.lots.map((l) => (l.t == null ? 'none' : DAY(l.t))));
      if (days.size === 1 && !days.has('none')) {
        const d = [...days][0]!, n = perDay.get(d) ?? 0;
        if (n >= BULK_MIN) flags.push({ flag: 'bulk-date', reason: `All lots dated ${d}, the same day as ${n - 1} other holdings in this account; that may be the import date, not the purchase date.` });
      }
      if (!(pos.avgCost > 0)) flags.push({ flag: 'zero-cost', reason: 'Average cost is zero or missing, so P&L counts the whole value as gain.' });
      if (opts.unquoted?.has(S)) flags.push({ flag: 'unquoted', reason: 'No market quote: the value is the stored price, so P&L depends entirely on the cost you entered.' });
      const checks = opts.lotChecks?.get(k);
      const bad = checks?.filter((c) => c.inRange === false) ?? [];
      if (bad.length) flags.push({ flag: 'out-of-range', reason: `${bad.length} lot price${bad.length > 1 ? 's are' : ' is'} outside that week's trading range; the price or the date is probably wrong.` });
      const mark = marks[k] ?? null;
      if (mark?.status === 'placeholder') flags.push({ flag: 'marked-placeholder', reason: 'You marked this cost as a placeholder.' + (mark.note ? ` Note: ${mark.note}` : '') });
      if (mark?.status === 'confirmed' && Math.abs(mark.avgCostAtMark - pos.avgCost) > 1e-9 * Math.max(1, Math.abs(pos.avgCost))) {
        flags.push({ flag: 'stale-confirmation', reason: 'The cost changed after you confirmed it.' });
      }
      // A current confirmation clears the heuristic flags (the owner has checked them).
      const shown = mark?.status === 'confirmed' && !flags.some((f) => f.flag === 'stale-confirmation') ? flags.filter((f) => f.flag === 'out-of-range') : flags;
      const block = editBlock(acc, pos);
      rows.push({ accountId: acc.id, account: acc.name, symbol: S, currency: (pos.currency || 'USD').toUpperCase(), quantity: pos.quantity, avgCost: pos.avgCost,
        lots: pos.lots.length, flags: shown, mark, ...(checks ? { lotChecks: checks } : {}), editable: !block, ...(block ? { editBlock: block } : {}) });
    }
  }
  rows.sort((a, b) => b.flags.length - a.flags.length || a.account.localeCompare(b.account) || a.symbol.localeCompare(b.symbol));
  const marked = rows.map((r) => r.mark);
  return {
    asOf: opts.now ?? Date.now(), checked: !!opts.lotChecks, rows,
    counts: { positions: rows.length, flagged: rows.filter((r) => r.flags.length).length,
      confirmed: marked.filter((m) => m?.status === 'confirmed').length, placeholder: marked.filter((m) => m?.status === 'placeholder').length },
    notes: [
      'Flags are prompts to check a cost against your broker statement; none of them changes anything.',
      'The weekly price-range check compares each lot price with that week\'s high and low (±2%), in the instrument\'s own currency.',
    ],
  };
}

/** Pure: is a lot price inside the week's range that contains its date? */
export function lotInRange(px: number, t: number | null, weeks: { t: number; h?: number | null; l?: number | null }[]): LotCheck {
  if (t == null || !weeks.length) return { t, px, weekLow: null, weekHigh: null, inRange: null };
  let w = null as null | { t: number; h?: number | null; l?: number | null };
  for (const x of weeks) { if (x.t <= t) w = x; else break; }
  if (!w || t - w.t > 8 * 864e5 || w.h == null || w.l == null) return { t, px, weekLow: null, weekHigh: null, inRange: null };
  return { t, px, weekLow: w.l, weekHigh: w.h, inRange: px >= w.l * (1 - RANGE_SLACK) && px <= w.h * (1 + RANGE_SLACK) };
}

export async function costReview(opts: { unquoted?: Set<string>; check?: boolean } = {}): Promise<CostReview> {
  const p = loadPortfolio();
  let lotChecks: Map<string, LotCheck[]> | undefined;
  if (opts.check) {
    lotChecks = new Map();
    const syms = [...new Set(p.accounts.flatMap((a) => a.positions.filter((x) => x.quantity > 0 && !opts.unquoted?.has(x.symbol.toUpperCase())).map((x) => x.symbol.toUpperCase())))];
    const hist = new Map<string, { t: number; h?: number | null; l?: number | null }[]>();
    await Promise.all(syms.map(async (s) => { try { hist.set(s, (await getHistory(s, '10y', '1wk')).points); } catch { hist.set(s, []); } }));
    for (const a of p.accounts) for (const pos of a.positions) {
      const S = pos.symbol.toUpperCase();
      if (!hist.has(S)) continue;
      lotChecks.set(key(a.id, S), pos.lots.map((l) => lotInRange(l.px, l.t, hist.get(S)!)));
    }
  }
  return review(p, loadMarks(), { unquoted: opts.unquoted, lotChecks });
}

export function setMark(accountId: unknown, symbol: unknown, status: unknown, note?: unknown) {
  if (typeof accountId !== 'string' || typeof symbol !== 'string' || !symbol.trim()) throw new Error('account and symbol are required');
  const p = loadPortfolio();
  const acc = p.accounts.find((a) => a.id === accountId);
  const pos = acc?.positions.find((x) => x.symbol.toUpperCase() === symbol.toUpperCase());
  if (!acc || !pos) throw new Error('Holding not found');
  const marks = loadMarks(), k = key(acc.id, pos.symbol);
  if (status === 'clear') delete marks[k];
  else if (status === 'confirmed' || status === 'placeholder') {
    const n = typeof note === 'string' ? note.trim().slice(0, 300) : '';
    marks[k] = { status: status as MarkStatus, avgCostAtMark: pos.avgCost, at: Date.now(), ...(n ? { note: n } : {}) };
  } else throw new Error('status must be confirmed, placeholder or clear');
  saveMarks(marks);
}

/**
 * Rewrite one holding's average cost (native currency) by scaling every open
 * lot's price, and the price on each lot's BUY, by new/old. Lot quantities,
 * dates and FX anchors are kept, so relative lot costs stay as recorded. One
 * undo step. The owner's new cost is then recorded as confirmed.
 */
export async function setAverageCost(accountId: unknown, symbol: unknown, avgCost: unknown) {
  const v = Number(avgCost);
  if (!(v > 0) || !Number.isFinite(v)) throw new Error('Average cost must be a positive number');
  if (typeof accountId !== 'string' || typeof symbol !== 'string') throw new Error('account and symbol are required');
  return withLock(() => withUndo(`Set average cost ${String(symbol).toUpperCase()}`, () => {
    const p = loadPortfolio();
    const acc = p.accounts.find((a) => a.id === accountId);
    const pos = acc?.positions.find((x) => x.symbol.toUpperCase() === symbol.toUpperCase());
    if (!acc || !pos) throw new Error('Holding not found');
    const block = editBlock(acc, pos);
    if (block) throw new Error(block);
    const before = pos.avgCost;
    if (pos.avgCost > 0) {
      const f = v / pos.avgCost;
      for (const l of pos.lots) l.px *= f;
    } else pos.lots[0]!.px = v; // single lot at zero cost (editBlock refuses several)
    for (const l of pos.lots) {
      const tx = l.tx ? acc.transactions.find((t) => t.id === l.tx) : undefined;
      if (tx) tx.price = l.px;
    }
    recalcPosition(pos);
    savePortfolio(p);
    const marks = loadMarks();
    marks[key(acc.id, pos.symbol)] = { status: 'confirmed', avgCostAtMark: pos.avgCost, at: Date.now(), note: 'set in cost review' };
    saveMarks(marks);
    return { symbol: pos.symbol.toUpperCase(), before, after: pos.avgCost };
  }));
}
