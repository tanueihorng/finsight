// Assembles the tool registry and the deterministic context pack.
import { z } from 'zod';
import { ToolRegistry } from './registry.ts';
import type { ToolCtx, ToolDef } from './registry.ts';
import { uiTool } from './ui.ts';
import { attachmentTools } from './attachments.ts';
import { factsTools, fetchPortfolio, summarise } from './facts.ts';
import { recordsTools } from './records.ts';
import { strategyTools } from './strategies.ts';
import { webTools } from './web.ts';
import { addProposal } from '../store/db.ts';
import type { Skill } from '../skills.ts';
import { skillTools } from '../skills.ts';

const r1 = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 10) / 10 : null);

/** Dated, compact snapshot (≈1–3k tokens) built only by code. */
export async function buildContextPack(ctx: ToolCtx, base = 'SGD') {
  const asOf = new Date().toISOString();
  const { d } = await fetchPortfolio(ctx, undefined, base);
  const positions: any[] = d.positions || [];
  const byCcy = new Map<string, number>();
  for (const p of positions) byCcy.set(p.currency, (byCcy.get(p.currency) ?? 0) + (p.marketValue || 0));
  for (const c of d.cash || []) byCcy.set(c.ccy, (byCcy.get(c.ccy) ?? 0) + (c.base || 0));
  const net = d.summary?.netWorth || 0;
  let events: any[] = [];
  try {
    const ev = await ctx.finsight.get('/api/events', { account: 'ALL' }, ctx.signal);
    events = (ev.events || []).filter((e: any) => e.time && e.time > Date.now() - 864e5 && e.time < Date.now() + 14 * 864e5)
      .slice(0, 15).map((e: any) => ({ symbol: e.symbol, type: e.type, date: new Date(e.time).toISOString().slice(0, 10) }));
  } catch { /* optional */ }
  return {
    asOf, source: 'FinSight (computed by agent code)',
    summary: summarise(d, base),
    topPositions: positions.slice(0, 15).map((p) => ({ symbol: p.symbol, name: p.name, ccy: p.currency, weightPct: r1(p.weight), value: Math.round(p.marketValue), unrealizedPct: r1(p.unrealizedPct) })),
    otherPositions: Math.max(0, positions.length - 15),
    currencySplitPct: [...byCcy.entries()].map(([ccy, v]) => ({ ccy, pct: net ? r1((v / net) * 100) : null })).sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0)),
    cash: (d.cash || []).map((c: any) => ({ ccy: c.ccy, amount: Math.round(c.amount), base: Math.round(c.base) })),
    eventsNext14d: events,
    notes: [
      'Liabilities (e.g. loans) are not tracked in FinSight; net worth here excludes them.',
      'Sector exposure has no ETF look-through.',
      'Policy v0.1: limits and weights are proposals/placeholders unless the policy says accepted.',
    ],
  };
}

const contextPackTool: ToolDef = {
  name: 'get_context_pack',
  description: 'Compact dated snapshot of the user\'s situation: net worth, cash, top 15 positions with weights, currency split, events in the next 14 days, and known data gaps. Cheap first call for broad questions.',
  input: z.object({ base: z.enum(['SGD', 'USD']).optional() }),
  async handler({ base }, ctx) { return buildContextPack(ctx, base || 'SGD'); },
};

const proposeNote: ToolDef = {
  name: 'propose_record_update',
  description: 'When the user states a durable personal fact or decision in chat (e.g. "my loan rate is 4.5%"), store it as a PROPOSAL for the user to confirm. Nothing is written to their records.',
  input: z.object({ kind: z.enum(['profile', 'decision', 'thesis', 'strategy_status']), target: z.string().max(200).optional(), text: z.string().min(3).max(2000) }),
  async handler({ kind, target, text }, ctx) {
    const id = addProposal(ctx.db, { kind, target, body: text, sourceTurn: ctx.turnId });
    return { stored: true, id, status: 'pending', note: 'Saved as a proposal only. The user must confirm it before any record changes.' };
  },
};

export function buildRegistry(skills: () => Map<string, Skill> = () => new Map()): ToolRegistry {
  return new ToolRegistry().add(uiTool, contextPackTool, ...factsTools, ...attachmentTools, ...recordsTools, ...strategyTools, ...webTools, proposeNote, ...skillTools(skills));
}
