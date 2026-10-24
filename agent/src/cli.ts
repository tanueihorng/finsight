#!/usr/bin/env node
// agent CLI: start | doctor | mcp | cost | brains
import { loadConfig } from './config.ts';
import { openDb, recoverTurns, pruneEvents, spendReport, startOfToday, spendSince } from './store/db.ts';
import { buildRegistry } from './tools/index.ts';
import { finsightClient, readAgentLink } from './tools/finsight.ts';
import { loadBrains } from './brains/registry.ts';
import { EventBus } from './chat/bus.ts';
import { ChatEngine } from './chat/engine.ts';
import { createApi } from './api/server.ts';
import { runMcp } from './mcp/server.ts';
import { log } from './log.ts';
import { AuditLog, setAudit } from './obs/audit.ts';
import { loadSkills, installFromGithub } from './skills.ts';
import fs from 'node:fs';

const cmd = process.argv[2] || 'start';
const cfg = loadConfig();
fs.mkdirSync(cfg.home, { recursive: true, mode: 0o700 });

const skillsState = { map: loadSkills(cfg.skillsDirs) };
const getSkills = () => skillsState.map.skills;

if (cmd === 'mcp') {
  setAudit(new AuditLog(cfg.logsDir, cfg.logRetentionDays));
  const db = openDb(cfg.dbPath);
  await runMcp(cfg, db, buildRegistry(getSkills), finsightClient(cfg.finsightUrl, cfg.finsightDataDir));
} else if (cmd === 'start') {
  setAudit(new AuditLog(cfg.logsDir, cfg.logRetentionDays));
  const db = openDb(cfg.dbPath);
  const interrupted = recoverTurns(db); pruneEvents(db);
  const { brains, invalid } = loadBrains(cfg);
  const tools = buildRegistry(getSkills);
  // Pick up new or edited skills without a restart.
  for (const s of cfg.skillsDirs) { try { fs.mkdirSync(s.dir, { recursive: true }); fs.watch(s.dir, { recursive: true }, () => { skillsState.map = loadSkills(cfg.skillsDirs); }); } catch { /* watch unsupported */ } }
  const finsight = finsightClient(cfg.finsightUrl, cfg.finsightDataDir);
  const bus = new EventBus(db);
  const engine = new ChatEngine({ cfg, db, tools, brains, finsight, bus, skills: getSkills });
  const server = createApi({ cfg, db, engine, bus, brains, brainsInvalid: invalid, tools, finsight, skills: getSkills });
  server.on('error', (e: NodeJS.ErrnoException) => {
    console.error(e.code === 'EADDRINUSE' ? `Agent port ${cfg.port} is in use. Is the agent already running?` : `Agent server error: ${e.message}`);
    process.exit(1);
  });
  server.listen(cfg.port, '127.0.0.1', () => {
    const avail = [...brains.values()].filter((b) => b.available).map((b) => b.manifest.id);
    console.log(`\n  ${cfg.assistantName} (FinSight agent)  http://127.0.0.1:${cfg.port} (loopback only; reached via FinSight /api/agent)`);
    console.log(`  data           ${cfg.dbPath}`);
    console.log(`  finsight       ${cfg.finsightUrl}${readAgentLink(cfg.finsightDataDir) ? '' : '  (agent-link.json missing: start FinSight first)'}`);
    console.log(`  models         ${avail.join(', ') || 'none available (add API keys)'}  default=${cfg.defaultBrain}`);
    console.log(`  tools          ${tools.list().length}${interrupted ? `   (${interrupted} interrupted turn(s) recovered)` : ''}`);
    console.log(`  skills         ${[...getSkills().keys()].join(', ') || 'none'}${skillsState.map.invalid.length ? `  (${skillsState.map.invalid.length} invalid)` : ''}`);
    console.log(`  logs           ${cfg.logsDir}  (${cfg.logRetentionDays} days)\n`);
    log('info', 'agent.started', { port: cfg.port, brains: avail, invalidBrains: invalid.length });
  });
  const shutdown = async () => { await engine.drain(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref(); };
  process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown); process.on('SIGHUP', shutdown);
  // When FinSight supervises us, exit if it disappears (e.g. killed with SIGKILL) so no agent is orphaned.
  const parent = Number(process.env.AGENT_PARENT_PID);
  if (parent) setInterval(() => { try { process.kill(parent, 0); } catch { log('warn', 'agent.parent_gone', { parent }); void shutdown(); } }, 2000).unref();
} else if (cmd === 'doctor') {
  const rows: [string, boolean, string][] = [];
  const link = readAgentLink(cfg.finsightDataDir);
  rows.push(['FinSight agent link', !!link, link ? `${cfg.finsightDataDir}/agent-link.json` : 'missing: start FinSight once to create it']);
  try { await finsightClient(cfg.finsightUrl, cfg.finsightDataDir).get('/api/accounts', {}, AbortSignal.timeout(4000)); rows.push(['FinSight reachable + token accepted', true, cfg.finsightUrl]); }
  catch (e) { rows.push(['FinSight reachable + token accepted', false, String((e as Error).message)]); }
  const { brains, invalid } = loadBrains(cfg);
  for (const b of brains.values()) rows.push([`model ${b.manifest.id}`, b.available, b.available ? b.manifest.label : String(b.reason)]);
  for (const i of invalid) rows.push([`model ${i.id}`, false, `invalid manifest: ${i.error}`]);
  rows.push(['web search key', !!(process.env.TAVILY_API_KEY || process.env.BRAVE_API_KEY) || hasKeychain('TAVILY_API_KEY') || hasKeychain('BRAVE_API_KEY'), 'TAVILY_API_KEY or BRAVE_API_KEY']);
  try { const db = openDb(cfg.dbPath); rows.push(['database', db.pragma('integrity_check', { simple: true }) === 'ok', cfg.dbPath]); } catch (e) { rows.push(['database', false, String(e)]); }
  for (const [name, ok, detail] of rows) console.log(`${ok ? '✓' : '✗'} ${name.padEnd(38)} ${detail}`);
  process.exit(rows.every((r) => r[1]) ? 0 : 1);
} else if (cmd === 'cost') {
  const db = openDb(cfg.dbPath);
  console.log(`Today: US$${spendSince(db, startOfToday()).toFixed(4)} of US$${cfg.limits.dayUsd} cap`);
  console.table(spendReport(db, startOfToday()));
} else if (cmd === 'logs') {
  // agent logs [turnId] [--kind tool] [--limit 200]
  const a = new AuditLog(cfg.logsDir, cfg.logRetentionDays);
  const args = process.argv.slice(3);
  const opt = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  const turnId = args.find((x) => x.startsWith('turn_'));
  for (const r of a.read({ turnId, kind: opt('--kind'), limit: Number(opt('--limit')) || 200, days: 7 })) {
    const { ts, kind, ...rest } = r as any;
    console.log(`${String(ts).slice(11, 23)} ${String(kind).padEnd(16)} ${JSON.stringify(rest).slice(0, Number(opt('--width')) || 400)}`);
  }
} else if (cmd === 'skills') {
  const sub2 = process.argv[3];
  if (sub2 === 'add' && process.argv[4]) {
    const r = await installFromGithub(process.argv[4], cfg.skillsDirs[1]!.dir);
    console.log(`Installed skill "${r.name}" (${r.files.length} files) to ${r.dir}\nReview ${r.dir}/SKILL.md before use: skills are instructions the model will follow.`);
  } else {
    for (const s of getSkills().values()) console.log(`${s.source === 'installed' ? '*' : ' '} ${s.name.padEnd(24)} ${s.description.slice(0, 100)}`);
    for (const i of skillsState.map.invalid) console.log(`✗ ${i.dir}: ${i.error}`);
    console.log('\n* = installed by you. Add one: agent skills add https://github.com/<owner>/<repo>/tree/<ref>/<path>');
  }
} else {
  console.log('usage: agent start | doctor | mcp | cost | logs [turnId] [--kind k] | skills [add <github-folder-url>]');
  process.exit(2);
}

function hasKeychain(name: string): boolean {
  try { return !!(require('node:child_process') as typeof import('node:child_process')).execFileSync('security', ['find-generic-password', '-s', 'finsight-agent', '-a', name, '-w'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); }
  catch { return false; }
}
