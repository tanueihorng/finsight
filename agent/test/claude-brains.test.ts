import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadBrains } from '../src/brains/registry.ts';
import { loadConfig } from '../src/config.ts';
import { clearSecretCache } from '../src/secrets.ts';
import { searchProviders } from '../src/tools/web.ts';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kestrel-claude-'));
after(() => fs.rmSync(home, { recursive: true, force: true }));
const config = () => loadConfig({ AGENT_HOME: home, FINSIGHT_DATA_DIR: home });

test('Sonnet 5.5 and Haiku 5.5 load through the registry and need the Anthropic key', () => {
  process.env.AGENT_NO_KEYCHAIN = '1'; delete process.env.ANTHROPIC_API_KEY; clearSecretCache();
  const missing = loadBrains(config());
  for (const id of ['sonnet', 'haiku']) assert.equal(missing.brains.get(id)?.available, false);
  process.env.ANTHROPIC_API_KEY = 'test-anthropic-key'; clearSecretCache();
  const { brains, invalid } = loadBrains(config());
  delete process.env.ANTHROPIC_API_KEY; clearSecretCache();
  assert.deepEqual(invalid, []);
  const sonnet = brains.get('sonnet')!, haiku = brains.get('haiku')!;
  assert.equal(sonnet.available, true); assert.equal(haiku.available, true);
  assert.equal(sonnet.manifest.model, 'claude-sonnet-5-5'); assert.equal(haiku.manifest.model, 'claude-haiku-5-5');
  assert.deepEqual([sonnet.manifest.pricing.inputPerM, sonnet.manifest.pricing.outputPerM, sonnet.manifest.pricing.cacheReadPerM], [2, 10, 0.1]);
  assert.deepEqual(sonnet.manifest.options, { output_config: { effort: 'medium' } });
});

test('web search defaults to Tavily when config names no provider', () => {
  assert.equal(searchProviders(config()).default, 'tavily');
});
