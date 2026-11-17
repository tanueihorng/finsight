// Secret store. Shared model keys use the personal-ai-keys Keychain service;
// other keys use finsight-agent. The environment and 0600 file are fallbacks.
// Values are never logged; register() feeds the log redactor.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { registerSecret } from './log.ts';

const cache = new Map<string, string | null>();
const sharedModelKeys = new Set(['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'DEEPSEEK_API_KEY']);

/** Keychain service that holds `name`: the shared model keys or FinSight's own. */
export function keychainService(name: string): string {
  return sharedModelKeys.has(name) ? 'personal-ai-keys' : 'finsight-agent';
}

function fromKeychain(name: string): string | null {
  if (process.platform !== 'darwin' || process.env.AGENT_NO_KEYCHAIN === '1') return null;
  try {
    const v = execFileSync('security', ['find-generic-password', '-s', keychainService(name), '-a', name, '-w'], {
      stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000,
    }).toString().trim();
    return v || null;
  } catch { return null; }
}

function fromEnvFile(home: string, name: string): string | null {
  const file = path.join(home, 'secrets.env');
  try {
    const st = fs.statSync(file);
    if ((st.mode & 0o077) !== 0) throw new Error(`${file} must be chmod 600`);
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && m[1] === name) return m[2]!.replace(/^["']|["']$/g, '') || null;
    }
  } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  return null;
}

export function getSecret(home: string, name: string): string | null {
  if (cache.has(name)) return cache.get(name)!;
  const v = fromKeychain(name) ?? (process.env[name] || null) ?? fromEnvFile(home, name);
  if (v) registerSecret(v);
  cache.set(name, v);
  return v;
}

export function clearSecretCache(): void { cache.clear(); }
