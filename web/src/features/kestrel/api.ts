// The agent API through FinSight's session-gated /api/agent proxy (G1). Kept
// separate from api/client.ts: an agent 401 while FinSight is locked must not
// lock it again, and errors carry the agent's code (AGENT_OFFLINE, CONFLICT).
export class AgentError extends Error {
  readonly status: number; readonly code: string | undefined;
  constructor(message: string, status: number, code?: string) { super(message); this.status = status; this.code = code; }
}
export async function agentApi<T>(path: string, o: { method?: string; body?: unknown } = {}): Promise<T> {
  // Like api/client.ts: nothing is sent while FinSight is locked (the session
  // gate would refuse it anyway). No lock() call here, as above.
  if (window.FinSight?.auth?.unlocked === false) throw new AgentError('Locked. Enter your PIN.', 401);
  const res = await fetch('/api/agent' + path, { method: o.method || 'GET', headers: o.body ? { 'Content-Type': 'application/json' } : {},
    body: o.body ? JSON.stringify(o.body) : undefined, credentials: 'same-origin' });
  let j: { error?: string | { code?: string; message?: string } } | null = null;
  try { j = await res.json(); } catch { /* empty */ }
  if (!res.ok) {
    const e = j?.error;
    throw new AgentError((typeof e === 'object' ? e?.message : e) || `HTTP ${res.status}`, res.status, typeof e === 'object' ? e?.code : undefined);
  }
  return j as T;
}
export interface Brain { id: string; label: string; costTier: string; available: boolean; reason?: string }
export interface Skill { name: string; description: string }
export interface Thread { id: string; title: string; version: number; defaultBrain?: string; updatedAt: number }
export interface Block { type: string; text?: string; id?: string; name?: string; args?: unknown; callId?: string; ok?: boolean; kind?: string }
export interface Message { id: string; role: string; turnId?: string; brain?: string; blocks: Block[] }
export interface Citation { turnId?: string; url: string; title?: string; class?: string; retrievedAt?: string }
