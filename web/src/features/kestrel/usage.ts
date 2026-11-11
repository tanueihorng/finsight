// Types and number formats for the Kestrel usage dashboard.
export type UsagePeriod = 'day' | 'week' | 'month' | 'all';
export const USAGE_PERIODS: { id: UsagePeriod; label: string }[] = [{ id: 'day', label: 'Today' }, { id: 'week', label: '7 days' }, { id: 'month', label: 'This month' }, { id: 'all', label: 'All time' }];
export interface UsageModel { id: string; label: string; calls: number; inputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; outputTokens: number; unsplitTokens: number; usd: number }
export interface UsageReport {
  period: UsagePeriod; since: number;
  totals: { usd: number; modelUsd: number; webUsd: number; webRequests: number; tokens: number };
  models: UsageModel[];
  web: { provider: string; label: string; kind: string; requests: number; usd: number }[];
  rates: {
    checked: string;
    models: { id: string; label: string; cli: boolean; inputPerM: number; cachedPerM: number; outputPerM: number; notes: string[] }[];
    web: { provider: string; label: string; usd: number; unit: string; note: string }[];
  };
}
export const modelTokens = (m: UsageModel) => m.inputTokens + m.outputTokens + m.unsplitTokens;
export function tokenLabel(n: number): string {
  if (n >= 999_500) return `${(n / 1e6).toFixed(n >= 1e8 ? 0 : 2)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 99_950 ? 0 : 1)}K`;
  return String(n);
}
export const usdLabel = (n: number) => `$${n === 0 ? '0.00' : n < 0.001 ? n.toFixed(6) : n < 1 ? n.toFixed(4) : n.toFixed(2)}`;
export function rateLabel(n: number): string {
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n < 0.01) return `$${n}`;
  return `$${n.toFixed(3).replace(/0$/, '')}`;
}
