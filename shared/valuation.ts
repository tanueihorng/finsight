// FEAT-015 §2 valuation column: the owner's own fair-value range (from the
// thesis tracker) against the current price. Pure; shared by the server and web.
export type VsFair =
  | { state: 'below' | 'within' | 'above'; gapPct: number; low: number | null; high: number | null; currency: string }
  | { state: 'currency'; currency: string; priceCurrency: string };

/**
 * gapPct: below = how far price is under the low end (negative, e.g. -12);
 * above = how far over the high end (positive); within = 0.
 * Null when there is no range or no price. A range in another currency than the
 * price is reported as a mismatch, never converted.
 */
export function vsFair(last: number | null | undefined, priceCurrency: string | null | undefined,
  v: { low?: number; high?: number; currency?: string } | null | undefined): VsFair | null {
  if (!v || (v.low == null && v.high == null) || last == null || !Number.isFinite(last) || last <= 0) return null;
  const pc = (priceCurrency || '').toUpperCase(), vc = (v.currency || pc).toUpperCase();
  if (pc && vc !== pc) return { state: 'currency', currency: vc, priceCurrency: pc };
  const low = v.low ?? null, high = v.high ?? null;
  if (low != null && last < low) return { state: 'below', gapPct: (last / low - 1) * 100, low, high, currency: vc };
  if (high != null && last > high) return { state: 'above', gapPct: (last / high - 1) * 100, low, high, currency: vc };
  return { state: 'within', gapPct: 0, low, high, currency: vc };
}
