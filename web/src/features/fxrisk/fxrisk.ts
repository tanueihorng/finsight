// Preserve the legacy panel's units and formulas: rates are base per foreign unit.
export function shock(foreign: number, pct: number) {
  const impact = foreign * pct / 100;
  return { impact, value: foreign + impact };
}
export function targetExposure(total: number, foreign: number, input: string) {
  const pct = parseFloat(input), current = total ? foreign / total * 100 : 0;
  if (!Number.isFinite(pct) || !total) return { current, pct, gap: null, onTarget: false };
  const gap = pct / 100 * total - foreign;
  return { current, pct, gap, onTarget: Math.abs(gap) < total * 0.005 };
}
export function conversion(input: string, rate: number, weeklySigmaPct: number) {
  const amount = parseFloat(input);
  if (!(amount > 0)) return null;
  const now = amount / rate, sigma = weeklySigmaPct / 100 * Math.sqrt(4.345);
  if (!(sigma > 0)) return { now, band: null };
  const lo = rate * Math.exp(-sigma), hi = rate * Math.exp(sigma);
  return { now, band: { lo, hi, min: amount / hi, max: amount / lo, spread: now - amount / hi } };
}
