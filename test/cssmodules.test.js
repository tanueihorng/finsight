'use strict';
// Island CSS Modules: scoped names must never collide with legacy global classes.
const test = require('node:test');
const assert = require('node:assert');

test('scopeCss renames classes, leaving comments, strings, url() and numbers alone', async () => {
  const { scopeCss } = await import('../scripts/css-modules.mjs');
  const src = '/* .note */ .r { margin: .5em; } .row.r:hover > .cell { content: ".x"; background: url(a.png); }';
  const { css, classes } = scopeCss(src, 'web/src/features/markets/MarketsPanel.module.css');
  assert.deepStrictEqual(Object.keys(classes), ['r', 'row', 'cell']);
  assert.match(classes.r, /^fs-MarketsPanel-[0-9a-f]{5}_r$/);
  assert.ok(css.includes(`/* .note */ .${classes.r} { margin: .5em; }`));
  assert.ok(css.includes(`.${classes.row}.${classes.r}:hover > .${classes.cell}`));
  assert.ok(css.includes('content: ".x"; background: url(a.png);'));
  // same file name in another folder gets different names
  assert.notStrictEqual(scopeCss('.r{}', 'web/src/features/news/MarketsPanel.module.css').classes.r, classes.r);
});

test('CSS module builds and source maps are byte-identical across checkout roots', async (t) => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  let esbuild;
  try { esbuild = await import('esbuild'); } catch { t.skip('dev dependencies not installed (npm ci)'); return; }
  const { cssModules } = await import('../scripts/css-modules.mjs');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'finsight-css-portability-'));
  try {
    const builds = [];
    for (const name of ['checkout-one', 'checkout-two']) {
      const root = path.join(tmp, name);
      fs.mkdirSync(path.join(root, 'web'), { recursive: true });
      fs.writeFileSync(path.join(root, 'web', 'entry.js'), 'import styles from "./card.module.css"; console.log(styles.card);');
      fs.writeFileSync(path.join(root, 'web', 'card.module.css'), '.card { color: var(--text); }');
      const output = await esbuild.build({ absWorkingDir: root, entryPoints: ['web/entry.js'], outdir: 'public/app', bundle: true,
        write: false, sourcemap: true, format: 'esm', plugins: [cssModules(root)] });
      const files = Object.fromEntries(output.outputFiles.map((file) => [path.relative(fs.realpathSync(root), file.path), file.text]));
      assert.ok(Object.keys(files).some((file) => file.endsWith('.css.map')));
      for (const contents of Object.values(files)) assert.ok(!contents.includes(tmp), 'output must not expose an absolute checkout path');
      builds.push(files);
    }
    assert.deepStrictEqual(builds[0], builds[1]);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
