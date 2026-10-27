import fs from 'node:fs';
import path from 'node:path';

// Resolve existing ancestors too: a not-yet-created child of a symlink into
// personal storage is still personal storage. This check runs before --reset.
function resolvedPath(target: string): string {
  let current = path.resolve(target);
  const tail: string[] = [];
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) throw new Error(`Cannot resolve demo directory: ${target}`);
    tail.unshift(path.basename(current)); current = parent;
  }
  return path.resolve(fs.realpathSync(current), ...tail);
}
export function isInsidePersonalData(demoDir: string, personalDir: string): boolean {
  const demo = resolvedPath(demoDir), personal = resolvedPath(personalDir);
  const relative = path.relative(personal, demo);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}
