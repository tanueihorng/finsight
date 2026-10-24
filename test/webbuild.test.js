'use strict';
// public/app is committed build output: it must equal a fresh build of web/src.
// Runs on any checkout (not only where the local pre-commit hook is installed).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const hasEsbuild = fs.existsSync(path.join(ROOT, 'node_modules', 'esbuild'));

test('public/app matches a fresh build of web/src', { skip: !hasEsbuild && 'dev dependencies not installed (npm ci)' }, () => {
  const r = spawnSync(process.execPath, ['scripts/build-web.mjs', '--check'], { cwd: ROOT, encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr || r.stdout);
});
