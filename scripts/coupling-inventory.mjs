#!/usr/bin/env node
// Coupling inventory for the frontend migration (card I1). Splits public/app.js
// into its commented sections and lists, per section: top-level symbols, the
// symbols other sections use (callers outside the section), globals written
// from outside, DOM ids, API endpoints, timers, events and localStorage keys;
// plus which app.js symbols the other legacy scripts use.
// Regex-based (no parser dependency): good enough for this codebase's style,
// where every top-level declaration starts at column 0. Treat it as a map to
// read the code by, not as proof.
//   node scripts/coupling-inventory.mjs           print the generated markdown
//   node scripts/coupling-inventory.mjs --write   refresh it inside docs/frontend-migration/COUPLING.md
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const APP = 'public/app.js';
const OTHERS = ['public/agent-panel.js', 'public/chart.js', 'public/chartgrid.js', 'public/journal.js', 'public/strategy.js', 'public/strategies.js', 'public/indicators.js'];

// Blank out comments and plain '…' / "…" strings (keep template literals: they hold ${code}),
// preserving line breaks so line numbers stay valid.
function codeOnly(src) {
  let out = '', i = 0;
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') { out += ' '; i++; } continue; }
    if (c === '/' && n === '*') { const e = src.indexOf('*/', i + 2); const j = e < 0 ? src.length : e + 2; out += src.slice(i, j).replace(/[^\n]/g, ' '); i = j; continue; }
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
      const closed = src[j] === c; // an unterminated quote (e.g. in a regex) stops at the line end
      out += c + ' '.repeat(Math.max(0, j - i - 1)) + (closed ? c : '');
      i = closed ? j + 1 : j;
      continue;
    }
    out += c; i++;
  }
  return out;
}

// Sections: "//  NAME" banners and "// ---- name" sub-headers.
function sections(src) {
  const lines = src.split('\n');
  const heads = [{ line: 1, name: 'prelude (helpers, api, state)' }];
  lines.forEach((l, i) => {
    let m = l.match(/^\/\/ {2}([A-Z][^=]*?)\s*$/) || l.match(/^\/\/ -{3,} (.+?)\s*-*\s*$/);
    if (m && i > 0) heads.push({ line: i + 1, name: m[1].replace(/\s+—.*$/, '').trim() });
  });
  return heads.map((h, k) => ({ ...h, end: (heads[k + 1] ? heads[k + 1].line : lines.length + 1) - 1 }));
}

// Section ids are frozen to the I1 baseline (31437a0) so COUPLING.md Part A
// stays valid as cards delete sections; a new section gets a name-based id.
const BASELINE_IDS = [
  "prelude (helpers, api, state)",
  "formatting helpers",
  "currency formatting",
  "CLOCK",
  "COMMAND BAR",
  "PORTFOLIO",
  "FX RISK panel",
  "ECON CALENDAR panel",
  "customizable summary cards",
  "PEEK / UNPEEK: blur personal figures, keep public market data",
  "appearance: switchable theme + font (system fonts only, no downloads)",
  "show / hide whole panels",
  "drag-to-rearrange panels",
  "profile + first-launch setup wizard",
  "POSITIONS TABLE: filter by asset class, search, sort, group",
  "UNDO + CASH",
  "CASH EDITOR: all accounts × currencies in one place",
  "LEDGER",
  "ADD FORM + SYMBOL SEARCH",
  "SECURITY DETAIL + CHART",
  "chart host hooks: ledger trades, watchlist feed, multi-chart grid",
  "WORLD MARKETS",
  "WORLD BANK MACRO",
  "FRED",
  "US INFLATION GAUGES",
  "DIVIDENDS (income received, from broker imports)",
  "WATCHLIST",
  "PRICE ALERTS + NOTIFICATIONS",
  "NEWS",
  "CSV IMPORT / EXPORT",
  "PORTFOLIO ANALYTICS",
  "NET WORTH BREAKDOWN: asset classes + cash, overall and per account",
  "UTIL + BOOT + POLLING",
  "ACCOUNTS (multiple portfolios)",
  "PIN LOCK",
];
const sid = (s) => { const i = BASELINE_IDS.indexOf(s.name); return i >= 0 ? `S${i}` : `S:${s.name.split(/[ (:]/)[0]}`; };

const DECL_FN = /^(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/;
const DECL_VAR = /^(?:const|let|var)\s+(.*)$/;
function declared(line) {
  let m = line.match(DECL_FN);
  if (m) return [m[1]];
  m = line.match(DECL_VAR);
  if (!m) return [];
  const names = [], body = m[1];
  const re = /(?:^|,\s*)([A-Za-z_$][\w$]*)\s*(?==|,|;|$)/g;
  let depth = 0, seg = '';
  for (const ch of body) { // only depth-0 segments name variables
    if ('([{'.includes(ch)) depth++;
    if (')]}'.includes(ch)) depth--;
    if (depth === 0) seg += ch; else seg += ' ';
  }
  for (const x of seg.matchAll(re)) names.push(x[1]);
  return names;
}

const uniq = (a) => [...new Set(a)].sort();
// A use of a top-level name: not a property (.x), not an object key (x:), not "$${" in a template.
const ident = (name) => new RegExp(`(?<![\\w$.])${name.replace(/\$/g, '\\$')}(?![\\w$\\{])(?!\\s*:(?!:))`, 'g');

function analyse() {
  const src = read(APP), code = codeOnly(src), raw = src.split('\n'), lines = code.split('\n');
  const secs = sections(src).map((s) => ({ ...s, text: lines.slice(s.line - 1, s.end).join('\n'), rawText: raw.slice(s.line - 1, s.end).join('\n') }));
  const owner = new Map(); // symbol -> section index
  secs.forEach((s, k) => {
    s.symbols = [];
    for (let i = s.line; i <= s.end; i++) for (const n of declared(lines[i - 1])) { s.symbols.push(n); if (!owner.has(n)) owner.set(n, k); }
  });
  for (const [k, s] of secs.entries()) {
    s.usesFrom = new Map(); s.writesOutside = new Set();
    for (const [name, k2] of owner) {
      if (k2 === k) continue;
      const hits = s.text.match(ident(name));
      if (!hits) continue;
      if (!s.usesFrom.has(k2)) s.usesFrom.set(k2, new Set());
      s.usesFrom.get(k2).add(name);
      const w = new RegExp(`(?<![\\w$.])${name.replace(/\$/g, '\\$')}(?:\\s*(?:=(?!=)|\\+=|-=|\\+\\+|--)|(?:\\.[\\w$]+|\\[[^\\]]*\\])+\\s*(?:=(?!=)|\\+=|-=))`);
      if (w.test(s.text)) s.writesOutside.add(name);
    }
    const t = s.rawText;
    s.ids = uniq([...t.matchAll(/(?:\$\$?\(|querySelector(?:All)?\(|closest\()\s*['"`]([^'"`]+)['"`]/g)].flatMap((m) => [...m[1].matchAll(/#([A-Za-z][\w-]*)/g)].map((x) => x[1]))
      .concat([...t.matchAll(/getElementById\(\s*['"`]([\w-]+)['"`]/g)].map((m) => m[1])));
    s.api = uniq([...t.matchAll(/\/api\/[A-Za-z][\w/-]*/g)].map((m) => m[0]));
    s.timers = uniq([...s.text.matchAll(/\b(setInterval|setTimeout)\b/g)].map((m) => m[1]));
    s.events = uniq([...t.matchAll(/(?:dispatchEvent\(new (?:Custom)?Event\(|(?:window|document)\.addEventListener\()\s*['"`]([\w:.-]+)['"`]/g)].map((m) => m[1]));
    s.storage = uniq([...t.matchAll(/['"`](finsight-[\w-]+)['"`]/g)].map((m) => m[1]));
  }
  // Other legacy scripts: which app.js symbols they touch (names they declare
  // themselves, at any depth, are theirs), which window.* globals they set, and
  // which app.js sections use those globals.
  const BROWSER = new Set(['addEventListener', 'removeEventListener', 'dispatchEvent', 'innerHeight', 'innerWidth', 'devicePixelRatio', 'confirm', 'prompt', 'alert', 'location', 'open', 'getComputedStyle', 'matchMedia', 'scrollTo', 'requestAnimationFrame', 'localStorage']);
  const others = OTHERS.filter((f) => fs.existsSync(path.join(root, f))).map((f) => {
    const rawT = read(f), t = codeOnly(rawT);
    const own = new Set([...t.matchAll(/\b(?:function\s*\*?|class)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]));
    for (const m of t.matchAll(/\b(?:let|const|var)\s+[^\n;]*/g)) for (const n of declared(m[0].trim())) own.add(n);
    for (const m of t.matchAll(/function\s*[\w$]*\s*\(([^)]*)\)/g)) for (const n of m[1].split(',')) { const x = n.trim().split('=')[0].trim(); if (/^[A-Za-z_$][\w$]*$/.test(x)) own.add(x); }
    for (const m of t.matchAll(/\b(?:const|let|var)\s*\{([^}]*)\}/g)) for (const n of m[1].split(',')) { const x = n.split(':').pop().trim().split('=')[0].trim(); if (x) own.add(x); }
    const uses = [...owner.keys()].filter((n) => n.length > 1 && !own.has(n) && ident(n).test(t));
    const windowDefs = uniq([...rawT.matchAll(/\b(?:window\.([A-Za-z_$][\w$]*)|root\.([A-Z][\w$]*))(?![\w$])\s*=(?!=)/g)].map((m) => m[1] || m[2])); // root.X: UMD wrappers
    const windowReads = uniq([...rawT.matchAll(/window\.([A-Za-z_$][\w$]*)(?![\w$])(?!\s*=(?!=))/g)].map((m) => m[1])).filter((n) => !BROWSER.has(n) && !windowDefs.includes(n));
    return { file: f, uses, windowDefs, windowReads };
  });
  for (const o of others) {
    o.usedByApp = o.windowDefs.map((g) => [g, secs.flatMap((s) => (ident(g).test(s.text) || s.rawText.includes('window.' + g) ? [sid(s)] : []))]);
  }
  return { secs, owner, others };
}

function markdown({ secs, owner, others }) {
  // Identify the input by its content (git blob id), so the stamp is stable across commits.
  const sha = execFileSync('git', ['hash-object', APP], { cwd: root, encoding: 'utf8' }).trim().slice(0, 10);
  const code = (a) => (a.length ? a.map((x) => '`' + x + '`').join(', ') : '—');
  const out = [`_Generated by \`node scripts/coupling-inventory.mjs --write\` from \`${APP}\` (blob \`${sha}\`, ${secs.at(-1).end} lines). Do not edit by hand._`, ''];
  out.push('### B1. Sections of app.js', '', '| # | Section | Lines | Top-level symbols |', '|---|---|---|---|');
  secs.forEach((s) => out.push(`| ${sid(s)} | ${s.name} | ${s.line}–${s.end} | ${code(s.symbols)} |`));
  out.push('', '### B2. Cross-section use (who calls into whom)', '', 'Each row: the section on the left uses these symbols owned by another section. **Bold** = it also assigns to them (shared mutable state).', '');
  out.push('| Section | Uses from other sections |', '|---|---|');
  for (const [k, s] of secs.entries()) {
    const parts = [...s.usesFrom.entries()].sort((a, b) => a[0] - b[0])
      .map(([k2, names]) => `${sid(secs[k2])}: ${[...names].sort().map((n) => (s.writesOutside.has(n) ? `**\`${n}\`**` : `\`${n}\``)).join(', ')}`);
    out.push(`| ${sid(s)} ${s.name} | ${parts.join('<br>') || '—'} |`);
  }
  out.push('', '### B3. Callers of each section from outside it', '', '| Section | Its symbols used elsewhere → by |', '|---|---|');
  for (const [k, s] of secs.entries()) {
    const by = new Map();
    secs.forEach((o, j) => { if (j !== k && o.usesFrom.has(k)) for (const n of o.usesFrom.get(k)) { if (!by.has(n)) by.set(n, []); by.get(n).push(sid(o)); } });
    const rows = [...by.entries()].sort().map(([n, ss]) => `\`${n}\` → ${ss.join(' ')}`);
    out.push(`| ${sid(s)} ${s.name} | ${rows.join('<br>') || '—'} |`);
  }
  out.push('', '### B4. DOM, API, timers, events, storage per section', '', '| Section | DOM ids | Endpoints | Timers | Events | localStorage |', '|---|---|---|---|---|---|');
  for (const s of secs) out.push(`| ${sid(s)} | ${code(s.ids)} | ${code(s.api)} | ${code(s.timers)} | ${code(s.events)} | ${code(s.storage)} |`);
  out.push('', '### B5. Other legacy scripts', '', 'Globals between files are the hidden coupling: app.js top-level `let`/`const` are shared by name across classic scripts.', '',
    '| File | app.js symbols it uses (owning section) | window.* it sets → used by app.js | other window.* it reads |', '|---|---|---|---|');
  for (const o of others) {
    const sets = o.usedByApp.map(([g, ss]) => `\`${g}\` → ${ss.join(' ') || '—'}`).join('<br>') || '—';
    out.push(`| \`${o.file}\` | ${o.uses.map((n) => `\`${n}\` (${sid(secs[owner.get(n)])})`).join(', ') || '—'} | ${sets} | ${code(o.windowReads)} |`);
  }
  return out.join('\n') + '\n';
}

const md = markdown(analyse());
if (process.argv.includes('--write')) {
  const file = path.join(root, 'docs/frontend-migration/COUPLING.md');
  const doc = fs.readFileSync(file, 'utf8');
  const a = '<!-- generated:start -->', b = '<!-- generated:end -->';
  if (!doc.includes(a) || !doc.includes(b)) throw new Error(`COUPLING.md needs ${a} … ${b} markers`);
  fs.writeFileSync(file, doc.slice(0, doc.indexOf(a) + a.length) + '\n' + md + doc.slice(doc.indexOf(b)));
  console.log('Updated docs/frontend-migration/COUPLING.md');
} else {
  process.stdout.write(md);
}
