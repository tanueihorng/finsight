// Test-only real HTTP API/engine/store with a deterministic non-provider brain.
import path from 'node:path';
import { loadConfig } from '../../agent/src/config.ts';
import { openDb } from '../../agent/src/store/db.ts';
import { EventBus } from '../../agent/src/chat/bus.ts';
import { ChatEngine } from '../../agent/src/chat/engine.ts';
import { buildRegistry } from '../../agent/src/tools/index.ts';
import { finsightClient } from '../../agent/src/tools/finsight.ts';
import { createApi } from '../../agent/src/api/server.ts';
import { BrainManifest } from '../../agent/src/brains/types.ts';
if (process.env.FINSIGHT_FAKE_MARKET !== '1' || !process.env.FINSIGHT_DATA_DIR?.includes('finsight-e2e-')) throw Error('Disposable synthetic E2E environment required');
const cfg = loadConfig({ ...process.env, AGENT_BRAIN: 'council-fixture', KESTREL_COUNCIL: '1' });
const db = openDb(cfg.dbPath), bus = new EventBus(db), tools = buildRegistry(), finsight = finsightClient(cfg.finsightUrl, cfg.finsightDataDir);
const manifest = BrainManifest.parse({ apiVersion: 1, kind: 'brain', id: 'council-fixture', label: 'Synthetic council fixture', model: 'fixture', transport: 'mock', pricing: { inputPerM: 0, outputPerM: 0, version: 'fixture' }, capabilities: { tools: true, streaming: false, contextTokens: 100000 }, costTier: '$', maxOutputTokens: 1200 });
const brain = { kind: 'api', manifest, async step(req) {
 const data = JSON.parse(req.messages[0].blocks[0].text);
 const question = String(data.question);
 if (question.includes('slow')) await new Promise((resolve, reject) => {
   const timer = setTimeout(resolve, 60000);
   req.signal.addEventListener('abort', () => { clearTimeout(timer); reject(Error('Aborted')); }, { once: true });
 });
 if (question.includes('partial') && req.system.includes('Council role: growth')) return { blocks: [], usage: { inputTokens: 10, outputTokens: 0 }, stopReason: 'refusal' };
 const first = data.evidence[0];
 const assessment = { findings: first ? [{ claim: 'Synthetic review backed by captured quote.', evidenceIds: [first.id], assumptions: [], uncertainty: 'Policy not supplied', counterevidence: [], invalidation: 'New evidence', missingEvidence: ['Accepted policy'] }] : [], unresolvedQuestions: ['Fixture only; not an investment opinion'] };
 return { blocks: [{ type: 'text', text: JSON.stringify(assessment) }], usage: { inputTokens: 100, outputTokens: 100 }, stopReason: 'end' };
} };
const brains = new Map([[manifest.id, { manifest, available: true, create: () => brain }]]);
const engine = new ChatEngine({ cfg, db, bus, tools, finsight, brains });
engine.setBrain(manifest.id, brain);
const server = createApi({ cfg, db, engine, bus, tools, finsight, brains, brainsInvalid: [] });
server.listen(cfg.port, '127.0.0.1');
async function stop() { await engine.drain(); server.closeAllConnections(); server.close(() => { db.close(); process.exit(); }); }
process.on('SIGTERM', stop); process.on('SIGINT', stop);
