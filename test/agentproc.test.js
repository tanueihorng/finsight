'use strict';
// Agent supervisor: not-installed detection, start, crash restart with backoff,
// stop, and reuse of an agent that is already running. Uses a tiny fake agent.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

function freePort() { return new Promise((r) => { const s = http.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); }); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const listening = (port) => new Promise((r) => { const q = http.get({ host: '127.0.0.1', port, path: '/' }, (res) => { res.resume(); r(true); }); q.on('error', () => r(false)); });

function fakeAgent({ installed = true } = {}) {
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

function load(env) {
  for (const k of Object.keys(require.cache)) if (/lib[\\/](agentproc|config)\.js$/.test(k)) delete require.cache[k];
  Object.assign(process.env, { AGENT_SHELL_ENV: '0', AGENT_AUTOSTART: '', FINSIGHT_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'fs-data-')) }, env);
  return require('../lib/agentproc');
}

test('reports not-installed when the agent has no dependencies', async () => {
  const ap = load({ AGENT_DIR: fakeAgent({ installed: false }), AGENT_URL: `http://127.0.0.1:${await freePort()}` });
  const s = await ap.start(8001);
  assert.equal(s.status, 'not-installed'); assert.match(s.message, /agent:install/);
});

test('respects AGENT_AUTOSTART=0', async () => {
  const ap = load({ AGENT_DIR: fakeAgent(), AGENT_URL: `http://127.0.0.1:${await freePort()}`, AGENT_AUTOSTART: '0' });
  assert.equal((await ap.start(8001)).status, 'disabled');
});

test('starts the agent, restarts it after a crash, stops it on shutdown; log is private', async () => {
  const port = await freePort();
  const ap = load({ AGENT_DIR: fakeAgent(), AGENT_URL: `http://127.0.0.1:${port}`, FAKE_CRASH_FIRST: '1' });
  await ap.start(8001);
  await sleep(400);
  assert.equal(ap.status().status, 'restarting', 'first run crashed and a restart is scheduled');
  for (let i = 0; i < 40 && !(await listening(port)); i++) await sleep(150); // backoff 2 s, then up
  assert.equal(await listening(port), true);
  assert.equal(ap.status().status, 'running'); assert.equal(ap.status().restarts, 1);
  assert.equal(fs.statSync(ap.status().logFile).mode & 0o777, 0o600);
  await ap.stop();
  assert.equal(ap.status().status, 'stopped');
  assert.equal(await listening(port), false);
});

test('uses an agent that is already running instead of starting a second one', async () => {
  const port = await freePort();
  const srv = http.createServer((q, r) => r.end('ok')).listen(port, '127.0.0.1');
  try {
    const ap = load({ AGENT_DIR: fakeAgent(), AGENT_URL: `http://127.0.0.1:${port}` });
    const s = await ap.start(8001);
    assert.equal(s.status, 'external'); assert.equal(s.pid, null);
  } finally { srv.close(); }
});
