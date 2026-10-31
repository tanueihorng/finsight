import type { DiscoverEarning, DiscoverExcluded, DiscoverMover } from '../../../../shared/types.ts';

// Display rules for the Discover panel (FEAT-010). Ranking is server-side
// (lib/discover.ts); these only format what it returned.
export const ROWS = 6;

const REASON: Record<DiscoverExcluded['reason'], string> = {
  index: 'index', fx: 'FX', futures: 'futures', crypto: 'crypto', 'no-quote': 'no quote', 'no-change': 'no prev close', limit: 'over limit',
};
// "2 index · 1 no quote", in a fixed order.
export function excludedSummary(list: DiscoverExcluded[]): string {
  const n = new Map<string, number>();
  for (const e of list) n.set(REASON[e.reason], (n.get(REASON[e.reason]) || 0) + 1);
  return Object.values(REASON).filter((r, i, all) => all.indexOf(r) === i && n.has(r)).map((r) => `${n.get(r)} ${r}`).join(' · ');
}
export const excludedTitle = (list: DiscoverExcluded[]) => list.map((e) => `${e.symbol}: ${REASON[e.reason]}${e.detail ? ` (${e.detail})` : ''}`).join('\n');

export const member = (r: { held: boolean; watched: boolean }) => (r.held ? 'held' : 'watch');

export function staleNote(r: DiscoverMover): string | null {
  if (r.staleReason === 'cached-after-failure') return 'last cached quote — live fetch failed';
  if (r.staleReason === 'old-session') return r.marketTime ? `last trade ${new Date(r.marketTime).toLocaleDateString('en-US', { month: 'short', day: '2-digit' })}` : 'no trade time';
  return null;
}

// Earnings: exchange-local date, days away, ~ when the provider says estimated.
export function earningsWhen(e: DiscoverEarning): { date: string; rel: string } {
  const date = new Date(e.day + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: '2-digit' });
  return { date, rel: e.inDays === 0 ? 'today' : e.inDays === 1 ? 'tomorrow' : `in ${e.inDays}d` };
}
export const tzShort = (tz: string) => ({ 'America/New_York': 'NY', 'Asia/Singapore': 'SG', 'Asia/Hong_Kong': 'HK', 'Europe/London': 'LDN' } as Record<string, string>)[tz] || tz.split('/').pop()!.replace('_', ' ');

export const asOfLabel = (ms: number | null) => ms == null ? 'no trades' : 'as of ' + new Date(ms).toLocaleString('en-US', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });

// Up/Down/Home/End move focus between rows of the panel (Tab still works).
export function nextRow(rows: Element[], current: Element, key: string): Element | null {
  const i = rows.indexOf(current);
  if (i < 0) return null;
  if (key === 'ArrowDown') return rows[Math.min(rows.length - 1, i + 1)] ?? null;
  if (key === 'ArrowUp') return rows[Math.max(0, i - 1)] ?? null;
  if (key === 'Home') return rows[0] ?? null;
  if (key === 'End') return rows[rows.length - 1] ?? null;
  return null;
}
