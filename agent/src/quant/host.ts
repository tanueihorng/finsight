// Runs the Python quant worker: one JSON request in, one JSON response out.
// The child inherits no credentials, and finsight_quant/guard.py denies it sockets
// and child processes. Not OS-level isolation. Orders stay in FinSight's paper order path.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { AgentError } from '../types.ts';

export const QUANT_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../quant');
export const QUANT_PYTHON = path.join(QUANT_DIR, '.venv/bin/python');
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

/** Identifies the replay code and locked dependencies that produced a result. */
export function workerHash(): string {
  const hash = crypto.createHash('sha256');
  const source = path.join(QUANT_DIR, 'finsight_quant');
  for (const file of fs.readdirSync(source).filter((f) => f.endsWith('.py')).sort()) hash.update(file).update(fs.readFileSync(path.join(source, file)));
  return hash.update(fs.readFileSync(path.join(QUANT_DIR, 'uv.lock'))).digest('hex');
}

export function runQuantWorker<T>(request: unknown, signal: AbortSignal, timeoutMs = 60_000): Promise<T> {
  if (!fs.existsSync(QUANT_PYTHON)) throw new AgentError('QUANT_UNAVAILABLE', 'The Python quant worker is not set up. Run: uv sync --project agent/quant', 503);
  const child = spawn(QUANT_PYTHON, ['-m', 'finsight_quant'], {
    cwd: QUANT_DIR, stdio: ['pipe', 'pipe', 'pipe'], signal, killSignal: 'SIGKILL',
    env: { OPENBLAS_NUM_THREADS: '1', OMP_NUM_THREADS: '1', PYTHONDONTWRITEBYTECODE: '1' },
  });
  return new Promise<T>((resolve, reject) => {
    const out: Buffer[] = [];
    let size = 0, stderr = '', settled = false;
    const finish = (fn: () => void) => { if (settled) return; settled = true; clearTimeout(timer); child.kill('SIGKILL'); fn(); };
    const timer = setTimeout(() => finish(() => reject(new AgentError('QUANT_TIMEOUT', `Quant worker exceeded ${timeoutMs / 1000}s`))), timeoutMs);
    child.stdout.on('data', (d: Buffer) => {
      size += d.length;
      if (size > MAX_OUTPUT_BYTES) return finish(() => reject(new AgentError('QUANT_ERROR', 'Quant worker output too large')));
      out.push(d);
    });
    child.stderr.on('data', (d) => { if (stderr.length < 4000) stderr += String(d); });
    child.stdin.on('error', () => { /* the close handler reports a dead worker */ });
    child.once('error', (e) => finish(() => reject(e.name === 'AbortError' ? e : new AgentError('QUANT_ERROR', `Quant worker failed to start: ${e.message}`))));
    child.once('close', (code) => finish(() => {
      let reply: any;
      try { reply = JSON.parse(Buffer.concat(out).toString('utf8')); }
      catch { return reject(new AgentError('QUANT_ERROR', `Quant worker exited (${code}). ${stderr.trim().split('\n').pop() ?? ''}`.trim())); }
      if (reply?.ok) resolve(reply as T); else reject(new AgentError(String(reply?.code || 'QUANT_ERROR'), String(reply?.error || 'quant worker failed')));
    }));
    child.stdin.end(JSON.stringify(request));
  });
}
