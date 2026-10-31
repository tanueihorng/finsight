import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LIMIT_DEFAULTS, loadConfig, saveLimits, setLimits } from '../src/config.ts';

const home = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kestrel-limits-'));
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ searchProvider: 'deepseek', limits: { councilTurnUsd: 0.5, councilOutputTokens: 8000 } }));
  return { dir, env: { AGENT_HOME: dir, FINSIGHT_DATA_DIR: dir } };
};

test('unset limits use the defaults; set ones are kept', () => {
  const { env } = home();
  const cfg = loadConfig(env);
  assert.equal(cfg.limits.turnUsd, LIMIT_DEFAULTS.turnUsd);
  assert.equal(cfg.limits.dayUsd, 5);
  assert.equal(cfg.limits.councilResearchCalls, 8);
  assert.equal(cfg.limits.councilTurnUsd, 0.5);
  assert.deepEqual(setLimits(cfg), { councilTurnUsd: 0.5, councilOutputTokens: 8000 });
});

test('saving applies at once, keeps other settings, and null returns a field to its default', () => {
  const { dir, env } = home();
  const cfg = loadConfig(env), live = cfg.limits;
  saveLimits(cfg, { turnUsd: 1, searchesPerTurn: 30, councilResearchCalls: 12 });
  assert.equal(cfg.limits, live, 'the running config object is updated in place');
  assert.equal(live.turnUsd, 1); assert.equal(live.searchesPerTurn, 30); assert.equal(live.councilResearchCalls, 12);
  const file = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'));
  assert.equal(file.searchProvider, 'deepseek');
  assert.deepEqual(file.limits, { councilTurnUsd: 0.5, councilOutputTokens: 8000, turnUsd: 1, searchesPerTurn: 30, councilResearchCalls: 12 });
  assert.equal(loadConfig(env).limits.turnUsd, 1, 'a restart reads the saved value');
  saveLimits(cfg, { turnUsd: null, councilTurnUsd: null });
  assert.equal(live.turnUsd, LIMIT_DEFAULTS.turnUsd);
  assert.equal(live.councilTurnUsd, undefined);
});

test('an invalid value is refused and nothing is written', () => {
  const { dir, env } = home();
  const cfg = loadConfig(env), before = fs.readFileSync(path.join(dir, 'config.json'), 'utf8');
  assert.throws(() => saveLimits(cfg, { turnSteps: 500 }));
  assert.throws(() => saveLimits(cfg, { dayUsd: -1 }));
  assert.throws(() => saveLimits(cfg, { madeUp: 3 }));
  assert.equal(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'), before);
  assert.equal(cfg.limits.turnSteps, LIMIT_DEFAULTS.turnSteps);
});
