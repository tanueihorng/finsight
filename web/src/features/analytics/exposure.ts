// View model for the look-through panel (FEAT-018). Amounts come from the
// server's calculation; this only arranges them into bars, legends and groups.
import { UNMAPPED_LABEL, type ExposureReport, type IssuerExposure, type UnmappedReason } from '../../../../shared/lookthrough.ts';

export type Basis = 'invested' | 'networth';
export const DIRECT_COLOR = 'var(--amber)';
export const UNMAPPED_COLOR = 'var(--border-2)';
// Fund colours: fixed order by fund value so a fund keeps its colour across rows.
const FUND_COLORS = ['#38bdf8', '#2ec27e', '#f472b6', '#facc15', '#fb7185', '#2dd4bf', '#c084fc', '#94a3b8'];

export interface Source { key: string; label: string; color: string; holdingsDate: string | null; status: 'direct' | 'expanded' | 'stale' | 'missing' | 'invalid'; note: string }
/** Legend entries: direct first, then every fund in the scope (largest first), expanded or not. */
export function sources(r: ExposureReport): Source[] {
  const out: Source[] = [{ key: 'DIRECT', label: 'Direct', color: DIRECT_COLOR, holdingsDate: null, status: 'direct', note: '' }];
  r.funds.forEach((f, i) => out.push({
    key: f.fund, label: f.fund, color: f.status === 'expanded' ? FUND_COLORS[i % FUND_COLORS.length]! : UNMAPPED_COLOR,
    holdingsDate: f.holdingsDate, status: f.status, note: f.note,
  }));
  return out;
}

export interface Segment { key: string; value: number; width: number; color: string }
/** One bar's segments, widths in % of the largest issuer's combined value. */
export function segments(e: IssuerExposure, scaleMax: number, src: Source[]): Segment[] {
  const color = new Map(src.map((s) => [s.key, s.color]));
  return e.contributions.map((c) => ({
    key: c.via, value: c.value, width: scaleMax > 0 ? (c.value / scaleMax) * 100 : 0, color: color.get(c.via) ?? UNMAPPED_COLOR,
  }));
}

export const denominator = (r: ExposureReport, basis: Basis) => (basis === 'networth' ? r.netWorth : r.basis);
export const share = (value: number, denom: number) => (denom ? value / denom : 0);

export interface UnmappedGroup { reason: UnmappedReason; label: string; value: number; rows: ExposureReport['unmappedRows'] }
export function unmappedGroups(r: ExposureReport): UnmappedGroup[] {
  const by = new Map<UnmappedReason, UnmappedGroup>();
  for (const row of r.unmappedRows) {
    const g = by.get(row.reason) ?? { reason: row.reason, label: UNMAPPED_LABEL[row.reason], value: 0, rows: [] };
    g.value += row.value; g.rows.push(row); by.set(row.reason, g);
  }
  return [...by.values()].sort((a, b) => b.value - a.value);
}

/** True when the response belongs to the scope on screen; otherwise it must not be shown. */
export const inScope = (r: ExposureReport | undefined, scope: { book: string; account: string; base: string }) =>
  !!r && r.book === scope.book && r.account === scope.account && r.base.toUpperCase() === scope.base.toUpperCase();
