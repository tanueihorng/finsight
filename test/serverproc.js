'use strict';
// Runs a real server.js in a child process on a free port with an isolated data
// dir and the fake market, so HTTP behaviour (auth, parsing, persistence,
// shutdown) is tested end to end without network or the owner's data.
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const SERVER = path.join(__dirname, '..', 'server.js');

function freePort() { return new Promise((r) => { const s = http.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); }); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Raw request: the path is sent exactly as given (no client-side normalisation).
function request(port, method, p, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, method, path: p, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      const chunks = []; res.on('data', (c) => chunks.push(c));
      res.on('end', () => { const text = Buffer.concat(chunks).toString('utf8'); let json; try { json = JSON.parse(text); } catch {} resolve({ status: res.statusCode, headers: res.headers, text, json }); });
    });
    r.on('error', reject); if (body !== undefined) r.write(typeof body === 'string' ? body : JSON.stringify(body)); r.end();
  });
}
const cookieOf = (res) => String(res.headers['set-cookie'] || '').split(';')[0];

async function startServer({ dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'finsight-srv-')), env = {}, args = [] } = {}) {
  const port = await freePort();
  const out = [];
  const child = spawn(process.execPath, [...args, SERVER], {
    env: { ...process.env, FINSIGHT_DATA_DIR: dataDir, PORT: String(port), FINSIGHT_FAKE_MARKET: '1', NOTIFY: '0', FINSIGHT_CACHE_PERSIST: '0',
      ALERT_INTERVAL: '3600', AGENT_AUTOSTART: '0', AGENT_URL: 'http://127.0.0.1:9', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (c) => out.push(String(c))); child.stderr.on('data', (c) => out.push(String(c)));
  const exited = new Promise((r) => child.on('exit', (code, signal) => r({ code, signal })));
  for (let i = 0; ; i++) {
    try { await request(port, 'GET', '/api/health'); break; } catch {
      if (i > 200 || child.exitCode !== null) throw new Error('server did not start:\n' + out.join(''));
      await sleep(25);
    }
  }
  const s = {
    port, dataDir, child, exited, output: () => out.join(''),
    req: (method, p, opts) => request(port, method, p, opts),
    // SIGTERM and wait for the exit (the server's own shutdown path).
    async stop(sig = 'SIGTERM') { if (child.exitCode === null && child.signalCode === null) child.kill(sig); return exited; },
  };
  return s;
}

// Sets a PIN on a fresh server; returns the session cookie it issues.
async function setup(s, pin = '482916') {
  const r = await s.req('POST', '/api/auth/setup', { headers: { 'content-type': 'application/json' }, body: { pin } });
  if (r.status !== 200) throw new Error('setup failed: ' + r.text);
  return cookieOf(r);
}
const json = (cookie, body) => ({ headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, ...(body === undefined ? {} : { body }) });

module.exports = { startServer, setup, request, cookieOf, json, freePort, sleep, SERVER };
