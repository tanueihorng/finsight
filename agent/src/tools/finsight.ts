// FinSight client. Uses the service token that FinSight writes to
// <FinSightData>/agent-link.json: GET on a fixed read allowlist, and POST only
// to the paper order routes (FEAT-012). FinSight stays the single
// owner of portfolio data, calculations, market data and the user's paper
// approval settings and limits.
import fs from 'node:fs';
import path from 'node:path';
import { AgentError } from '../types.ts';
import { registerSecret } from '../log.ts';
import { audit } from '../obs/audit.ts';

export type AgentLink = { token: string; proxySecret: string };

export function readAgentLink(finsightDataDir: string): AgentLink | null {
  const file = path.join(finsightDataDir, 'agent-link.json');
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8')) as AgentLink;
    if (typeof j.token !== 'string' || typeof j.proxySecret !== 'string') return null;
    registerSecret(j.token); registerSecret(j.proxySecret);
    return j;
  } catch { return null; }
}

/** Endpoints whose data belongs to one book (REAL or PAPER); quotes, news and the like do not. */
export const BOOK_SCOPED = /^\/api\/(book|portfolio|accounts|dividends|realized|fx-risk|ledger|events)(\/|$)/;
export type BookObserver = (book: string, pathname: string) => void;

export interface FinsightClient {
  get<T = any>(pathname: string, params?: Record<string, string | number | undefined>, signal?: AbortSignal): Promise<T>;
  /** Paper order routes only; FinSight refuses the token anywhere else. */
  post?<T = any>(pathname: string, body: unknown, signal?: AbortSignal): Promise<T>;
  /** A client that also reports the book each response was served from. */
  observe?(fn: BookObserver): FinsightClient;
}

export function finsightClient(baseUrl: string, finsightDataDir: string, fetchImpl: typeof fetch = fetch): FinsightClient {
  async function send(method: 'GET' | 'POST', pathname: string, params: Record<string, string | number | undefined>, body: unknown, signal: AbortSignal | undefined, observers: BookObserver[]) {
    const link = readAgentLink(finsightDataDir); // re-read each call so token rotation needs no restart
    if (!link) throw new AgentError('FINSIGHT_AUTH', 'No FinSight agent link found. Start FinSight once (it creates agent-link.json), then retry.', 503);
    const u = new URL(pathname, baseUrl);
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') u.searchParams.set(k, String(v));
    let res: Response;
    const t0 = Date.now();
    try {
      res = await fetchImpl(u, {
        method,
        headers: { Authorization: `Bearer ${link.token}`, ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}) },
        body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
        signal: signal ?? AbortSignal.timeout(20_000),
      });
    } catch (e) {
      audit('finsight.request', { method, path: pathname, params, ok: false, ms: Date.now() - t0, error: String((e as Error).message) });
      if ((e as Error).name === 'AbortError') throw e;
      throw new AgentError('FINSIGHT_DOWN', `FinSight is not reachable at ${baseUrl}. Start FinSight, then ask again.`, 503);
    }
    audit('finsight.request', { method, path: pathname, params, status: res.status, ms: Date.now() - t0 });
    if (res.status === 401 || res.status === 403) throw new AgentError('FINSIGHT_AUTH', 'FinSight rejected the agent token. Run `agent doctor`.', 503);
    if (!res.ok) {
      // Paper order errors carry a user-facing reason (bad symbol, Alpaca refusal): pass it on.
      let msg = `FinSight ${pathname} returned ${res.status}`;
      if (method === 'POST') { try { const j = await res.json() as { error?: string }; if (j?.error) msg = j.error; } catch { /* keep generic */ } }
      throw new AgentError('FINSIGHT_ERROR', msg, 502);
    }
    const book = res.headers.get('x-finsight-book');
    if (book) for (const fn of observers) fn(book, pathname);
    return res.json() as Promise<any>;
  }
  const client = (observers: BookObserver[]): FinsightClient => ({
    get: (pathname, params = {}, signal) => send('GET', pathname, params, undefined, signal, observers),
    post: (pathname, body, signal) => send('POST', pathname, {}, body, signal, observers),
    observe: (fn) => client([...observers, fn]),
  });
  return client([]);
}
