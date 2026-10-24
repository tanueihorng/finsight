// CSS Modules for the island build. esbuild's own local-css loader shortens
// class names to ".r", ".o"… when minifying, which collide with the legacy
// global classes in public/styles.css (e.g. th.r). This plugin instead renames
// every class in a *.module.css file to "fs-<File>-<hash>_<class>", emits the
// CSS as plain global CSS, and gives the importer a { class: scopedName } map.
// Plain class selectors only (no :global() or composes). Comments, strings and
// url() are left untouched.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const CLASS = /\.(-?[_a-zA-Z][\w-]*)/y;

// Returns { css, classes } with every `.name` outside comments, strings and url() renamed.
export function scopeCss(source, relPath) {
  const base = path.basename(relPath).replace(/\.module\.css$/, '');
  const hash = crypto.createHash('sha1').update(relPath.split(path.sep).join('/')).digest('hex').slice(0, 5);
  const classes = {};
  let out = '', i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '/' && source[i + 1] === '*') { const end = source.indexOf('*/', i + 2); const j = end < 0 ? source.length : end + 2; out += source.slice(i, j); i = j; continue; }
    if (ch === '"' || ch === "'") { let j = i + 1; while (j < source.length && source[j] !== ch) j += source[j] === '\\' ? 2 : 1; out += source.slice(i, j + 1); i = j + 1; continue; }
    if (/^url\(/i.test(source.slice(i, i + 4))) { const j = source.indexOf(')', i); const k = j < 0 ? source.length : j + 1; out += source.slice(i, k); i = k; continue; }
    if (ch === '.') { // ".5em" never matches: a class name can't start with a digit
      CLASS.lastIndex = i;
      const m = CLASS.exec(source);
      if (m) { const name = m[1]; classes[name] ??= `fs-${base}-${hash}_${name}`; out += '.' + classes[name]; i += m[0].length; continue; }
    }
    out += ch; i++;
  }
  return { css: out, classes };
}

export function cssModules(root) {
  return {
    name: 'finsight-css-modules',
    setup(build) {
      build.onLoad({ filter: /\.module\.css$/, namespace: 'file' }, async (args) => {
        const rel = path.relative(root, args.path);
        const { classes } = scopeCss(await fs.readFile(args.path, 'utf8'), rel);
        return { contents: `import ${JSON.stringify(args.path + '?scoped')};\nexport default ${JSON.stringify(classes)};`, loader: 'js', resolveDir: path.dirname(args.path) };
      });
      build.onResolve({ filter: /\.module\.css\?scoped$/ }, (args) => ({ path: args.path.replace(/\?scoped$/, ''), namespace: 'scoped-css' }));
      build.onLoad({ filter: /.*/, namespace: 'scoped-css' }, async (args) => {
        const rel = path.relative(root, args.path);
        return { contents: scopeCss(await fs.readFile(args.path, 'utf8'), rel).css, loader: 'css', resolveDir: path.dirname(args.path), watchFiles: [args.path] };
      });
    },
  };
}
