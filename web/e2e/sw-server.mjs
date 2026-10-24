#!/usr/bin/env node
// Copies the app (server, lib, public, fixtures) into a temp folder and runs it
// from there, so the service-worker spec can "deploy" a change by editing that
// copy without touching the repo. Usage: node web/e2e/sw-server.mjs <tempRoot>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const root = path.resolve(process.argv[2]);
for (const p of ['server.js', 'package.json', 'lib', 'public', 'test/fixtures']) {
  fs.cpSync(path.join(repo, p), path.join(root, p), { recursive: true });
}
fs.mkdirSync(path.join(root, 'data'), { recursive: true });
process.chdir(root);
await import(path.join(root, 'server.js'));
