// Build the synthetic applicable-state wrapper into a standalone HTML artifact.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cssModules } from './css-modules.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = process.argv[2];
if (!output) throw Error('Pass an HTML output path');
const result = await build({ absWorkingDir: root, entryPoints: ['web/src/features/kestrel/CouncilBoard.preview.tsx'], bundle: true, jsx: 'automatic', format: 'iife', write: false, outfile: '/tmp/council-preview.js', plugins: [cssModules(root)], minify: true });
const js = result.outputFiles.find((f) => f.path.endsWith('.js')).text;
const css = result.outputFiles.find((f) => f.path.endsWith('.css'))?.text || '';
const base = fs.readFileSync(path.join(root, 'public/styles.css'), 'utf8');
fs.writeFileSync(output, '<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FinSight Council · Motion Preview</title><style>' + base + '\n' + css + '</style></head><body><div id="root"></div><script>' + js.replaceAll('</script', '<\\/script') + '</script></body></html>');
