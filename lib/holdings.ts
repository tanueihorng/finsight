// Dated ETF constituent snapshots for look-through (FEAT-018). V1 is a local
// import: JSON files in DATA_DIR/etf-holdings/, one snapshot per file, shaped
// as shared/lookthrough.ts HoldingsSnapshot. Files are read, never rewritten,
// so a run is reproducible from the folder. No fetcher until a provider's
// schema and terms are verified.
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.ts';
import { activeBook } from './book.ts';
import { portfolioWithQuotes } from './portfolio.ts';
import { getCategories } from './market.ts';
import { lookThrough, type ExposureReport, type HoldingsSnapshot } from '../shared/lookthrough.ts';

export const HOLDINGS_DIR = path.join(DATA_DIR, 'etf-holdings');
export interface LoadedSnapshots { snapshots: HoldingsSnapshot[]; errors: { file: string; error: string }[] }

export function loadSnapshots(dir = HOLDINGS_DIR): LoadedSnapshots {
  const out: LoadedSnapshots = { snapshots: [], errors: [] };
  let files: string[];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort(); } catch { return out; }
  for (const file of files) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')) as HoldingsSnapshot;
      if (!raw || typeof raw !== 'object' || typeof raw.fund !== 'string') throw new Error('not a holdings snapshot (needs "fund")');
      // Validation happens in lookThrough so an invalid file still names its fund.
      out.snapshots.push({ ...raw, file });
    } catch (e) { out.errors.push({ file, error: String((e as Error).message || e).slice(0, 200) }); }
  }
  return out;
}

// The machine's local calendar date (en-CA formats as YYYY-MM-DD), not UTC's.
const today = () => new Date().toLocaleDateString('en-CA');

/** Look-through for one account (or the active one) in the active book. Read-only. */
export async function exposureReport(base: string, account?: string, asOf = today()): Promise<ExposureReport> {
  const book = activeBook();
  const pf = await portfolioWithQuotes(base, account);
  // An amount with no rate to base was counted one-for-one; leave it out of
  // every figure and list it instead, so no share is computed from it.
  const missing = new Set(pf.fxMissing);
  const valued = pf.positions.filter((p) => !missing.has(p.currency));
  const valuedCash = pf.cash.filter((c) => !missing.has(c.ccy));
  const unvalued = [
    ...pf.positions.filter((p) => missing.has(p.currency)).map((p) => ({ item: p.symbol, currency: p.currency, amount: p.last * p.quantity })),
    ...pf.cash.filter((c) => missing.has(c.ccy)).map((c) => ({ item: 'Cash', currency: c.ccy, amount: c.amount })),
  ];
  const cats = valued.length ? await getCategories(valued.map((p) => p.symbol)) : {};
  const positions = valued.map((p) => ({
    symbol: p.symbol, name: p.name, marketValue: p.marketValue,
    assetType: (cats[p.symbol.toUpperCase()] as { type?: string | null } | undefined)?.type ?? null,
  }));
  const { snapshots, errors } = loadSnapshots();
  const lt = lookThrough(positions, snapshots, { asOf });
  const cash = valuedCash.reduce((s, c) => s + c.base, 0);
  return { ...lt, book, account: pf.account, base: pf.base, cash, netWorth: lt.basis + cash, fxMissing: [...missing], unvalued, fileErrors: errors };
}
