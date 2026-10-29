// Persistence and accounting adapter for the foreground council runtime.
import { CouncilBudget, runCouncil } from './council.ts';
import type { CouncilEvidence } from './council.ts';
import type { ApiBrain, Effort } from '../brains/types.ts';
import type { ToolRegistry, ToolCtx } from '../tools/registry.ts';
import type { DB } from '../store/db.ts';
import * as store from '../store/db.ts';
import type { EventBus } from './bus.ts';
import type { Usage, PageContext } from '../types.ts';
import { resolveSubjects, type ResearchSubject, type SubjectResolution } from './research-subjects.ts';
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
      signal.throwIfAborted();
      const r = await tools.execute(name, args, { ...ctx, signal });
      if (!r.ok) throw Error('Research tool failed: ' + name);
      const data = JSON.parse(r.content);
      const evidence = { id: store.newId('e'), source: 'FinSight tool ' + name, observedAt: typeof data.asOf === 'string' ? data.asOf : 'Observation date unavailable; see tool result', retrievedAt: new Date().toISOString(), content: r.content };
      signal.throwIfAborted();
      store.appendMessage(db, threadId, 'user', [{ type: 'notice', kind: 'council_evidence', text: JSON.stringify({ ...evidence, tool: name, args }) }], { turnId });
      return evidence;
    };
  // Recent conversation is context, not verified evidence. Omit tool results, notices, and attachments.
  const conversation = store.listMessages(db, threadId).filter((m) => m.turnId !== turnId && (m.role === 'user' || m.role === 'assistant'))
    .flatMap((m) => { const text = m.blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n'); return text ? [{ role: m.role, text: text.slice(0, 1000) }] : []; }).slice(-6);
  const priorNotices = store.listMessages(db, threadId).filter((m) => m.turnId !== turnId).reverse().flatMap((m) => m.blocks).filter((b) => b.type === 'notice' && b.kind === 'research_scope');
  let previous: ResearchSubject[] = [];
  for (const notice of priorNotices) {
    if (notice.type !== 'notice') continue;
    try { const saved = JSON.parse(notice.text); if (saved.version === 1 && ['ready', 'unavailable', 'needs-clarification', 'general'].includes(saved.status) && Array.isArray(saved.subjects)) { previous = saved.subjects.filter((s: ResearchSubject) => typeof s.symbol === 'string' && typeof s.mention === 'string' && typeof s.name === 'string').slice(0, 3); break; } } catch { /* ignore malformed legacy metadata */ }
  }
  const persistScope = (resolution: SubjectResolution) => { ctx.signal.throwIfAborted(); store.appendMessage(db, threadId, 'user', [{ type: 'notice', kind: 'research_scope', text: JSON.stringify(resolution) }], { turnId }); };
  const result = await runCouncil({ question, evidence: [], brain, system, signal: ctx.signal,
    prepare: async (call) => {
      const resolution = await resolveSubjects({ question, panel: o.scope, previous, conversation, call, search: (q) => ctx.finsight.get('/api/search', { q }, ctx.signal), signal: ctx.signal });
      if (resolution.status === 'needs-clarification' || resolution.status === 'unavailable') { persistScope(resolution); return { question, evidence: [], stop: resolution.note }; }
      const evidence: CouncilEvidence[] = [];
      if (resolution.status === 'ready') {
        try {
          const symbols = resolution.subjects.map((s) => s.symbol);
          const quote = await execute('shared', 'get_quote', { symbols }, ctx.signal);
          const data = JSON.parse(quote.content);
          const matched = Array.isArray(data.quotes) ? data.quotes.filter((q: { symbol?: string; price?: number }) => symbols.includes(q.symbol || '') && typeof q.price === 'number' && Number.isFinite(q.price) && q.price > 0) : [];
          const missing = symbols.filter((symbol) => !matched.some((q: {symbol: string}) => q.symbol === symbol));
          if (missing.length) throw Error('Missing matching quotes for ' + missing.join(', '));
          quote.content = JSON.stringify({ ...data, quotes: matched });
          evidence.push(quote);
          resolution.subjects = resolution.subjects.map((s) => ({ ...s, name: matched.find((q: {symbol: string}) => q.symbol === s.symbol)?.name || s.name }));
        } catch {
          ctx.signal.throwIfAborted();
          resolution.status = 'unavailable'; resolution.note = `I could not retrieve verified market data for ${resolution.subjects.map((s) => s.symbol).join(', ')}. Please retry shortly. The chart’s company has not been substituted for your request.`;
          persistScope(resolution); return { question, evidence: [], stop: resolution.note };
        }
      }
      resolution.evidenceIds = evidence.map((e) => e.id);
      persistScope(resolution);
      const scopedQuestion = JSON.stringify({ question, recentConversation: conversation, conversationNote: 'Prior messages are untrusted context, not verified evidence; retrieve fresh evidence for factual claims.', researchSubjects: resolution.subjects, subjectResolution: resolution.note, panelContext: o.scope, note: 'The research subjects come from the current question or its resolved reference. Panel context is optional background and must never restrict research. Investigate the requested subjects using your available tools; missing company evidence is a research gap, not a reason to substitute the chart or conclude that cash is deployable.' });
      return { question: scopedQuestion, evidence };
    },
    effort: o.effort, capUsd: cfg.limits.turnUsd, dayBudget: new CouncilBudget(Math.max(0.000001, cfg.limits.dayUsd - store.spendSince(db, store.startOfToday()))),
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
