// Opt-in synthetic probe. Does not open personal portfolio/chat DBs or restart services.
// env -u OPENAI_API_KEY AGENT_NO_KEYCHAIN=1 node agent/scripts/cache-probe.ts <private-agent-home> <output-dir>
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { stripTypeScriptTypes } from 'node:module';
import { systemPrompt } from '../src/chat/prompt.ts';
import { openAiBrain } from '../src/brains/openai.ts';
import { costOf, type BrainManifest } from '../src/brains/types.ts';
import { getSecret } from '../src/secrets.ts';
import { addTraceStep, openDb } from '../src/store/db.ts';
const [home, output] = process.argv.slice(2);
if (!home || !output || process.env.OPENAI_API_KEY) throw Error('Pass private agent home and output folder, with inherited OPENAI_API_KEY cleared');
const key = getSecret(home, 'DEEPSEEK_API_KEY');
if (!key) throw Error('DeepSeek credential unavailable');
const manifest = JSON.parse(fs.readFileSync(new URL('../plugins/brains/deepseek-flash/manifest.json', import.meta.url), 'utf8')) as BrainManifest;
manifest.maxOutputTokens = 32;
const oldSource = execFileSync('git', ['show', 'b8d6a01:agent/src/chat/prompt.ts'], { cwd: path.resolve(import.meta.dirname, '../..'), encoding: 'utf8' });
const old = await import('data:text/javascript,' + encodeURIComponent(stripTypeScriptTypes(oldSource)));
fs.mkdirSync(output, { recursive: true, mode: 0o700 });
const db = openDb(path.join(output, 'synthetic-cache.db'));
const brain = openAiBrain(manifest, key);
const rows: Record<string, unknown>[] = [];
let totalCostUsd = 0;
try {
  for (const [label, make] of [['before', old.systemPrompt], ['after', systemPrompt]] as const) {
    for (const [i, date] of ['2026-10-26', '2026-10-27', '2026-10-27'].entries()) {
      if (totalCostUsd > 0.02) throw Error('Probe cost stop reached');
      const system = make(new Date(date + 'T12:00:00Z'), { name: 'Kestrel synthetic cache probe', timezone: 'Asia/Singapore', skills: 'Synthetic only: no portfolio data. Return a single word.' });
      const start = Date.now();
      const r = await brain.step({ system, messages: [{ role: 'user', blocks: [{ type: 'text', text: 'Reply with OK.' }] }], tools: [], effort: 'none', signal: AbortSignal.timeout(30000), onText: () => {} });
      const costUsd = costOf(manifest, r.usage), ms = Date.now() - start;
      totalCostUsd += costUsd;
      addTraceStep(db, label, i, { kind: 'brain', name: manifest.id, usage: r.usage, costUsd, ms, ok: true });
      rows.push({ label, date, iteration: i, ...r.usage, costUsd, ms });
    }
  }
  fs.writeFileSync(path.join(output, 'cache-metrics.json'), JSON.stringify({ observedAt: new Date().toISOString(), model: manifest.model, synthetic: true, totalCostUsd, rows, limitations: 'One short sequence per variant, displayed synthetic dates only. Cache eviction, expiry and real daily traffic are not controlled. Costs use manifest peak rates, not an invoice.' }, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ totalCostUsd, rows }));
} finally { db.close(); }
