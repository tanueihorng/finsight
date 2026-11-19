#!/usr/bin/env node
// Prints the browser spec files for one CI shard, balanced by run time.
// Playwright's own --shard splits by test count, so a few slow files (Kestrel
// auth, accessibility) used to pile onto one runner. This assigns whole files,
// slowest first, to the least-loaded shard using web/e2e/durations.json
// (seconds per file from a CI run). Files missing from it count as the median,
// so new specs still run; refresh the durations when the shards drift apart.
//
//   node scripts/e2e-shard.mjs <current> <total>   e.g. 2 4
// The file list comes from `playwright test --list`, so the config's ignores
// (E2E_SKIP_VISUAL, .realagent) apply exactly as in a normal run.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const [current, total] = process.argv.slice(2).map(Number);
if (!(total >= 1 && current >= 1 && current <= total)) { console.error('usage: e2e-shard.mjs <current> <total>'); process.exit(2); }

const root = path.join(import.meta.dirname, '..');
const list = JSON.parse(execFileSync(process.execPath, [path.join(root, 'node_modules/@playwright/test/cli.js'), 'test', '--list', '--reporter=json'],
  { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20 }));
const files = new Set();
const walk = (s) => { if (s.file && s.specs?.length) files.add(s.file); (s.suites ?? []).forEach(walk); };
list.suites.forEach(walk);
if (!files.size) { console.error('e2e-shard: playwright listed no spec files'); process.exit(1); }

const known = JSON.parse(fs.readFileSync(path.join(root, 'web/e2e/durations.json'), 'utf8'));
const vals = Object.values(known).sort((a, b) => a - b);
const median = vals.length ? vals[vals.length >> 1] : 1;
const weight = (f) => known[f] ?? median;

const load = Array(total).fill(0), mine = [];
for (const f of [...files].sort((a, b) => weight(b) - weight(a) || a.localeCompare(b))) {
  const i = load.indexOf(Math.min(...load));
  load[i] += weight(f);
  // Playwright reads file arguments as regexes: escape and anchor each one.
  if (i === current - 1) mine.push(path.posix.join('web/e2e', f).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$');
}
console.error(`e2e-shard ${current}/${total}: ${mine.length} files, ~${load[current - 1]} s (shards ~${load.join(', ')} s)`);
console.log(mine.join('\n'));
