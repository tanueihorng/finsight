// Explicitly authorized bounded live evaluation. Synthetic evidence only.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import { CASES } from '../evals/council-cases.ts';
import { openAiBrain } from '../src/brains/openai.ts';
import { BrainManifest, costOf, type ApiBrain, type StepRequest, type StepResult } from '../src/brains/types.ts';
import { getSecret } from '../src/secrets.ts';
import { systemPrompt } from '../src/chat/prompt.ts';
import { Assessment, LENSES, validateAssessment } from '../src/chat/council-contract.ts';
import { CouncilBudget, runCouncil } from '../src/chat/council.ts';
const [home, output] = process.argv.slice(2);
if (!home || !output || process.env.OPENAI_API_KEY) throw Error('Use explicit private home/output and clear the retired inherited OpenAI key');
if (fs.existsSync(path.join(output, 'evaluation.json'))) throw Error('Evaluation output already exists; do not reset its spending ledger or repeat paid calls');
const key = getSecret(home, 'DEEPSEEK_API_KEY');
if (!key) throw Error('Configured DeepSeek credential unavailable');
const manifest = BrainManifest.parse(JSON.parse(fs.readFileSync(new URL('../plugins/brains/deepseek-flash/manifest.json', import.meta.url), 'utf8')));
manifest.maxOutputTokens = 1200;
const raw = openAiBrain(manifest, key);
const approvedRemaining = Number(process.env.COUNCIL_EVAL_REMAINING || '2');
if (!Number.isFinite(approvedRemaining) || approvedRemaining <= 0 || approvedRemaining > 2) throw Error('Invalid remaining evaluation allowance');
const globalBudget = new CouncilBudget(approvedRemaining);
const rows: Record<string, unknown>[] = [];
let measured = 0, reservedUnknown = 0, calls = 0, admissionFailures = 0;
fs.mkdirSync(output, { recursive: true, mode: 0o700 });
const sourceDigests = Object.fromEntries(['../src/chat/council.ts', '../src/chat/council-contract.ts', '../src/chat/prompt.ts', '../evals/council-cases.ts'].map((file) => [file, createHash('sha256').update(fs.readFileSync(new URL(file, import.meta.url))).digest('hex')]));
const report = () => fs.writeFileSync(path.join(output, 'evaluation.json'), JSON.stringify({ observedAt: new Date().toISOString(), synthetic: true, model: manifest.model, effort: 'none', maxOutputTokens: manifest.maxOutputTokens, ceilingUsd: approvedRemaining, sourceDigests, measuredUsd: measured, reservedUnknownUsd: reservedUnknown, calls, rows, limitations: 'Same-author pilot, not independent testing or investment efficacy. Costs use configured manifest rates, not an invoice. Heuristic flags require source-by-source review.' }, null, 2), { mode: 0o600 });
const estimate = (req: StepRequest) => ((Buffer.byteLength(JSON.stringify({ system: req.system, messages: req.messages, tools: req.tools })) + 8192) * manifest.pricing.inputPerM + manifest.maxOutputTokens * manifest.pricing.outputPerM) / 1e6;
function wrapped(reserve: boolean, turnBudget: CouncilBudget): ApiBrain {
 return { kind: 'api', manifest, async step(req) {
   const max = estimate(req); const day = reserve ? globalBudget.reserve(max) : undefined;
   let turn: ((n: number | null) => void) | undefined;
   try { turn = reserve ? turnBudget.reserve(max) : undefined; } catch (e) { day?.(0); throw e; }
   let actual: number | null = null;
   try {
     calls++; const res = await raw.step({ ...req, effort: 'none' });
     actual = res.usage.inputTokens === null || res.usage.outputTokens === null ? null : costOf(manifest, res.usage, res.searches);
     if (actual !== null) measured += actual;
     return res;
   } finally { day?.(actual); turn?.(actual); if (actual === null) reservedUnknown += max; report(); }
 } };
}
for (const item of CASES.filter((c) => !process.env.COUNCIL_EVAL_CASE || c.id === process.env.COUNCIL_EVAL_CASE)) {
 const evidence = item.evidence.map((content, i) => ({ id: 'e' + (i + 1), source: 'Synthetic fixture ' + item.id + '/' + (i + 1), observedAt: item.id === 'stale-quote' && i === 0 ? '2024-01-01' : '2026-10-28', retrievedAt: '2026-10-28', content }));
 const metadata = evidence.map(({content: _content, ...e}) => e);
 for (const mode of ['balanced', 'growth', 'simulated-council', 'real-council'].filter((m) => !process.env.COUNCIL_EVAL_MODE || m === process.env.COUNCIL_EVAL_MODE)) {
   if (admissionFailures >= 2) break;
   const started = Date.now(), before = measured;
   let runs: unknown;
   try {
     let assessment: z.infer<typeof Assessment> | undefined;
     if (mode === 'real-council') {
       const result = await runCouncil({ question: item.question, evidence, brain: wrapped(false, new CouncilBudget(0.05)), system: systemPrompt(new Date('2026-10-28T00:00:00Z')) + '\nKeep findings concise; maximum two findings per call.', effort: 'none', signal: AbortSignal.timeout(90000), capUsd: 0.05, dayBudget: globalBudget, tools: [], execute: async () => { throw Error('Live tools excluded from fixed-evidence comparison'); }, emit: () => {}, account: () => {} });
       runs = result.runs; assessment = result.runs.find((r) => r.role === 'chair')?.findings;
       if (!assessment || result.runs.some((r) => r.status !== 'completed')) throw Error('Council has failed stages');
     } else {
       const lens = mode === 'growth' ? JSON.stringify(LENSES.find((l) => l.id === 'growth')) : mode === 'simulated-council' ? 'Simulate business, macro, risk and chair perspectives in this one call; do not claim independent subagents.' : 'Balanced assessment';
       const req: StepRequest = { system: systemPrompt(new Date('2026-10-28T00:00:00Z')) + '\n' + lens + '\nUse only supplied evidence. Return strict JSON (no fences), at most two concise findings: ' + JSON.stringify(z.toJSONSchema(Assessment)), messages: [{ role: 'user', blocks: [{ type: 'text', text: JSON.stringify({ question: item.question, evidence }) }] }], tools: [], effort: 'none', signal: AbortSignal.timeout(45000), onText: () => {} };
       const res: StepResult = await wrapped(true, new CouncilBudget(0.05)).step(req);
       if (res.stopReason !== 'end') throw Error('Response not completed');
       assessment = validateAssessment(JSON.parse(res.blocks.filter((b) => b.type === 'text').map((b) => b.text).join('')), metadata);
     }
     rows.push({ case: item.id, expectedGap: item.gap, mode, status: 'completed', ms: Date.now() - started, measuredUsd: measured - before, assessment, runs });
   } catch (e) {
     const message = String((e as Error).message);
     if (/budget|admission/i.test(message)) admissionFailures++;
     rows.push({ case: item.id, expectedGap: item.gap, mode, status: 'failed', ms: Date.now() - started, measuredUsd: measured - before, runs, error: /budget/i.test(message) ? 'Budget admission failed' : 'Output or provider stage failed; inspect captured successful rows' });
   }
   report(); console.log(JSON.stringify({ case: item.id, mode, completed: rows.at(-1)?.status, measuredUsd: measured }));
 }
}
report();
