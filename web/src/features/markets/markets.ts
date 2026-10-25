import type { Markets } from '../../../../shared/types.ts';

// Same rules as the legacy loadMarkets() (public/app.js at 31437a0).
export const priceDecimals = (price: number | null | undefined) => (price != null && price < 10 ? 4 : 2);

export const updatedLabel = (ms: number) => 'upd ' + new Date(ms).toLocaleTimeString('en-US', { hour12: false });

// Topbar pill: LIVE while the S&P 500 quote is under 6 minutes old, else CLOSED.
// null leaves the pill as it is (no S&P quote or no market time).
export function marketState(groups: Markets, now: number): { text: 'LIVE' | 'CLOSED'; className: string } | null {
  const sp = groups.Indices?.find((q) => q.symbol === '^GSPC');
  if (!sp || !('marketTime' in sp) || !sp.marketTime) return null;
  const fresh = now - sp.marketTime < 6 * 60000;
  return fresh ? { text: 'LIVE', className: 'pill open' } : { text: 'CLOSED', className: 'pill closed' };
}
