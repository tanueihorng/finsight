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
