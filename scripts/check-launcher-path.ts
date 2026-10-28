// Reject both nested and parent paths, including existing symlink ancestors.
import path from 'node:path';
import { assertAgentDataDir, isInsidePersonalData } from './demo-safety.ts';
const [target, ...others] = process.argv.slice(2).filter((arg) => arg !== '--check-config');
if (!target || !others.length || others.some((other) => isInsidePersonalData(target, other) || isInsidePersonalData(other, target))) process.exit(1);
if (process.argv.includes('--check-config')) {
  if (others.some((other) => isInsidePersonalData(path.join(target, 'agent', 'config.json'), other))) process.exit(1);
  assertAgentDataDir(target);
}
