// Persistence and accounting adapter for the foreground council runtime.
import { CouncilBudget, runCouncil } from './council.ts';
import type { ApiBrain, Effort } from '../brains/types.ts';
import type { ToolRegistry, ToolCtx } from '../tools/registry.ts';
import type { DB } from '../store/db.ts';
import * as store from '../store/db.ts';
import type { EventBus } from './bus.ts';
import type { Usage, PageContext } from '../types.ts';
export async function runStoredCouncil(o: { db: DB; bus: EventBus; tools: ToolRegistry; ctx: ToolCtx; brain: ApiBrain; system: string; question: string; usageTotal: Usage; effort?: Effort; scope?: PageContext }) {
  const { db, bus, tools, ctx, brain, system, question, usageTotal } = o;
  const { cfg } = ctx;
  const threadId = ctx.threadId!, turnId = ctx.turnId!;
  let step = 0;
  const progress = (text: string) => {
    if (ctx.signal.aborted) return;
    store.appendMessage(db, threadId, 'assistant', [{ type: 'notice', kind: 'council', text }], { brain: brain.manifest.id, turnId });
    bus.emit(threadId, 'council.progress', { turnId, text });
  };
  const execute = async (_role: string, name: string, args: unknown, signal: AbortSignal) => {
      const r = await tools.execute(name, args, { ...ctx, signal });
      if (!r.ok) throw Error('Research tool failed: ' + name);
      const data = JSON.parse(r.content);
      const evidence = { id: store.newId('e'), source: 'FinSight tool ' + name, observedAt: typeof data.asOf === 'string' ? data.asOf : 'Observation date unavailable; see tool result', retrievedAt: new Date().toISOString(), content: r.content };
      signal.throwIfAborted();
      store.appendMessage(db, threadId, 'user', [{ type: 'notice', kind: 'council_evidence', text: JSON.stringify({ ...evidence, tool: name, args }) }], { turnId });
      return evidence;
    };
  const initialEvidence = [];
  if (o.scope?.symbol) initialEvidence.push(await execute('shared', 'get_quote', { symbols: [o.scope.symbol] }, ctx.signal));
  const scopedQuestion = o.scope ? JSON.stringify({ question, panelContext: o.scope, note: 'Panel context is supplementary. The explicit user question determines relevance; do not assume the selected symbol is the requested subject.' }) : question;
  const result = await runCouncil({ question: scopedQuestion, evidence: initialEvidence, brain, system, signal: ctx.signal,
    maxSteps: cfg.limits.turnSteps, effort: o.effort, capUsd: cfg.limits.turnUsd, dayBudget: new CouncilBudget(Math.max(0.000001, cfg.limits.dayUsd - store.spendSince(db, store.startOfToday()))),
    tools: tools.schemas(),
    reserveCost: (maximum) => {
      // Persist before calling the provider; unknown/failure retains the
      // conservative reservation in the daily ledger, never a fake zero.
      const entry = db.prepare('INSERT INTO cost_ledger(ts,brain,kind,units,usd,price_version,turn_id,thread_id) VALUES (?,?,?,?,?,?,?,?)').run(Date.now(), brain.manifest.id, 'council-reserved', 0, maximum, brain.manifest.pricing.version, turnId, threadId);
      return (actual) => { if (actual !== null) db.prepare('UPDATE cost_ledger SET usd=?,kind=? WHERE id=?').run(actual, 'tokens', entry.lastInsertRowid); };
    },
    emit: (r) => progress(JSON.stringify(r)),
    account: (res, cost) => {
      usageTotal.inputTokens = usageTotal.inputTokens === null || res.usage.inputTokens === null ? null : usageTotal.inputTokens + res.usage.inputTokens;
      usageTotal.outputTokens = usageTotal.outputTokens === null || res.usage.outputTokens === null ? null : usageTotal.outputTokens + res.usage.outputTokens;
      usageTotal.cacheReadTokens = (usageTotal.cacheReadTokens ?? 0) + (res.usage.cacheReadTokens ?? 0);
      store.addTraceStep(db, turnId, step++, { kind: 'brain', name: brain.manifest.id, usage: res.usage, costUsd: cost ?? undefined, ok: true });
    },
    execute,
  });

  return result;
}
