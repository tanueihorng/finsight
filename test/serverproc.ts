// Runs a real server.ts in a child process on a free port with an isolated data
// dir and the fake market, so HTTP behaviour (auth, parsing, persistence,
// shutdown) is tested end to end without network or the owner's data.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

export const SERVER = path.join(import.meta.dirname, '..', 'server.ts');

export function freePort(): Promise<number> { return new Promise((r) => { const s = http.createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as import('node:net').AddressInfo).port; s.close(() => r(p)); }); }); }
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A response: status, headers, text, and the parsed JSON when the body is JSON. */
export interface Res { status: number; headers: http.IncomingHttpHeaders; text: string; json: any }
export type Server = Awaited<ReturnType<typeof startServer>>;

// Raw request: the path is sent exactly as given (no client-side normalisation).
export function request(port: number, method: string, p: string, { headers = {}, body }: { headers?: Record<string, string>; body?: unknown } = {}): Promise<Res> {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, method, path: p, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      const chunks: Buffer[] = []; res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => { const text = Buffer.concat(chunks).toString('utf8'); let json: any; try { json = JSON.parse(text); } catch {} resolve({ status: res.statusCode!, headers: res.headers, text, json }); });
    });
    r.on('error', reject); if (body !== undefined) r.write(typeof body === 'string' ? body : JSON.stringify(body)); r.end();
  });
}
export const cookieOf = (res: Res): string => String(res.headers['set-cookie'] || '').split(';')[0]!;

export async function startServer({ dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'finsight-srv-')), env = {}, args = [] }: { dataDir?: string; env?: Record<string, string>; args?: string[] } = {}) {
  const port = await freePort();
  const out: string[] = [];
  const child = spawn(process.execPath, [...args, SERVER], {
    env: { ...process.env, FINSIGHT_DATA_DIR: dataDir, PORT: String(port), FINSIGHT_FAKE_MARKET: '1', NOTIFY: '0', FINSIGHT_CACHE_PERSIST: '0',
      ALERT_INTERVAL: '3600', AGENT_AUTOSTART: '0', AGENT_URL: 'http://127.0.0.1:9', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (c) => out.push(String(c))); child.stderr.on('data', (c) => out.push(String(c)));
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((r) => child.on('exit', (code, signal) => r({ code, signal })));
  for (let i = 0; ; i++) {
    try { await request(port, 'GET', '/api/health'); break; } catch {
      if (i > 200 || child.exitCode !== null) throw new Error('server did not start:\n' + out.join(''));
      await sleep(25);
    }
  }
  const s = {
    port, dataDir, child, exited, output: () => out.join(''),
    req: (method: string, p: string, opts?: Parameters<typeof request>[3]) => request(port, method, p, opts),
    // SIGTERM and wait for the exit (the server's own shutdown path).
    async stop(sig: NodeJS.Signals = 'SIGTERM') { if (child.exitCode === null && child.signalCode === null) child.kill(sig); return exited; },
  };
  return s;
}

// Sets a PIN on a fresh server; returns the session cookie it issues.
export async function setup(s: Server, pin = '482916'): Promise<string> {
  const r = await s.req('POST', '/api/auth/setup', { headers: { 'content-type': 'application/json' }, body: { pin } });
  if (r.status !== 200) throw new Error('setup failed: ' + r.text);
  return cookieOf(r);
}
export const json = (cookie: string | null, body?: unknown) => ({ headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, ...(body === undefined ? {} : { body }) });
