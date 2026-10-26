// public/app is committed build output: it must equal a fresh build of web/src.
// Runs on any checkout (not only where the local pre-commit hook is installed).
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.join(import.meta.dirname, '..');
const hasEsbuild = fs.existsSync(path.join(ROOT, 'node_modules', 'esbuild'));

test('public/app matches a fresh build of web/src', { skip: !hasEsbuild && 'dev dependencies not installed (npm ci)' }, () => {
  const r = spawnSync(process.execPath, ['scripts/build-web.mjs', '--check'], { cwd: ROOT, encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr || r.stdout);
});
