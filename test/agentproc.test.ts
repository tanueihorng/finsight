// Agent supervisor: not-installed detection, start, crash restart with backoff,
// stop, and reuse of an agent that is already running. Uses a tiny fake agent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import type { AgentState } from '../lib/agentproc.ts';

function freePort(): Promise<number> { return new Promise((r) => { const s = http.createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as import('node:net').AddressInfo).port; s.close(() => r(p)); }); }); }

function fakeAgent({ installed = true }: { installed?: boolean } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-agent-'));
  fs.mkdirSync(path.join(dir, 'src'));
  if (installed) fs.mkdirSync(path.join(dir, 'node_modules'));
  // Crashes on its first run (marker file), then serves on AGENT_PORT until SIGTERM.
  fs.writeFileSync(path.join(dir, 'src', 'cli.ts'), `
    const fs = require('fs'), http = require('http'), path = require('path');
    const marker = path.join(${JSON.stringify(dir)}, 'ran-once');
    if (process.env.FAKE_CRASH_FIRST === '1' && !fs.existsSync(marker)) { fs.writeFileSync(marker, '1'); process.exit(3); }
    const s = http.createServer((q, r) => r.end('ok')).listen(Number(process.env.AGENT_PORT), '127.0.0.1');
    process.on('SIGTERM', () => s.close(() => process.exit(0)));
  `);
  return dir;
}

// agentproc reads its configuration (and lib/config.ts its data dir) once,
// when it loads. Each scenario therefore runs in a fresh Node process with its
// own environment, and reports what it observed as JSON.
const AGENTPROC = new URL('../lib/agentproc.ts', import.meta.url).href;
const PRELUDE = `
  import http from 'node:http';
  import fs from 'node:fs';
  const ap = await import(${JSON.stringify(AGENTPROC)});
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const listening = (port) => new Promise((r) => { const q = http.get({ host: '127.0.0.1', port, path: '/' }, (res) => { res.resume(); r(true); }); q.on('error', () => r(false)); });
  const out = {};
`;
function scenario(env: Record<string, string>, body: string): Record<string, any> {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', PRELUDE + body + '\nconsole.log(JSON.stringify(out));'], {
    encoding: 'utf8', timeout: 30_000,
    env: { ...process.env, AGENT_SHELL_ENV: '0', AGENT_AUTOSTART: '', FINSIGHT_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'fs-data-')), ...env },
  });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout.trim().split('\n').pop()!);
}

test('reports not-installed when the agent has no dependencies', async () => {
  const o = scenario({ AGENT_DIR: fakeAgent({ installed: false }), AGENT_URL: `http://127.0.0.1:${await freePort()}` },
    'out.s = await ap.start(8001);');
  const s: AgentState = o.s;
  assert.equal(s.status, 'not-installed'); assert.match(s.message, /agent:install/);
});

test('respects AGENT_AUTOSTART=0', async () => {
  const o = scenario({ AGENT_DIR: fakeAgent(), AGENT_URL: `http://127.0.0.1:${await freePort()}`, AGENT_AUTOSTART: '0' },
    'out.status = (await ap.start(8001)).status;');
  assert.equal(o.status, 'disabled');
});

test('starts the agent, restarts it after a crash, stops it on shutdown; log is private', async () => {
  const port = await freePort();
  const o = scenario({ AGENT_DIR: fakeAgent(), AGENT_URL: `http://127.0.0.1:${port}`, FAKE_CRASH_FIRST: '1' }, `
    await ap.start(8001);
    await sleep(400);
    out.afterCrash = ap.status().status;
    for (let i = 0; i < 40 && !(await listening(${port})); i++) await sleep(150); // backoff 2 s, then up
    out.up = await listening(${port});
    out.running = ap.status().status; out.restarts = ap.status().restarts;
    out.logMode = fs.statSync(ap.status().logFile).mode & 0o777;
    await ap.stop();
    out.stopped = ap.status().status;
    out.downAfterStop = !(await listening(${port}));
  `);
  assert.equal(o.afterCrash, 'restarting', 'first run crashed and a restart is scheduled');
  assert.equal(o.up, true);
  assert.equal(o.running, 'running'); assert.equal(o.restarts, 1);
  assert.equal(o.logMode, 0o600);
  assert.equal(o.stopped, 'stopped');
  assert.equal(o.downAfterStop, true);
});

test('uses an agent that is already running instead of starting a second one', async () => {
  const port = await freePort();
  // The scenario runs with spawnSync (this process waits), so the running
  // "agent" lives in its own process too.
  const holder = spawn(process.execPath, ['-e',
    `require('http').createServer((q, r) => r.end('ok')).listen(${port}, '127.0.0.1', () => console.log('up'))`], { stdio: ['ignore', 'pipe', 'ignore'] });
  try {
    await new Promise((r) => holder.stdout!.once('data', r));
    const o = scenario({ AGENT_DIR: fakeAgent(), AGENT_URL: `http://127.0.0.1:${port}` }, 'out.s = await ap.start(8001);');
    assert.equal(o.s.status, 'external'); assert.equal(o.s.pid, null);
  } finally { holder.kill(); }
});
