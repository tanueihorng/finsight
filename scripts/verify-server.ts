#!/usr/bin/env node
// Starts a throwaway FinSight for verifying a change in a browser: offline fake
// market, a fresh temp data folder, Kestrel off, the PIN set and the demo
// portfolio imported. It never reads ~/FinSightData and refuses the personal,
// default and demo ports. Stop it with Ctrl-C; the data folder is removed.
//   node scripts/verify-server.ts [--port 8091] [--empty]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEMO_CSV } from './demo-portfolio.ts';

const args = process.argv.slice(2);
const port = Number(args[args.indexOf('--port') + 1] || process.env.VERIFY_PORT || 8091);
if (!Number.isInteger(port) || [8000, 8001, 8003, 8100, 8103].includes(port)) {
  console.error(`verify-server: refusing port ${port} (personal, default, demo or agent port)`); process.exit(2);
}
const PIN = '2468'; // synthetic data only
const root = path.join(import.meta.dirname, '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'finsight-verify-'));
const base = `http://127.0.0.1:${port}`;

const child = spawn(process.execPath, [path.join(root, 'server.ts')], {
  cwd: root, stdio: ['ignore', 'inherit', 'inherit'],
  env: { ...process.env, PORT: String(port), FINSIGHT_DATA_DIR: dataDir, FINSIGHT_FAKE_MARKET: '1', NOTIFY: '0',
    AGENT_AUTOSTART: '0', AGENT_URL: 'http://127.0.0.1:9', AGENT_HOME: path.join(dataDir, 'agent'),
    RECORDS_DIR: path.join(dataDir, 'records'), OPENAI_API_KEY: '' },
});
const stop = (code: number) => { child.kill(); fs.rmSync(dataDir, { recursive: true, force: true }); process.exit(code); };
process.on('SIGINT', () => stop(0)); process.on('SIGTERM', () => stop(0));
child.on('exit', (c) => { console.error(`verify-server: FinSight exited (${c})`); fs.rmSync(dataDir, { recursive: true, force: true }); process.exit(1); });

async function call(p: string, body?: unknown, cookie = ''): Promise<Response> {
  const res = await fetch(base + p, body === undefined ? { headers: { cookie } }
    : { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${p}: HTTP ${res.status} ${await res.text()}`);
  return res;
}

try {
  for (let i = 0; ; i++) {
    try { await call('/api/health'); break; } catch (e) { if (i > 150) throw e; await new Promise((r) => setTimeout(r, 200)); }
  }
  await call('/api/auth/setup', { pin: PIN });
  if (!args.includes('--empty')) {
    const login = await call('/api/auth/login', { pin: PIN });
    const cookie = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
    await call('/api/portfolio/import?base=SGD', { csv: DEMO_CSV, replace: true }, cookie);
  }
  console.log(JSON.stringify({ ready: true, url: base, pin: PIN, dataDir, seeded: !args.includes('--empty') }));
} catch (e) {
  console.error('verify-server:', (e as Error).message); stop(1);
}
