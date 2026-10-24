'use strict';
// Supervises the bundled agent (agent/) as a child process: FinSight starts it
// with the server, restarts it with backoff if it crashes, and stops it on
// shutdown. The agent stays a separate process so a crash or heavy work never
// stalls the terminal, and FinSight itself keeps zero runtime dependencies.
//   AGENT_AUTOSTART=0   don't start it        AGENT_DIR   agent folder (default ./agent)
//   AGENT_SHELL_ENV=0   don't load the login shell's environment (API keys from ~/.zshrc)
const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const { ROOT, DATA_DIR } = require('./config');

const AGENT_DIR = path.resolve(process.env.AGENT_DIR || path.join(ROOT, 'agent'));
const AGENT_URL = new URL(process.env.AGENT_URL || 'http://127.0.0.1:8100');
const LOG_FILE = path.join(DATA_DIR, 'agent', 'agent.log');
const MAX_CRASHES = 5, CRASH_WINDOW = 10 * 60e3;

const st = { status: 'stopped', pid: null, startedAt: null, restarts: 0, lastExit: null, message: '' };
let child = null, stopping = false, timer = null, crashes = [];

function portInUse(port, host) {
  return new Promise((resolve) => {
    const s = net.connect({ port, host }, () => { s.destroy(); resolve(true); });
    s.on('error', () => resolve(false));
    s.setTimeout(500, () => { s.destroy(); resolve(false); });
  });
}

function installed() {
  return fs.existsSync(path.join(AGENT_DIR, 'src', 'cli.ts')) && fs.existsSync(path.join(AGENT_DIR, 'node_modules'));
}

async function start(finsightPort) {
  stopping = false;
  if (process.env.AGENT_AUTOSTART === '0') return Object.assign(st, { status: 'disabled', message: 'AGENT_AUTOSTART=0' });
  if (!installed()) return Object.assign(st, { status: 'not-installed', message: 'Run: npm run agent:install' });
  const port = Number(AGENT_URL.port) || 8100;
  if (await portInUse(port, AGENT_URL.hostname)) {
    return Object.assign(st, { status: 'external', message: `An agent is already listening on ${port}; using it.` });
  }
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  const out = fs.openSync(LOG_FILE, 'a', 0o600);
  const env = {
    ...process.env, AGENT_PORT: String(port), FINSIGHT_URL: `http://127.0.0.1:${finsightPort}`,
    FINSIGHT_DATA_DIR: DATA_DIR, FINSIGHT_REPO: ROOT, AGENT_PARENT_PID: String(process.pid),
  };
  const cli = path.join(AGENT_DIR, 'src', 'cli.ts');
  // Launched from Finder or a launcher script, keys exported in ~/.zshrc are not in our
  // environment; an interactive login shell loads them. Keychain keys work either way.
  const shell = process.env.SHELL;
  const useShell = process.platform === 'darwin' && process.env.AGENT_SHELL_ENV !== '0' && shell && /(zsh|bash)$/.test(shell);
  const cmd = useShell ? shell : process.execPath;
  const args = useShell ? ['-ic', 'exec "$0" "$@"', process.execPath, cli, 'start'] : [cli, 'start'];
  child = spawn(cmd, args, { cwd: AGENT_DIR, env, stdio: ['ignore', out, out] });
  fs.closeSync(out);
  Object.assign(st, { status: 'running', pid: child.pid, startedAt: Date.now(), message: '' });
  child.on('exit', (code, signal) => {
    child = null;
    st.lastExit = { code, signal, at: Date.now() };
    if (stopping) return Object.assign(st, { status: 'stopped', pid: null });
    crashes = crashes.filter((t) => Date.now() - t < CRASH_WINDOW).concat(Date.now());
    if (crashes.length >= MAX_CRASHES) {
      return Object.assign(st, { status: 'crashed', pid: null, message: `Agent exited ${crashes.length} times in 10 min; not restarting. See ${LOG_FILE}` });
    }
    const wait = Math.min(60e3, 2000 * 2 ** (crashes.length - 1));
    Object.assign(st, { status: 'restarting', pid: null, message: `Agent exited (${signal || code}); restarting in ${wait / 1000}s` });
    timer = setTimeout(() => { st.restarts++; start(finsightPort); }, wait);
    timer.unref();
  });
  return st;
}

function stop() {
  stopping = true;
  if (timer) { clearTimeout(timer); timer = null; }
  if (!child) return Promise.resolve();
  const c = child;
  return new Promise((resolve) => {
    const kill = setTimeout(() => { try { c.kill('SIGKILL'); } catch { /* gone */ } }, 3000);
    c.once('exit', () => { clearTimeout(kill); resolve(); });
    try { c.kill('SIGTERM'); } catch { resolve(); }
  });
}

const status = () => ({ ...st, logFile: LOG_FILE, agentDir: AGENT_DIR, url: AGENT_URL.origin });

module.exports = { start, stop, status, installed };
