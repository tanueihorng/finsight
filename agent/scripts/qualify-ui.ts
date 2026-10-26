// Explicitly opt-in live evaluation. Never imported by tests or normal startup.
// Credentials stay in the existing secret store; only synthetic cases are sent.
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { loadConfig } from '../src/config.ts';
import { loadBrains } from '../src/brains/registry.ts';
import { costOf, type ApiBrain, type StepRequest } from '../src/brains/types.ts';
import { AgentError } from '../src/types.ts';
import { ChatEngine } from '../src/chat/engine.ts';
import { EventBus } from '../src/chat/bus.ts';
import * as store from '../src/store/db.ts';
import { ToolRegistry } from '../src/tools/registry.ts';
import { buildRegistry } from '../src/tools/index.ts';
import { bindUi, type UiState } from '../src/tools/ui.ts';
import { UiRequest } from '../src/ui/schema.ts';
import { UI_CASES, median, type UiCase } from '../src/ui/qualification.ts';

if (!process.argv.includes('--live')) throw new Error('Live provider calls require --live and an explicit --out directory.');
const outArg = process.argv.indexOf('--out');
if (outArg < 0 || !process.argv[outArg + 1]) throw new Error('Specify --out <existing evaluation packet directory>');
const out = path.resolve(process.argv[outArg + 1]!);
if (!fs.statSync(out).isDirectory()) throw new Error('Output directory must exist');
const production = loadConfig();
const discovered = loadBrains(production); // resolve existing credentials before test helper disables Keychain
const pick = process.argv.includes('--models') ? new Set(process.argv[process.argv.indexOf('--models') + 1]!.split(',')) : null;
const integerArg = (name: string, min: number, max: number, fallback: number) => {
  const i = process.argv.indexOf(name); if (i < 0) return fallback;
  const n = Number(process.argv[i + 1]);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name} must be an integer from ${min} to ${max}`);
  return n;
};
const perfRepeats = integerArg('--performance-repeats', 1, 3, 0);
const cases = perfRepeats ? Array.from({ length: perfRepeats }, (_, i) => UI_CASES.filter((c) => c.paired).map((c) => ({ ...c, id: `${c.id}-repeat-${i + 1}` }))).flat() : null;
const limit = integerArg('--limit', 1, 40, 40);
if (perfRepeats && process.argv.includes('--limit')) throw new Error('Do not combine --performance-repeats with --limit');
const eligible = [...discovered.brains.values()].filter((b) => (!pick || pick.has(b.manifest.id)) && b.available && ['anthropic', 'openai-compatible', 'openai-responses'].includes(b.manifest.transport));
const ledger = new Database(production.dbPath, { fileMustExist: true });
ledger.pragma('busy_timeout = 5000');
const spent = () => (ledger.prepare('SELECT COALESCE(SUM(usd),0) total FROM cost_ledger WHERE ts >= ?').get(store.startOfToday()) as { total: number }).total;
const startSpend = spent(); let reserved = 0, runCost = 0;
const { fakeFinsight, testConfig, testCtx } = await import('../test/helpers.ts');
const fake = await fakeFinsight({ scopedAccounts: true });
const allowed = new Set(['get_portfolio', 'query_positions', 'get_cash', 'get_exposures', 'get_accounts', 'get_quote', 'render_ui']);
const defs = buildRegistry().list().filter((t) => allowed.has(t.name));
const results: Record<string, unknown> = {};
const skipped = [...discovered.brains.values()].filter((b) => !eligible.includes(b)).map((b) => ({ id: b.manifest.id, reason: !b.available ? 'credentials unavailable' : b.manifest.transport === 'claude-code' ? 'CLI bridge unsupported in Phase 1' : 'not selected in this run' }));
const writeSummary = () => fs.writeFileSync(path.join(out, 'live-summary.json'), JSON.stringify({ syntheticOnly: true, toolSurface: [...allowed], dayLimitUsd: production.limits.dayUsd, startSpendUsd: startSpend, runCostUsd: runCost, skipped, results }, null, 2));
writeSummary();

async function qualify(entry: typeof eligible[number]) {
  const id = entry.manifest.id;
  const created = entry.create(); if (created.kind !== 'api') return;
  const native: ApiBrain = created;
  const cfg = testConfig(fake, { uiViews: true, defaultBrain: id });
  cfg.limits = { ...production.limits };
  const details: any[] = [];
  let modelCost = 0, unknownUsage = false, blocked = '';
  let providerError: { status?: string; code?: string; param?: string } | null = null;
  async function turn(c: UiCase, enabled: boolean) {
    const db = store.openDb(':memory:'), bus = new EventBus(db), ctx = testCtx(cfg, db);
    const brain: ApiBrain = { ...native, manifest: { ...native.manifest, capabilities: { ...native.manifest.capabilities, ui: enabled } },
      async step(req: StepRequest) {
        const worst = costOf(native.manifest, { inputTokens: Buffer.byteLength(JSON.stringify({ system: req.system, messages: req.messages, tools: req.tools })) + 1024, outputTokens: native.manifest.maxOutputTokens });
        if (spent() + reserved + worst > production.limits.dayUsd) throw new AgentError('BUDGET_EXCEEDED', 'Existing daily spend cap prevents another evaluation request');
        reserved += worst;
        try {
          const res = await native.step(req);
          if (res.usage.inputTokens == null || res.usage.outputTokens == null) { unknownUsage = true; throw new AgentError('USAGE_UNKNOWN', 'Provider did not report complete usage'); }
          const cost = costOf(native.manifest, res.usage, res.searches);
          ledger.prepare('INSERT INTO cost_ledger(ts,brain,kind,units,usd,price_version) VALUES (?,?,?,?,?,?)').run(Date.now(), id, 'ui_qualification', res.usage.inputTokens + res.usage.outputTokens, cost, native.manifest.pricing.version);
          runCost += cost; modelCost += cost;
          return res;
        } catch (e) {
          const message = String((e as Error).message);
          if ((e as AgentError).code?.startsWith('PROVIDER')) providerError = { status: message.match(/returned (\d+)/)?.[1], code: message.match(/"code"\s*:\s*"([^"]+)"/)?.[1], param: message.match(/"param"\s*:\s*"([^"]+)"/)?.[1] };
          throw e;
        } finally { reserved -= worst; }
      } };
    const tools = new ToolRegistry().add(...defs);
    const engine = new ChatEngine({ cfg, db, bus, tools, finsight: ctx.finsight, brains: new Map() });
    engine.setBrain(id, brain);
    const th = store.createThread(db), t0 = Date.now();
    const { turnId } = engine.send({ threadId: th.id, content: c.prompt, brain: id });
    while (engine.isRunning(th.id)) await new Promise((r) => setTimeout(r, 25));
    const duration = Date.now() - t0;
    const record = db.prepare('SELECT status,error,stop_reason FROM turns WHERE id = ?').get(turnId) as { status: string; error: string | null; stop_reason: string | null };
    const messages = store.listMessages(db, th.id);
    const views = store.listUiViews(db, th.id);
    const calls = messages.flatMap((m) => m.blocks).filter((b) => b.type === 'tool_call');
    const toolResults = messages.flatMap((m) => m.blocks).filter((b) => b.type === 'tool_result');
    const uiCalls = calls.filter((c) => c.name === 'render_ui');
    const accepted = uiCalls.map((c) => toolResults.some((r) => r.callId === c.id && r.ok));
    const state: UiState = { enabled: true, attempts: 0, completed: new Map() };
    for (const r of toolResults) if (r.ok && r.name !== 'render_ui') {
      const call = calls.find((c) => c.id === r.callId); const args = call?.args as { account?: string } | undefined;
      try {
        const data = JSON.parse(r.content), ref = data.uiSource?.ref;
        if (typeof ref === 'string') state.completed.set(ref, { callId: r.callId, name: r.name, data, completedAt: new Date().toISOString(), account: args?.account || 'ALL' });
      } catch { /* not a usable source */ }
    }
    let faithful = true;
    for (const view of views) {
      try { const call = uiCalls.find((c) => c.id === view.callId)!; faithful &&= JSON.stringify(bindUi(UiRequest.parse(call.args), state)) === JSON.stringify(view.spec); } catch { faithful = false; }
    }
    const text = messages.filter((m) => m.role === 'assistant').flatMap((m) => m.blocks).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    const cost = store.spendSince(db, 0);
    const row = { id: c.id, prompt: c.prompt, expected: c.kind, enabled, status: record.status, stopReason: record.stop_reason,
      appropriate: c.kind === 'text' ? uiCalls.length === 0 && record.status === 'succeeded' : record.status === 'succeeded' && views.some((v) => v.spec.components.some((x) => x.kind === c.kind)),
      providerError, attempts: accepted, faithful, costUsd: cost, ms: duration, views, text, calls: calls.map((c) => ({ name: c.name, args: c.args })) };
    // Prove a normal follow-up works after a complete UI-only answer, with no
    // fabricated assistant text inserted into the provider transcript.
    if (enabled && c.id === 'portfolio-1' && record.status === 'succeeded' && views.length) {
      const follow = engine.send({ threadId: th.id, content: 'Thanks. Define reporting currency in one sentence, with no view.', brain: id });
      while (engine.isRunning(th.id)) await new Promise((r) => setTimeout(r, 25));
      const done = db.prepare('SELECT status FROM turns WHERE id = ?').get(follow.turnId) as { status: string };
      (row as any).followup = { status: done.status, uiCount: store.listUiViews(db, th.id).filter((v) => v.turnId === follow.turnId).length,
        text: store.listMessages(db, th.id).filter((m) => m.turnId === follow.turnId && m.role === 'assistant').flatMap((m) => m.blocks).filter((b) => b.type === 'text').map((b) => b.text).join(' ') };
    }
    // Do not export providerExtra/hidden reasoning, credentials, private home or chat data.
    db.close();
    if (record.stop_reason === 'PROVIDER_INVALID' || record.stop_reason === 'USAGE_UNKNOWN' || record.stop_reason === 'BUDGET_EXCEEDED') blocked = record.stop_reason;
    return row;
  }
  try {
    for (const c of (cases ?? UI_CASES.slice(0, limit))) {
      const candidate = await turn(c, true);
      let baseline = null;
      if (c.paired && !blocked) baseline = await turn(c, false);
      details.push({ candidate, baseline });
      fs.writeFileSync(path.join(out, `${id}.json`), JSON.stringify(details, null, 2));
      console.log(JSON.stringify({ model: id, case: c.id, ok: candidate.appropriate, attempts: candidate.attempts, ms: candidate.ms, costUsd: candidate.costUsd, totalUsd: runCost }));
      if (blocked || unknownUsage) break;
    }
  } finally {
    const positives = details.filter((x) => x.candidate.expected !== 'text'), negatives = details.filter((x) => x.candidate.expected === 'text');
    const attempts = details.filter((x) => x.candidate.attempts.length), pairs = details.filter((x) => x.baseline && x.candidate.appropriate && x.candidate.views.length > 0 && x.candidate.status === 'succeeded' && x.baseline.status === 'succeeded');
    const ratio = (yes: number, total: number) => total ? yes / total : 0;
    const stats = { mode: perfRepeats ? 'performance-only' : 'full', completed: details.length, expectedCases: UI_CASES.length, positiveRate: ratio(positives.filter((x) => x.candidate.appropriate).length, positives.length),
      restraintRate: ratio(negatives.filter((x) => x.candidate.appropriate).length, negatives.length),
      firstTryRate: ratio(attempts.filter((x) => x.candidate.attempts[0]).length, attempts.length),
      repairRate: ratio(attempts.filter((x) => x.candidate.attempts.slice(0, 2).some(Boolean)).length, attempts.length),
      faithful: details.every((x) => x.candidate.faithful), followupPass: details.some((x) => x.candidate.followup?.status === 'succeeded' && x.candidate.followup.uiCount === 0), pairs: pairs.length,
      medianExtraCost: median(pairs.map((x) => x.candidate.costUsd / Math.max(x.baseline.costUsd, 1e-9) - 1)),
      medianExtraLatency: median(pairs.map((x) => x.candidate.ms / Math.max(x.baseline.ms, 1) - 1)),
      costUsd: modelCost, blocked: blocked || null, unknownUsage };
    const contractPass = !perfRepeats && stats.completed === UI_CASES.length && stats.positiveRate >= .85 && stats.restraintRate >= .9 && stats.firstTryRate >= .9 && stats.repairRate >= .98 && stats.faithful && stats.followupPass;
    const performancePass = stats.pairs >= 5 && stats.medianExtraCost !== null && stats.medianExtraCost <= .3 && stats.medianExtraLatency !== null && stats.medianExtraLatency <= .25;
    results[id] = { ...stats, contractPass, performancePass, enabled: false, note: 'Human clarity review and rollout decision still required.' };
    writeSummary();
    fs.rmSync(cfg.home, { recursive: true, force: true }); fs.rmSync(cfg.recordsDir, { recursive: true, force: true });
  }
}
try {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(2, eligible.length) }, async () => { while (next < eligible.length) { const entry = eligible[next++]!; await qualify(entry); } }));
} finally { writeSummary(); ledger.close(); await fake.close(); fs.rmSync(fake.dataDir, { recursive: true, force: true }); }
