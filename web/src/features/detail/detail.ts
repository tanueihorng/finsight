// Security detail logic (E1), ported from public/app.js S19/S20.
import type { HistoryPoint, Position, QuotedQuote } from '../../../../shared/types.ts';

// Chart timeframe -> history to fetch (Yahoo caps: 1m ≈ 7 days, 5m/15m ≈ 60 days, 1h ≈ 730 days).
// Yahoo's range=max returns quarterly bars for every interval, so W / M ask for explicit years.
export const CHART_TF_RANGE: Record<string, string> = { '1m': '5d', '5m': '1mo', '15m': '1mo', '60m': '1y', '1d': '5y', '1wk': '10y', '1mo': '30y' };
// Fetch more history than is shown, so moving averages (up to MA200) are formed from the first visible bar.
export const DETAIL_WARMUP: Record<string, string> = { '1d': '5d', '5d': '1mo', '1mo': '1y', '6mo': '2y', '1y': '2y', '5y': '10y' };
export const RANGES: { range: string; interval: string; label: string }[] = [
  { range: '1d', interval: '5m', label: '1D' }, { range: '5d', interval: '15m', label: '5D' }, { range: '1mo', interval: '1d', label: '1M' },
  { range: '6mo', interval: '1d', label: '6M' }, { range: '1y', interval: '1d', label: '1Y' }, { range: '5y', interval: '1wk', label: '5Y' },
];
export interface DetailRange { range: string; interval: string; tf?: boolean }
// Chart timeframe buttons (tf) load a long history and open on the latest bars.
export const fetchRangeFor = (r: DetailRange) => (r.tf ? r.range : DETAIL_WARMUP[r.range] || r.range);
export const isIntraday = (interval: string) => /m$|h$/.test(interval);

// First timestamp of the requested range inside a longer fetched series.
// Intraday: count trading sessions back via overnight gaps (> 2h); daily/weekly: calendar span.
export function visibleStart(pts: HistoryPoint[], range: string): number {
  if (!pts.length) return 0;
  const last = pts[pts.length - 1]!.t;
  const sessions = ({ '1d': 1, '5d': 5 } as Record<string, number>)[range];
  if (sessions) {
    let seen = 0;
    for (let i = pts.length - 1; i > 0; i--) {
      if (pts[i]!.t - pts[i - 1]!.t > 2 * 3600000 && ++seen === sessions) return pts[i]!.t;
    }
    return pts[0]!.t;
  }
  const days = ({ '1mo': 31, '6mo': 183, '1y': 366, '5y': 5 * 366 } as Record<string, number>)[range];
  return days ? last - days * 86400000 : pts[0]!.t;
}
// The header's change over the visible range (from the bar before it to the last bar).
export function rangeChange(pts: HistoryPoint[], visibleFrom: number | null) {
  const vi = Math.max(0, pts.findIndex((p) => p.t >= (visibleFrom ?? -Infinity)));
  const base0 = pts[vi > 0 ? vi - 1 : 0], lastPt = pts[pts.length - 1];
  const chg = base0 && lastPt ? lastPt.c - base0.c : null;
  return { chg, pct: chg != null && base0!.c ? chg / base0!.c * 100 : null };
}
export const rangeLabel = (range: string) => ({ '1d': '1D', '5d': '5D', '1mo': '1M', '6mo': '6M', '1y': '1Y', '5y': '5Y' } as Record<string, string>)[range] || range.toUpperCase();
export const mergeMeta = (meta: QuotedQuote | null | undefined, quote: QuotedQuote | null | undefined): Partial<QuotedQuote> => ({ ...(meta || {}), ...(quote || {}) });
// The holding auto-selected when nothing is: the first one with a market quote.
export const firstSelectable = (positions: Position[]) => (positions.find((p) => p.quoted !== false) || positions[0])?.symbol ?? null;
