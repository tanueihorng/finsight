// ETF look-through (FEAT-018): combine a scope's direct stock positions with
// the constituents of its funds, using dated holdings snapshots, into one
// exposure per issuer. Pure and deterministic: the server computes it and the
// web reuses shockImpact, so every figure comes from this one calculation.
//
// Rules (V1):
// - A position with a snapshot is a fund and expands one level. A constituent
//   that is itself a fund stays unmapped ("nested fund"), as does one without
//   a ticker or whose stated issuer conflicts with its ticker.
// - A stale, future-dated or invalid snapshot does not expand: the whole fund
//   value stays unmapped, so old weights never pose as current exposure.
// - Weights below 100% leave the remainder unmapped as the fund residual.
// - Stocks are direct exposure. Funds without a file and every other asset
//   type (crypto, futures, unknown) stay unmapped at their full value.
// mapped + unmapped always equals the scope's invested value (the basis).

export interface Constituent {
  ticker?: string | null; name: string; weightPct: number;
  /** Optional issuer key stated by the file; it must agree with the ticker's. */
  issuer?: string | null;
  type?: 'equity' | 'fund' | 'cash' | 'other';
}
export interface HoldingsSnapshot {
  fund: string; name?: string;
  /** The date the fund's holdings describe (YYYY-MM-DD), not when they were fetched. */
  holdingsDate: string; retrievedAt: string; source: string;
  constituents: Constituent[];
  file?: string;
}
export interface ScopePosition { symbol: string; name?: string; marketValue: number; assetType: string | null }

export type UnmappedReason =
  | 'no-holdings-file' | 'stale-holdings' | 'invalid-holdings' | 'fund-residual' | 'fund-non-equity'
  | 'nested-fund' | 'unresolved-issuer' | 'unsupported-asset';
export const UNMAPPED_LABEL: Record<UnmappedReason, string> = {
  'no-holdings-file': 'No holdings file',
  'stale-holdings': 'Stale holdings',
  'invalid-holdings': 'Invalid holdings file',
  'fund-residual': 'Not listed in file',
  'fund-non-equity': 'Fund cash & other',
  'nested-fund': 'Fund inside a fund',
  'unresolved-issuer': 'Issuer not resolved',
  'unsupported-asset': 'Unsupported asset',
};

export interface Contribution {
  /** 'DIRECT' or the fund symbol. */
  via: string; kind: 'direct' | 'fund'; value: number;
  /** The constituent weight in the fund (null for direct). */
  weightPct: number | null; holdingsDate: string | null; tickers: string[];
}
export interface IssuerExposure {
  issuer: string; name: string; tickers: string[];
  direct: number; indirect: number; combined: number;
  /** combined / basis */
  share: number;
  contributions: Contribution[];
}
export interface UnmappedRow { position: string; reason: UnmappedReason; value: number; detail: string; holdingsDate: string | null }
export interface FundCoverage {
  fund: string; value: number; status: 'expanded' | 'stale' | 'missing' | 'invalid';
  holdingsDate: string | null; retrievedAt: string | null; source: string | null; ageDays: number | null;
  mappedValue: number; mappedShare: number; note: string;
}
export interface LookThrough {
  asOf: string; staleDays: number;
  /** Sum of the scope's position values (base currency). */
  basis: number; mapped: number; unmapped: number;
  reconciles: boolean; difference: number;
  issuers: IssuerExposure[]; unmappedRows: UnmappedRow[]; funds: FundCoverage[];
}

/** /api/exposure: the look-through for one account in one book, base currency. */
export type ExposureReport = LookThrough & {
  book: string; account: string; base: string; cash: number; netWorth: number;
  /** Holdings files that could not be read at all. */
  fileErrors: { file: string; error: string }[];
};

export const DEFAULT_STALE_DAYS = 45;
const FUND_TYPES = new Set(['ETF', 'MUTUALFUND']);
const DAY = 86_400_000;
// Share classes of one issuer. Keys and values are normalised tickers.
const SHARE_CLASSES: Record<string, string> = { GOOG: 'GOOGL', 'BRK-A': 'BRK-B', 'FOXA': 'FOX', 'NWSA': 'NWS' };

/** Upper-case; US class suffixes "BRK.B"/"BRK/B" become "BRK-B". Exchange suffixes (".SI") stay. */
export function normTicker(t: string): string {
  const u = t.trim().toUpperCase();
  return /^[A-Z]{1,5}[./][A-Z]$/.test(u) ? u.replace(/[./]/, '-') : u;
}
export const issuerOf = (ticker: string): string => { const n = normTicker(ticker); return SHARE_CLASSES[n] ?? n; };

const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
const dayMs = (d: string) => Date.parse(d + 'T00:00:00Z');

/** Problems that make a snapshot unusable; empty when it is valid. */
export function snapshotProblems(s: HoldingsSnapshot): string[] {
  const out: string[] = [];
  if (!s.fund || typeof s.fund !== 'string') out.push('missing fund');
  if (!isDate(s.holdingsDate)) out.push('holdingsDate must be YYYY-MM-DD');
  if (!s.retrievedAt || Number.isNaN(Date.parse(s.retrievedAt))) out.push('retrievedAt must be a date');
  if (!s.source || typeof s.source !== 'string') out.push('missing source');
  if (!Array.isArray(s.constituents) || !s.constituents.length) out.push('no constituents');
  else {
    let sum = 0;
    for (const c of s.constituents) {
      if (typeof c?.weightPct !== 'number' || !Number.isFinite(c.weightPct) || c.weightPct < 0) { out.push(`bad weight for ${c?.ticker ?? c?.name ?? '?'}`); break; }
      sum += c.weightPct;
    }
    // Rounding in issuer files can push a full list slightly past 100%.
    if (sum > 100.5) out.push(`weights sum to ${sum.toFixed(2)}% (over 100%)`);
  }
  if (isDate(s.holdingsDate) && s.retrievedAt && Date.parse(s.retrievedAt) < dayMs(s.holdingsDate)) out.push('retrieved before its holdings date');
  return out;
}

/** The latest snapshot per fund with a holdings date on or before asOf. */
export function pickSnapshots(all: HoldingsSnapshot[], asOf: string): Map<string, HoldingsSnapshot> {
  const out = new Map<string, HoldingsSnapshot>();
  for (const s of all) {
    if (!s?.fund || !isDate(s.holdingsDate) || s.holdingsDate > asOf) continue;
    const k = normTicker(s.fund), cur = out.get(k);
    if (!cur || s.holdingsDate > cur.holdingsDate) out.set(k, s);
  }
  return out;
}

export function lookThrough(positions: ScopePosition[], snapshots: HoldingsSnapshot[], opts: { asOf: string; staleDays?: number }): LookThrough {
  const { asOf } = opts, staleDays = opts.staleDays ?? DEFAULT_STALE_DAYS;
  const latest = pickSnapshots(snapshots, asOf);
  const known = new Set(snapshots.filter((s) => s?.fund).map((s) => normTicker(s.fund)));
  const issuers = new Map<string, IssuerExposure>();
  const unmappedRows: UnmappedRow[] = [];
  const funds: FundCoverage[] = [];
  const basis = positions.reduce((s, p) => s + p.marketValue, 0);

  const add = (key: string, name: string, ticker: string, c: Omit<Contribution, 'tickers'>) => {
    let e = issuers.get(key);
    if (!e) { e = { issuer: key, name, tickers: [], direct: 0, indirect: 0, combined: 0, share: 0, contributions: [] }; issuers.set(key, e); }
    if (!e.tickers.includes(ticker)) e.tickers.push(ticker);
    if (c.kind === 'direct') e.direct += c.value; else e.indirect += c.value;
    const same = e.contributions.find((x) => x.via === c.via);
    if (same) { same.value += c.value; same.weightPct = (same.weightPct ?? 0) + (c.weightPct ?? 0); if (!same.tickers.includes(ticker)) same.tickers.push(ticker); }
    else e.contributions.push({ ...c, tickers: [ticker] });
    // Prefer a direct position's name; otherwise the first constituent name seen.
    if (c.kind === 'direct' && name) e.name = name;
  };
  const miss = (position: string, reason: UnmappedReason, value: number, detail: string, holdingsDate: string | null = null) => {
    if (value !== 0) unmappedRows.push({ position, reason, value, detail, holdingsDate });
  };

  for (const p of positions) {
    const sym = normTicker(p.symbol), v = p.marketValue;
    const snap = latest.get(sym);
    const isFund = !!snap || known.has(sym) || FUND_TYPES.has(p.assetType ?? '');
    if (!isFund) {
      if (p.assetType === 'EQUITY') add(issuerOf(sym), p.name || sym, sym, { via: 'DIRECT', kind: 'direct', value: v, weightPct: null, holdingsDate: null });
      else miss(sym, 'unsupported-asset', v, p.assetType ? `${p.assetType.toLowerCase()} has no issuer look-through` : 'asset type unknown');
      continue;
    }
    const cov: FundCoverage = { fund: sym, value: v, status: 'missing', holdingsDate: null, retrievedAt: null, source: null, ageDays: null, mappedValue: 0, mappedShare: 0, note: '' };
    funds.push(cov);
    if (!snap) {
      const future = snapshots.some((s) => s?.fund && normTicker(s.fund) === sym && isDate(s.holdingsDate) && s.holdingsDate > asOf);
      cov.note = future ? `only holdings dated after ${asOf}` : 'no holdings file imported';
      miss(sym, 'no-holdings-file', v, cov.note);
      continue;
    }
    Object.assign(cov, { holdingsDate: snap.holdingsDate, retrievedAt: snap.retrievedAt, source: snap.source, ageDays: Math.round((dayMs(asOf) - dayMs(snap.holdingsDate)) / DAY) });
    const problems = snapshotProblems(snap);
    if (problems.length) { cov.status = 'invalid'; cov.note = problems.join('; '); miss(sym, 'invalid-holdings', v, cov.note, snap.holdingsDate); continue; }
    if (cov.ageDays! > staleDays) { cov.status = 'stale'; cov.note = `holdings ${cov.ageDays} days old (limit ${staleDays})`; miss(sym, 'stale-holdings', v, cov.note, snap.holdingsDate); continue; }
    cov.status = 'expanded';
    let nested = 0, nonEq = 0, unresolved = 0;
    const nestedNames: string[] = [], unresolvedNames: string[] = [];
    // A list summing to (100, 100.5] is rounding: scale it to 100% so the
    // fund's parts never exceed its value.
    const listed = snap.constituents.reduce((s, c) => s + c.weightPct, 0), scale = listed > 100 ? 100 / listed : 1;
    for (const c of snap.constituents) {
      const w = c.weightPct * scale, cv = v * w / 100;
      const t = c.ticker ? normTicker(c.ticker) : '';
      if (c.type === 'cash' || c.type === 'other') { nonEq += cv; continue; }
      if (c.type === 'fund' || (t && known.has(t))) { nested += cv; nestedNames.push(t || c.name); continue; }
      if (!t || (c.issuer && issuerOf(c.issuer) !== issuerOf(t))) { unresolved += cv; unresolvedNames.push(t ? `${t} (file says ${c.issuer})` : c.name); continue; }
      add(issuerOf(t), c.name, t, { via: sym, kind: 'fund', value: cv, weightPct: w, holdingsDate: snap.holdingsDate });
      cov.mappedValue += cv;
    }
    const residual = Math.max(0, 100 - listed) * v / 100;
    miss(sym, 'fund-residual', residual, `${Math.max(0, 100 - listed).toFixed(2)}% of the fund is not listed in the file`, snap.holdingsDate);
    miss(sym, 'fund-non-equity', nonEq, 'cash, derivatives and other non-equity lines', snap.holdingsDate);
    miss(sym, 'nested-fund', nested, `held funds expand one level only: ${nestedNames.join(', ')}`, snap.holdingsDate);
    miss(sym, 'unresolved-issuer', unresolved, `no single issuer for ${unresolvedNames.join(', ')}`, snap.holdingsDate);
    cov.mappedShare = v ? cov.mappedValue / v : 0;
    cov.note = listed > 100 ? `weights summed to ${listed.toFixed(2)}%; scaled to 100%` : '';
  }

  const list = [...issuers.values()];
  for (const e of list) {
    e.combined = e.direct + e.indirect;
    e.share = basis ? e.combined / basis : 0;
    e.contributions.sort((a, b) => (a.kind === 'direct' ? -1 : b.kind === 'direct' ? 1 : b.value - a.value));
  }
  list.sort((a, b) => b.combined - a.combined || a.issuer.localeCompare(b.issuer));
  unmappedRows.sort((a, b) => b.value - a.value);
  funds.sort((a, b) => b.value - a.value);
  const mapped = list.reduce((s, e) => s + e.combined, 0);
  const unmapped = unmappedRows.reduce((s, r) => s + r.value, 0);
  const difference = mapped + unmapped - basis;
  return { asOf, staleDays, basis, mapped, unmapped, reconciles: Math.abs(difference) <= Math.max(0.01, Math.abs(basis) * 1e-9), difference, issuers: list, unmappedRows, funds };
}

export interface ShockResult {
  issuer: string; dropPct: number;
  /** Change in portfolio value (negative for a drop), base currency. */
  impact: number;
  /** impact / basis */
  impactShare: number;
  exposure: number; direct: number; indirect: number;
  /** Share of the basis the estimate covers (mapped / basis). */
  coverage: number;
}
/**
 * A hypothetical move in one issuer, applied once to its combined mapped
 * exposure. Static weights: the funds' other constituents and every unmapped
 * value are assumed unchanged.
 */
export function shockImpact(lt: LookThrough, issuer: string, dropPct: number): ShockResult | null {
  const e = lt.issuers.find((x) => x.issuer === issuer);
  if (!e || !Number.isFinite(dropPct)) return null;
  const d = Math.max(0, Math.min(100, dropPct));
  const impact = -e.combined * d / 100;
  return {
    issuer, dropPct: d, impact, impactShare: lt.basis ? impact / lt.basis : 0,
    exposure: e.combined, direct: e.direct, indirect: e.indirect, coverage: lt.basis ? lt.mapped / lt.basis : 0,
  };
}
