#!/usr/bin/env node
// Builds the browser code in web/src into public/app (committed, so a fresh
// clone runs with no install):
//   bootstrap.js   classic script, loaded before every legacy script; owns window.FinSight
//   main.js/.css   ES module islands entry; lazy panels become chunks/*.js
//   manifest.json  every runtime file, for the service worker's offline cache
// and keeps public/index.html's modulepreload list (main.js's static chunks) current.
// Usage:
//   node scripts/build-web.mjs           build
//   node scripts/build-web.mjs --watch   rebuild on change (refresh the browser)
//   node scripts/build-web.mjs --check   exit 1 if public/app differs from a fresh build
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cssModules } from './css-modules.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = 'public/app';
const outAbs = path.join(root, OUT);
const args = new Set(process.argv.slice(2));
const logLevel = args.has('--quiet') || args.has('--check') ? 'warning' : 'info';

const shared = {
  absWorkingDir: root,
  outdir: OUT,
  bundle: true,
  target: 'es2022',
  minify: true,
  sourcemap: true,
  legalComments: 'linked',
  define: { 'process.env.NODE_ENV': '"production"' },
  metafile: true,
  logLevel,
};
const bootstrap = { ...shared, entryPoints: ['web/src/bootstrap.ts'], format: 'iife' };
const islands = {
  ...shared,
  entryPoints: ['web/src/main.tsx'],
  format: 'esm',
  splitting: true,
  chunkNames: 'chunks/[name]-[hash]',
  jsx: 'automatic',
  // Build identically with or without separately installed agent dependencies.
  alias: { zod: path.join(root, 'node_modules/zod/index.js') },
  // *.module.css -> class names scoped as fs-<File>-<hash>_<class> (see css-modules.mjs)
  plugins: [cssModules(root)],
};

// Runtime files (no maps or licence texts) as site paths, sorted.
function manifest(...metafiles) {
  const files = metafiles.flatMap((m) => Object.keys(m.outputs))
    .filter((f) => !/\.(map|LEGAL\.txt)$/.test(f))
    .map((f) => '/' + path.posix.relative('public', f.split(path.sep).join('/')))
    .sort();
  return JSON.stringify({ files }, null, 2) + '\n';
}

// main.js cannot run until its statically imported chunks have loaded, and
// the browser only finds them once main.js has arrived. index.html lists them
// so they load alongside main.js (H1). Lazy island chunks are left out.
const INDEX = path.join(root, 'public/index.html');
const PRELOAD = /(<!-- app:modulepreload -->\n)[\s\S]*?(<!-- \/app:modulepreload -->)/;
function withPreloads(html, meta) {
  const seen = new Set(), walk = (out) => {
    for (const i of meta.outputs[out]?.imports ?? []) {
      if (i.kind === 'import-statement' && !seen.has(i.path)) { seen.add(i.path); walk(i.path); }
    }
  };
  walk(`${OUT}/main.js`);
  const links = [...seen].sort().map((f) => `<link rel="modulepreload" href="/${path.posix.relative('public', f)}" />\n`).join('');
  if (!PRELOAD.test(html)) throw new Error('public/index.html has no <!-- app:modulepreload --> block');
  return html.replace(PRELOAD, (_, open, close) => open + links + close);
}

function listFiles(dir, base = dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? listFiles(p, base) : [path.relative(base, p)];
  });
}

if (args.has('--check')) {
  const results = await Promise.all([bootstrap, islands].map((o) => esbuild.build({ ...o, write: false })));
  const expected = new Map(results.flatMap((r) => r.outputFiles.map((f) => [path.relative(outAbs, f.path), Buffer.from(f.contents)])));
  expected.set('manifest.json', Buffer.from(manifest(...results.map((r) => r.metafile))));
  const actual = listFiles(outAbs);
  const index = fs.readFileSync(INDEX, 'utf8');
  const problems = [
    ...(withPreloads(index, results[1].metafile) === index ? [] : ['outdated public/index.html modulepreload list']),
    ...[...expected.keys()].filter((f) => !actual.includes(f)).map((f) => `missing  ${OUT}/${f}`),
    ...actual.filter((f) => !expected.has(f)).map((f) => `stale    ${OUT}/${f}`),
    ...actual.filter((f) => expected.has(f) && !expected.get(f).equals(fs.readFileSync(path.join(outAbs, f)))).map((f) => `outdated ${OUT}/${f}`),
  ];
  if (problems.length) {
    console.error(`${OUT} does not match web/src. Run: npm run build\n  ` + problems.join('\n  '));
    process.exit(1);
  }
  console.log(`${OUT} matches web/src (${expected.size} files).`);
} else {
  // Start clean so no stale chunk or LEGAL.txt is left behind to commit.
  fs.rmSync(outAbs, { recursive: true, force: true });
  const metas = {};
  const writeManifest = (name) => ({
    name: 'manifest',
    setup(build) {
      build.onEnd((r) => {
        if (!r.metafile) return;
        metas[name] = r.metafile;
        if (name === 'islands') {
          const html = fs.readFileSync(INDEX, 'utf8'), next = withPreloads(html, r.metafile);
          if (next !== html) fs.writeFileSync(INDEX, next);
        }
        if (metas.bootstrap && metas.islands) fs.writeFileSync(path.join(outAbs, 'manifest.json'), manifest(metas.bootstrap, metas.islands));
      });
    },
  });
  const configs = [
    { ...bootstrap, plugins: [writeManifest('bootstrap')] },
    { ...islands, plugins: [...islands.plugins, writeManifest('islands')] },
  ];
  if (args.has('--watch')) {
    for (const c of configs) await (await esbuild.context(c)).watch();
  } else {
    await Promise.all(configs.map((c) => esbuild.build(c)));
  }
}
