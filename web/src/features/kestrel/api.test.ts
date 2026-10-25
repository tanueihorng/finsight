import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentApi, AgentError } from './api.ts';

// AUTHFIX-001 (F2): like api/client.ts, nothing reaches the agent proxy while FinSight is locked.
test('agentApi refuses without a request while locked, and sends once unlocked', async () => {
  const g = globalThis as unknown as { window?: unknown; fetch: typeof fetch };
  const realFetch = g.fetch, hadWindow = 'window' in g;
  const auth = { unlocked: false };
  const calls: string[] = [];
  g.window = { FinSight: { auth } };
  g.fetch = (async (path: string) => { calls.push(path); return new Response('{"ok":true}', { status: 200 }); }) as typeof fetch;
  try {
    await assert.rejects(agentApi('/threads', { method: 'POST', body: {} }), (e: unknown) => e instanceof AgentError && e.status === 401 && e.code === undefined);
    assert.deepEqual(calls, []);
    auth.unlocked = true;
    assert.deepEqual(await agentApi('/threads'), { ok: true });
    assert.deepEqual(calls, ['/api/agent/threads']);
  } finally {
    g.fetch = realFetch;
    if (!hadWindow) delete g.window;
  }
});
