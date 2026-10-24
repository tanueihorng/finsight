// Fails if a likely secret is present in files that could be committed.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SKIP = new Set(['node_modules', '.git', 'scratch']);
const PATTERNS: [string, RegExp][] = [
  ['provider key', /\bsk-[A-Za-z0-9_-]{20,}/],
  ['Anthropic key', /\bsk-ant-[A-Za-z0-9_-]{20,}/],
  ['Tavily key', /\btvly-[A-Za-z0-9_-]{16,}/],
  ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['bearer literal', /Bearer\s+[A-Za-z0-9._~+/=-]{32,}/],
];
const hits: string[] = [];
function walk(dir: string) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { walk(p); continue; }
    if (/\.(db|db-wal|db-shm|png|jpg|pdf)$/.test(e.name)) continue;
    if (/^(agent-link\.json|secrets\.env|\.env.*)$/.test(e.name)) { hits.push(`${path.relative(ROOT, p)}: secret file must not be in the repo`); continue; }
    const text = fs.readFileSync(p, 'utf8');
    for (const [name, re] of PATTERNS) if (re.test(text) && !p.endsWith('secret-scan.ts')) hits.push(`${path.relative(ROOT, p)}: ${name}`);
  }
}
walk(ROOT);
if (hits.length) { console.error('Secret scan FAILED:\n' + hits.join('\n')); process.exit(1); }
console.log('Secret scan passed.');
