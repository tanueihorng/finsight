// Discovers brain plugins (plugins/brains/<id>/manifest.json), validates them
// and exposes only those whose credentials resolve. Adding a model = adding a
// manifest; nothing else changes.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { Config } from '../config.ts';
import { getSecret } from '../secrets.ts';
import { BrainManifest } from './types.ts';
import type { Brain } from './types.ts';
import { openAiBrain } from './openai.ts';
import { anthropicBrain } from './anthropic.ts';
import { claudeCodeBrain } from './claudecode.ts';
import { log } from '../log.ts';

export type BrainEntry = { manifest: BrainManifest; available: boolean; reason?: string; create: () => Brain };

function hasCommand(cmd: string): boolean {
  try { execFileSync('/usr/bin/which', [cmd], { stdio: 'ignore' }); return true; } catch { return false; }
}

export function loadBrains(cfg: Config, dir = path.join(cfg.pluginsDir, 'brains')): { brains: Map<string, BrainEntry>; invalid: { id: string; error: string }[] } {
  const brains = new Map<string, BrainEntry>(); const invalid: { id: string; error: string }[] = [];
  let dirs: string[] = [];
  try { dirs = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { /* none */ }
  for (const d of dirs.sort()) {
    try {
      const m = BrainManifest.parse(JSON.parse(fs.readFileSync(path.join(dir, d, 'manifest.json'), 'utf8')));
      if (m.id !== d) throw new Error(`manifest id "${m.id}" must match folder "${d}"`);
      let available = true, reason: string | undefined;
      let create: () => Brain;
      if (m.transport === 'openai-compatible' || m.transport === 'anthropic') {
        const key = m.keyRef ? getSecret(cfg.home, m.keyRef) : null;
        if (!key) { available = false; reason = `No ${m.keyRef} in Keychain/env`; }
        create = () => (m.transport === 'anthropic' ? anthropicBrain(m, key!) : openAiBrain(m, key!));
      } else if (m.transport === 'claude-code') {
        const cmd = String(m.options.command || 'claude');
        if (!hasCommand(cmd)) { available = false; reason = `${cmd} CLI not installed`; }
        create = () => claudeCodeBrain(m, cfg.scratchDir, { FINSIGHT_DATA_DIR: cfg.finsightDataDir, AGENT_HOME: cfg.home, FINSIGHT_URL: cfg.finsightUrl, FINSIGHT_REPO: cfg.finsightRepo, RECORDS_DIR: cfg.recordsDir });
      } else { available = false; reason = 'mock brains are test-only'; create = () => { throw new Error('mock'); }; }
      brains.set(m.id, { manifest: m, available, reason, create });
    } catch (e) {
      invalid.push({ id: d, error: String((e as Error).message).slice(0, 300) });
      log('warn', 'brain.invalid', { id: d, error: String((e as Error).message).slice(0, 300) });
    }
  }
  return { brains, invalid };
}
