// Starts the strategy worker in a child process under Node's permission model.
// The child can read only its own script and the two strategy roots; network,
// file writes, child processes and worker threads are denied by default.
// One child per batch keeps a misbehaving engine from affecting later calls.
import { fork } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { AgentError } from '../types.ts';

const WORKER = path.join(path.dirname(new URL(import.meta.url).pathname), 'strategy-worker.cjs');

export type SandboxRoots = { builtinDir: string; privateDir: string };

export function runSandbox<T>(roots: SandboxRoots, msg: unknown, timeoutMs = 10_000, memoryMb = 256): Promise<T> {
  // Permissions are checked against real paths (macOS /var -> /private/var), so resolve symlinks first.
  const real = (p: string) => { try { return fs.realpathSync(p); } catch { return ''; } };
  const builtin = real(roots.builtinDir), priv = real(roots.privateDir);
  if (!builtin) return Promise.reject(new AgentError('SANDBOX_ERROR', `Strategy folder not found: ${roots.builtinDir}`));
  const reads = [real(WORKER), builtin, ...(priv ? [priv] : [])];
  const child = fork(WORKER, [builtin, priv], {
    execArgv: ['--permission', ...reads.map((r) => `--allow-fs-read=${r}`), `--max-old-space-size=${memoryMb}`],
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    env: {}, // no inherited secrets
    serialization: 'advanced',
  });
  let stderr = '';
  child.stderr?.on('data', (d) => { if (stderr.length < 4000) stderr += String(d); });
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new AgentError('SANDBOX_TIMEOUT', `Strategy engine exceeded ${timeoutMs / 1000}s`)); }, timeoutMs);
    child.once('message', (m: any) => {
      clearTimeout(timer); child.kill();
      if (m && m.ok) resolve(m as T); else reject(new AgentError('SANDBOX_ERROR', String(m?.error || 'strategy worker failed')));
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new AgentError(/ERR_ACCESS_DENIED/.test(stderr) ? 'SANDBOX_VIOLATION' : 'SANDBOX_ERROR', `Strategy worker exited (${code}). ${stderr.split('\n').find((l) => /Error|denied/i.test(l)) ?? ''}`.trim()));
    });
    child.send(msg as any);
  });
}
