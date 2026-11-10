// The settings dashboard's report: what the ledger recorded, by model and by
// search provider, next to the prices those amounts were calculated from.
import type { BrainEntry } from '../brains/registry.ts';
import { usageRows, startOfToday, type DB } from '../store/db.ts';
import { WEB_PRICES } from '../tools/web.ts';

export const PRICES_CHECKED = '2026-11-10';
const WEB_KINDS = new Set(['search', 'fetch']);
const PERIODS = { day: 'Today', week: 'Last 7 days', month: 'This month', all: 'All time' } as const;
type Period = keyof typeof PERIODS;

function sinceFor(period: Period, now: Date): number {
  if (period === 'day') return startOfToday();
  if (period === 'week') return now.getTime() - 7 * 864e5;
  if (period === 'month') return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  return 0;
}

function priceNotes(p: BrainEntry['manifest']['pricing']): string[] {
  return [
    ...(p.longContext ? [`Prompts over ${Math.round(p.longContext.aboveTokens / 1000)}K tokens: input ×${p.longContext.inputMultiplier}, output ×${p.longContext.outputMultiplier}`] : []),
    ...(p.offPeak ? [`Off-peak ×${p.offPeak.multiplier}; peak is ${p.offPeak.weekdayPeakUtc.map(([a, b]) => `${String(a).padStart(2, '0')}:00–${String(b).padStart(2, '0')}:00`).join(' and ')} UTC on weekdays`] : []),
  ];
}

export function usageReport(db: DB, brains: Map<string, BrainEntry>, requested: string | null, now = new Date()) {
  const period: Period = requested && requested in PERIODS ? requested as Period : 'month';
  const since = sinceFor(period, now), rows = usageRows(db, since);
  const models = new Map<string, { id: string; label: string; calls: number; inputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; outputTokens: number; unsplitTokens: number; usd: number }>();
  const web: { provider: string; label: string; kind: string; requests: number; usd: number }[] = [];
  for (const r of rows) {
    if (WEB_KINDS.has(r.kind)) {
      const provider = r.brain.replace(/-search$/, '');
      web.push({ provider, label: WEB_PRICES[provider as keyof typeof WEB_PRICES]?.label ?? provider, kind: r.kind, requests: r.calls, usd: r.usd });
      continue;
    }
    const m = models.get(r.brain) ?? { id: r.brain, label: brains.get(r.brain)?.manifest.label ?? r.brain, calls: 0, inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0, unsplitTokens: 0, usd: 0 };
    m.calls += r.calls; m.inputTokens += r.inputTokens; m.cacheReadTokens += r.cacheReadTokens; m.cacheWriteTokens += r.cacheWriteTokens; m.outputTokens += r.outputTokens; m.unsplitTokens += r.unsplitTokens; m.usd += r.usd;
    models.set(r.brain, m);
  }
  const modelList = [...models.values()].sort((a, b) => b.usd - a.usd);
  const modelUsd = modelList.reduce((s, m) => s + m.usd, 0), webUsd = web.reduce((s, w) => s + w.usd, 0);
  return {
    period, since,
    totals: { usd: modelUsd + webUsd, modelUsd, webUsd, webRequests: web.reduce((s, w) => s + w.requests, 0), tokens: modelList.reduce((s, m) => s + m.inputTokens + m.outputTokens + m.unsplitTokens, 0) },
    models: modelList, web,
    rates: {
      checked: PRICES_CHECKED,
      models: [...brains.values()].map(({ manifest: m }) => ({ id: m.id, label: m.label, cli: m.transport === 'claude-code', inputPerM: m.pricing.inputPerM, cachedPerM: m.pricing.cacheReadPerM ?? m.pricing.inputPerM, outputPerM: m.pricing.outputPerM, notes: priceNotes(m.pricing) })),
      web: Object.entries(WEB_PRICES).map(([provider, p]) => ({ provider, label: p.label, usd: p.usd, unit: p.unit, note: p.note })),
    },
  };
}
