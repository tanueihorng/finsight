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

// The agent config can override FINSIGHT_DATA_DIR. Refuse an existing config
// that points anywhere else, including a path through a symlink.
export function assertAgentDataDir(dataDir: string): void {
  const config = path.join(dataDir, 'agent', 'config.json');
  if (!fs.existsSync(config)) return;
  const value: unknown = JSON.parse(fs.readFileSync(config, 'utf8'));
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid agent config');
  const dir = (value as Record<string, unknown>).finsightDataDir;
  if (dir === undefined) return;
  if (typeof dir !== 'string' || resolvedPath(dir) !== resolvedPath(dataDir)) throw new Error('Agent config points to a different FinSight data directory');
}
