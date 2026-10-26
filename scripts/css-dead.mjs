#!/usr/bin/env node
// X2: find (and with --write, remove) CSS rules whose selectors can no longer
// match anything. Conservative: a selector is dead only if one of the classes
// or ids it requires appears nowhere in the app source (web/src), the
// retained classic scripts, index.html or the other stylesheet's markup
// users. Attribute and element selectors count as used. A rule goes only when
// all of its selectors are dead; a selector list loses just its dead entries.
// Keyframes go when no animation names them. Usage:
//   node scripts/css-dead.mjs [--write] [public/styles.css ...]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.env.CSS_DEAD_ROOT || path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const targets = files.length ? files : ['public/styles.css', 'public/agent-panel.css'];
const write = process.argv.includes('--write');

const walk = (dir) => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((d) =>
  d.isDirectory() ? walk(path.join(dir, d.name)) : /\.(tsx?|js|mjs)$/.test(d.name) && !/\.test\.|fixture/.test(d.name) ? [path.join(dir, d.name)] : []);
const sources = [...walk('web/src'), 'public/index.html', 'public/chart.js', 'public/chartgrid.js', 'public/journal.js', 'public/strategy.js', 'public/strategies.js', 'public/indicators.js', 'lib/journal.ts']
  .filter((f) => fs.existsSync(path.join(root, f)));
const corpus = sources.map((f) => fs.readFileSync(path.join(root, f), 'utf8')).join('\n');
// Class names built at runtime ('sb-stage st-' + code, `col-${side}`): any
// class starting with such a prefix counts as used.
const prefixes = [...new Set([...corpus.matchAll(/([A-Za-z][\w-]*-)(?=\$\{|['"`]\s*\+)/g)].map((m) => m[1]))];
const usedCache = new Map();
const used = (token) => {
  if (!usedCache.has(token)) usedCache.set(token, prefixes.some((p) => token.startsWith(p)) || new RegExp(`(^|[^\\w-])${token.replace(/[-]/g, '\\-')}([^\\w-]|$)`).test(corpus));
  return usedCache.get(token);
};

// Split on top-level commas (not inside :not(...), :is(...)).
function splitList(sel) {
  const out = []; let depth = 0, cur = '';
  for (const ch of sel) {
    if (ch === '(') depth++; if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}
// The classes/ids a selector requires (ignoring those only inside :not(...)).
function required(sel) {
  const bare = sel.replace(/:not\([^)]*\)/g, '').replace(/\[[^\]]*\]/g, '').replace(/::?[a-z-]+(\([^)]*\))?/gi, ' ');
  return [...bare.matchAll(/([.#])(-?[A-Za-z_][\w-]*)/g)].map((m) => m[2]);
}
const deadSelector = (sel) => required(sel).some((t) => !used(t));

// A minimal CSS walker: comments, @media/@supports blocks (recursed),
// @keyframes and other at-rules (kept whole), and plain rules.
function walkCss(css, report, depth = 0) {
  let i = 0, out = '';
  while (i < css.length) {
    if (css.startsWith('/*', i)) { const e = css.indexOf('*/', i + 2) + 2; out += css.slice(i, e); i = e; continue; }
    const open = css.indexOf('{', i);
    if (open < 0) { out += css.slice(i); break; }
    const head = css.slice(i, open);
    // find the matching close brace
    let d = 1, j = open + 1;
    while (j < css.length && d) { if (css[j] === '{') d++; else if (css[j] === '}') d--; j++; }
    const body = css.slice(open + 1, j - 1);
    const lead = head.match(/^\s*/)[0], sel = head.trim();
    if (/^@(media|supports)/.test(sel)) {
      const inner = walkCss(body, report, depth + 1);
      if (inner.trim()) out += `${lead}${sel} {${inner}}`;
      else report.push(`${sel} (now empty)`);
    } else if (/^@keyframes\s+([\w-]+)/.test(sel)) {
      const name = sel.match(/^@keyframes\s+([\w-]+)/)[1];
      if (new RegExp(`animation[^;]*\\b${name}\\b`).test(cssAll) || used(name)) out += css.slice(i, j);
      else { report.push(sel); }
    } else if (sel.startsWith('@')) {
      out += css.slice(i, j);
    } else {
      const list = splitList(sel), keep = list.filter((s) => !deadSelector(s));
      if (keep.length === list.length) out += css.slice(i, j);
      else if (!keep.length) report.push(`${sel}  [${[...new Set(list.flatMap(required).filter((t) => !used(t)))].join(', ')}]`);
      else { report.push(`${list.filter(deadSelector).join(', ')}  (pruned from a list)`); out += `${lead}${keep.join(',\n')} {${body}}`; }
    }
    i = j;
  }
  return out;
}

let cssAll = '';
let total = 0;
for (const t of targets) {
  const file = path.join(root, t), css = fs.readFileSync(file, 'utf8');
  cssAll = css;
  const report = [];
  const next = walkCss(css, report).replace(/\n{3,}/g, '\n\n');
  total += report.length;
  console.log(`${t}: ${report.length} dead rule(s)/selector(s)${write ? ' removed' : ''}`);
  for (const r of report) console.log('  - ' + r);
  if (write && report.length) fs.writeFileSync(file, next);
}
if (!write && total) console.log('\nRun with --write to remove them.');
