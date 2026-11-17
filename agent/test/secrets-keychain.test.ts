import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { clearSecretCache, getSecret } from '../src/secrets.ts';

test('model keys use the shared Keychain service and other keys retain the FinSight service', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'finsight-keychain-test-'));
  const oldPath = process.env.PATH;
  const oldDisabled = process.env.AGENT_NO_KEYCHAIN;
  fs.writeFileSync(path.join(dir, 'security'), '#!/bin/sh\n[ "$1" = find-generic-password ] || exit 1\nprintf "synthetic-%s-%s" "$3" "$5"\n', { mode: 0o700 });
  try {
    process.env.PATH = `${dir}:${oldPath ?? ''}`;
    delete process.env.AGENT_NO_KEYCHAIN;
    clearSecretCache();
    for (const name of ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'DEEPSEEK_API_KEY']) {
      assert.equal(getSecret(dir, name), `synthetic-personal-ai-keys-${name}`);
    }
    assert.equal(getSecret(dir, 'TAVILY_API_KEY'), 'synthetic-finsight-agent-TAVILY_API_KEY');
  } finally {
    process.env.PATH = oldPath;
    if (oldDisabled === undefined) delete process.env.AGENT_NO_KEYCHAIN;
    else process.env.AGENT_NO_KEYCHAIN = oldDisabled;
    clearSecretCache();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
