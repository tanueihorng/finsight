// Strategy library tools. The model never "applies a strategy" from memory:
// run/scan execute the real engines in the sandbox on FinSight bars, and
// sizing is computed in code from actual cash and positions.
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { ToolCtx, ToolDef } from './registry.ts';
import { runSandbox } from '../sandbox/host.ts';
import { fetchPortfolio } from './facts.ts';
import { AgentError } from '../types.ts';

const RESEARCH_LABEL = 'Research, not an instruction: this strategy is not accepted in the user\'s policy.';
// Placeholders from the 2026-10-01 trade-plan worksheet. NOT accepted policy.
const PLACEHOLDER = { riskPct: 1, maxPositionPct: 10, earningsWindowDays: 30 };

type Evidence = Record<string, { version: string; status: string; evidence: unknown[]; weaknesses?: string }>;
function evidence(ctx: ToolCtx): Evidence {
  try { return JSON.parse(fs.readFileSync(path.join(ctx.cfg.pluginsDir, 'strategy-evidence.json'), 'utf8')); } catch { return {}; }
}
const roots = (ctx: ToolCtx) => ({ builtinDir: path.join(ctx.cfg.finsightRepo, 'public'), privateDir: ctx.cfg.privateStrategiesDir });

async function listAll(ctx: ToolCtx) {
  const r = await runSandbox<{ strategies: any[]; invalid: any[] }>(roots(ctx), { op: 'list' });
  const ev = evidence(ctx);
  return {
    strategies: r.strategies.map((s) => {
      const e = ev[s.id];
      const status = s.status || e?.status || 'idea';
      return { id: `${s.id}@${s.version || e?.version || '0.0.0'}`, key: s.id, name: s.name, origin: s.origin, mechanical: s.mechanical, kind: s.kind,
        status, label: status === 'accepted' ? undefined : RESEARCH_LABEL, summary: s.summary, evidence: e?.evidence ?? [], weaknesses: e?.weaknesses };
    }),
    invalid: r.invalid,
  };
}

/** Daily bars for many symbols, via FinSight's batch endpoint when present (one request), else per symbol. */
async function barsFor(ctx: ToolCtx, symbols: string[]): Promise<Map<string, any[]>> {
  const out = new Map<string, any[]>();
  try {
    const d = await ctx.finsight.get('/api/history/batch', { symbols: symbols.join(','), range: '2y', interval: '1d' }, ctx.signal);
    for (const [sym, h] of Object.entries<any>(d.results || {})) out.set(sym.toUpperCase(), h?.points || []);
    return out;
  } catch (e) {
    if (e instanceof AgentError && e.code !== 'FINSIGHT_ERROR') throw e; // down/auth: surface it
  }
  for (const s of symbols) {
    try { const h = await ctx.finsight.get('/api/history', { symbol: s, range: '2y', interval: '1d' }, ctx.signal); out.set(s.toUpperCase(), h.points || []); }
    catch { out.set(s.toUpperCase(), []); }
  }
  return out;
}

const keyOf = (id: string) => id.split('@')[0]!.toLowerCase();

export const strategyTools: ToolDef[] = [
  {
    name: 'list_strategies',
    description: 'The user\'s strategy library: id@version, name, mechanical or discretionary, status (idea/backtested/paper/accepted), headline backtest evidence and known weaknesses. Always state the status and evidence when discussing a strategy.',
    input: z.object({}),
    async handler(_i, ctx) { return { asOf: new Date().toISOString(), ...(await listAll(ctx)) }; },
  },
  {
    name: 'get_strategy',
    description: 'Full card for one strategy: rules in plain words, source, status, evidence, weaknesses.',
    input: z.object({ id: z.string().min(2).max(60) }),
    async handler({ id }, ctx) {
      const all = await listAll(ctx);
      const s = all.strategies.find((x) => x.key === keyOf(id));
      if (!s) throw new AgentError('NOT_FOUND', `No strategy ${id}. Known: ${all.strategies.map((x) => x.key).join(', ')}`);
      const r = await runSandbox<{ strategies: any[] }>(roots(ctx), { op: 'list' });
      const full = r.strategies.find((x) => x.id === s.key);
      return { ...s, rules: full?.rules, source: full?.source };
    },
  },
  {
    name: 'run_strategy',
    description: 'Run one strategy engine on a symbol\'s daily bars (2y, last completed bar). Returns current stage (no setup / setup / in trade), open simulated trade, recent setups with trigger/stop, and historical stats for that symbol. Same engine as the FinSight chart.',
    input: z.object({ id: z.string().min(2).max(60), symbol: z.string().min(1).max(24) }),
    timeoutMs: 40_000,
    async handler({ id, symbol }, ctx) {
      const all = await listAll(ctx);
      const s = all.strategies.find((x) => x.key === keyOf(id));
      if (!s) throw new AgentError('NOT_FOUND', `No strategy ${id}`);
      const bars = (await barsFor(ctx, [symbol])).get(symbol.toUpperCase()) || [];
      if (bars.length < 60) throw new AgentError('NO_DATA', `Not enough daily history for ${symbol} (${bars.length} bars)`);
      const r = await runSandbox<{ results: any[] }>(roots(ctx), { op: 'run', jobs: [{ id: s.key, symbol, bars }] });
      return { strategy: s.id, status: s.status, label: s.label, evidence: s.evidence, asOf: new Date().toISOString(), source: 'FinSight /api/history + strategy engine', result: r.results[0] };
    },
  },
  {
    name: 'scan_strategies',
    description: 'Run several strategies across holdings, the watchlist or given symbols in one batch, and rank live setups (in-trade and setup stages first). Use for "which of my holdings have a setup".',
    input: z.object({
      ids: z.array(z.string()).max(30).optional().describe('Strategy ids; omit for all mechanical strategies.'),
      scope: z.enum(['holdings', 'watchlist', 'symbols']).default('holdings'),
      symbols: z.array(z.string().min(1).max(24)).max(200).optional(),
      onlyLive: z.boolean().default(true).describe('Return only rows with a setup or open simulated trade.'),
    }),
    timeoutMs: 120_000,
    async handler(q, ctx) {
      const all = await listAll(ctx);
      const chosen = all.strategies.filter((s) => s.mechanical && (!q.ids || q.ids.map(keyOf).includes(s.key)));
      let symbols: string[] = q.symbols ?? [];
      if (q.scope === 'holdings') symbols = ((await fetchPortfolio(ctx)).d.positions || []).map((p: any) => p.symbol);
      if (q.scope === 'watchlist') symbols = ((await ctx.finsight.get('/api/watchlist', {}, ctx.signal)).watchlist || []).map((w: any) => w.symbol);
      symbols = [...new Set(symbols.map((s) => s.toUpperCase()))].filter((s) => !/[=^]/.test(s)).slice(0, 200);
      if (!symbols.length || !chosen.length) return { rows: [], note: 'Nothing to scan.' };
      const bars = await barsFor(ctx, symbols);
      const jobs = symbols.flatMap((sym) => chosen.map((s) => ({ id: s.key, symbol: sym, bars: bars.get(sym) || [] })))
        .filter((j) => j.bars.length >= 60);
      const r = await runSandbox<{ results: any[] }>(roots(ctx), { op: 'run', jobs }, Math.min(110_000, 5_000 + jobs.length * 200));
      const rank = (x: any) => (x.openTrade ? 0 : (x.stage?.code || '').match(/setup|trigger|buy|zone|ready|armed/i) ? 1 : 2);
      let rows = r.results.filter((x) => !x.error).map((x) => ({ strategy: x.id, symbol: x.symbol, stage: x.stage?.label ?? null, detail: x.stage?.detail ?? null,
        openTrade: x.openTrade, latestSetup: x.recentSetups?.[x.recentSetups.length - 1] ?? null, lastBar: x.lastBar, symbolStats: x.stats, rank: rank(x) }));
      if (q.onlyLive) rows = rows.filter((x) => x.rank < 2);
      rows.sort((a, b) => a.rank - b.rank || a.symbol.localeCompare(b.symbol));
      return { asOf: new Date().toISOString(), scanned: { symbols: symbols.length, strategies: chosen.map((s) => `${s.id} (${s.status})`), jobs: jobs.length,
        skippedShortHistory: symbols.length * chosen.length - jobs.length }, label: RESEARCH_LABEL, rows: rows.slice(0, 60),
        errors: r.results.filter((x) => x.error).slice(0, 10) };
    },
  },
  {
    name: 'size_position',
    description: 'Position size for a planned entry/stop, computed from the user\'s actual net worth, cash and current position: shares = (equity x risk%) / (entry - stop) in base currency. Flags exceeding cash, concentration and earnings inside the window. Risk % and caps are PLACEHOLDERS unless the policy accepts them.',
    input: z.object({
      symbol: z.string().min(1).max(24), entry: z.number().positive(), stop: z.number().positive(),
      riskPct: z.number().positive().max(5).optional().describe('Percent of net worth risked if the stop is hit. Default 1 (placeholder).'),
      strategy: z.string().max(60).optional(),
    }),
    async handler(q, ctx) {
      if (q.stop >= q.entry) throw new AgentError('BAD_INPUT', 'Stop must be below entry for a long position.');
      const { d, asOf } = await fetchPortfolio(ctx);
      const base = d.base || 'SGD';
      const pos = (d.positions || []).find((p: any) => String(p.symbol).toUpperCase() === q.symbol.toUpperCase());
      const quote = pos ? null : ((await ctx.finsight.get('/api/quote', { symbols: q.symbol }, ctx.signal)).quotes || [])[0];
      const ccy = pos?.currency || quote?.currency || 'USD';
      let fx = d.fx?.[ccy];
      if (fx == null && ccy !== base) throw new AgentError('FX_MISSING', `No ${ccy}->${base} rate available; cannot size.`);
      fx = fx ?? 1;
      const netWorth = d.summary?.netWorth ?? 0;
      const cash = (d.cash || []).reduce((s: number, c: any) => s + (c.base || 0), 0);
      const riskPct = q.riskPct ?? PLACEHOLDER.riskPct;
      const riskBase = netWorth * riskPct / 100;
      const perShareRiskBase = (q.entry - q.stop) * fx;
      const shares = Math.floor(riskBase / perShareRiskBase);
      const costBase = shares * q.entry * fx;
      const existing = pos?.marketValue ?? 0;
      const resultingWeight = netWorth ? ((existing + costBase) / netWorth) * 100 : null;
      const warnings: string[] = [];
      if (costBase > cash) warnings.push(`Cost ${costBase.toFixed(0)} ${base} exceeds available cash ${cash.toFixed(0)} ${base}.`);
      if (resultingWeight != null && resultingWeight > PLACEHOLDER.maxPositionPct) warnings.push(`Resulting weight ${resultingWeight.toFixed(1)}% exceeds the ${PLACEHOLDER.maxPositionPct}% placeholder cap.`);
      try {
        const ev = await ctx.finsight.get('/api/events', { account: 'ALL' }, ctx.signal);
        const soon = (ev.events || []).filter((e: any) => String(e.symbol).toUpperCase() === q.symbol.toUpperCase() && e.time && e.time - Date.now() < PLACEHOLDER.earningsWindowDays * 864e5 && e.time > Date.now());
        for (const e of soon) warnings.push(`${e.type || 'Event'} on ${new Date(e.time).toISOString().slice(0, 10)} falls inside the next ${PLACEHOLDER.earningsWindowDays} days.`);
      } catch { warnings.push('Event calendar unavailable; earnings proximity not checked.'); }
      return {
        asOf, source: 'FinSight /api/portfolio (+ /api/quote, /api/events)', base, symbol: q.symbol, currency: ccy, fxToBase: fx,
        inputs: { netWorth: Math.round(netWorth), cash: Math.round(cash), riskPct, entry: q.entry, stop: q.stop, existingPositionValue: Math.round(existing) },
        formula: 'shares = floor((netWorth x riskPct/100) / ((entry - stop) x fxToBase))',
        result: { shares, costBase: Math.round(costBase), riskAmountBase: Math.round(riskBase), resultingWeightPct: resultingWeight == null ? null : Math.round(resultingWeight * 10) / 10 },
        warnings, placeholders: `Risk ${PLACEHOLDER.riskPct}% default and ${PLACEHOLDER.maxPositionPct}% cap are placeholders, not accepted policy.`,
      };
    },
  },
];
