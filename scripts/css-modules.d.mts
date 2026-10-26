// Types for css-modules.mjs (build tooling stays plain ESM JavaScript).
import type { Plugin } from 'esbuild';

/** Scopes every class in a CSS Module; classes maps original names to scoped ones. */
export function scopeCss(source: string, relPath: string): { css: string; classes: Record<string, string> };
/** esbuild plugin that loads *.module.css through scopeCss, relative to root. */
export function cssModules(root: string): Plugin;
