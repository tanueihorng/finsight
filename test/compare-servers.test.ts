// scripts/compare-servers.mjs must not leave servers running when one side
// fails to start: a working A plus a B that crashes, or a B that never answers
// (startup timeout). Each run gets its own process group, which must be empty
// afterwards (orphans keep their group even when re-parented).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';

const ROOT = path.join(import.meta.dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'compare-servers.mjs');

function brokenCheckout(serverSource: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'finsight-cmp-broken-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{ "type": "module" }\n');
  fs.writeFileSync(path.join(dir, 'server.ts'), serverSource);
  return dir;
}
function groupMembers(pgid: number): string[] {
  const out = execFileSync('ps', ['-A', '-o', 'pid=,pgid=,command='], { encoding: 'utf8' });
  return out.split('\n').map((l) => l.trim()).filter((l) => l && Number(l.split(/\s+/)[1]) === pgid);
}
async function runCompare(b: string, env: Record<string, string> = {}) {
  const child = spawn(process.execPath, [SCRIPT, '--a', ROOT, '--b', b], { detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } });
  let stderr = '';
  child.stderr.on('data', (c: Buffer) => (stderr += c));
  child.stdout.resume();
  const code = await new Promise<number | null>((r) => child.on('exit', (c) => r(c)));
  const pgid = child.pid!;
  // Give any orphan a moment to show, then check and clean up whatever is left.
  await new Promise((r) => setTimeout(r, 300));
  const left = groupMembers(pgid);
  if (left.length) { try { process.kill(-pgid, 'SIGKILL'); } catch { /* gone */ } }
  return { code, stderr, left };
}

test('a crashing B stops the already-running A and exits with an error', async () => {
  const b = brokenCheckout("throw new Error('deliberate startup failure');\n");
  const r = await runCompare(b);
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /b did not start/);
  assert.match(r.stderr, /deliberate startup failure/);
  assert.deepEqual(r.left, [], 'no server left behind');
});

test('a B that never answers is stopped at the startup timeout, and so is A', async () => {
  const b = brokenCheckout("setInterval(() => {}, 1000); // never listens\n");
  const r = await runCompare(b, { COMPARE_START_TIMEOUT_MS: '1500' });
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /b did not start/);
  assert.deepEqual(r.left, [], 'no server left behind');
});
