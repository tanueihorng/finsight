// Read-only FinSight client. Uses the GET-only service token that FinSight
// writes to <FinSightData>/agent-link.json; FinSight stays the single owner
// of portfolio data, calculations and market-data fetching.
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

export interface FinsightClient {
  get<T = any>(pathname: string, params?: Record<string, string | number | undefined>, signal?: AbortSignal): Promise<T>;
}

export function finsightClient(baseUrl: string, finsightDataDir: string, fetchImpl: typeof fetch = fetch): FinsightClient {
  return {
    async get(pathname, params = {}, signal) {
      const link = readAgentLink(finsightDataDir); // re-read each call so token rotation needs no restart
      if (!link) throw new AgentError('FINSIGHT_AUTH', 'No FinSight agent link found. Start FinSight once (it creates agent-link.json), then retry.', 503);
      const u = new URL(pathname, baseUrl);
      for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') u.searchParams.set(k, String(v));
      let res: Response;
      const t0 = Date.now();
      try {
        res = await fetchImpl(u, { headers: { Authorization: `Bearer ${link.token}` }, signal: signal ?? AbortSignal.timeout(20_000) });
      } catch (e) {
        audit('finsight.request', { path: pathname, params, ok: false, ms: Date.now() - t0, error: String((e as Error).message) });
        if ((e as Error).name === 'AbortError') throw e;
        throw new AgentError('FINSIGHT_DOWN', `FinSight is not reachable at ${baseUrl}. Start FinSight, then ask again.`, 503);
      }
      audit('finsight.request', { path: pathname, params, status: res.status, ms: Date.now() - t0 });
      if (res.status === 401 || res.status === 403) throw new AgentError('FINSIGHT_AUTH', 'FinSight rejected the agent token. Run `agent doctor`.', 503);
      if (!res.ok) throw new AgentError('FINSIGHT_ERROR', `FinSight ${pathname} returned ${res.status}`, 502);
      return res.json() as Promise<any>;
    },
  };
}
