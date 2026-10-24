#!/usr/bin/env node
// Builds the React islands: web/src/main.tsx -> public/app/main.js + main.css.
// The output is committed, so a fresh clone runs with no install.
//   node scripts/build-web.mjs           one build
//   node scripts/build-web.mjs --watch   rebuild on change (refresh the browser)
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cssModules } from './css-modules.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const options = {
  absWorkingDir: root,
  entryPoints: ['web/src/main.tsx'],
  outdir: 'public/app',
  bundle: true,
  format: 'esm',
  target: 'es2022',
  minify: true,
  sourcemap: true,
  jsx: 'automatic',
  // *.module.css -> class names scoped as fs-<File>-<hash>_<class> (see css-modules.mjs)
  plugins: [cssModules(root)],
  define: { 'process.env.NODE_ENV': '"production"' },
  legalComments: 'linked',
  logLevel: 'info',
};

// Start clean so no stale file (an old chunk or LEGAL.txt) is left to commit.
fs.rmSync(path.join(root, 'public/app'), { recursive: true, force: true });
if (process.argv.includes('--quiet')) options.logLevel = 'warning';

if (process.argv.includes('--watch')) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
} else {
  await esbuild.build(options);
}
