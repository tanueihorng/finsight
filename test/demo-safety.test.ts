import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isInsidePersonalData } from '../scripts/demo-safety.ts';

test('demo data guard rejects personal paths, including symlinked and future children', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'finsight-demo-guard-'));
  try {
    const personal = path.join(root, 'personal'), alias = path.join(root, 'alias');
    fs.mkdirSync(personal); fs.symlinkSync(personal, alias, 'dir');
    assert.equal(isInsidePersonalData(personal, personal), true);
    assert.equal(isInsidePersonalData(path.join(personal, 'future'), personal), true);
    assert.equal(isInsidePersonalData(alias, personal), true);
    assert.equal(isInsidePersonalData(path.join(alias, 'future', 'child'), personal), true);
    assert.equal(isInsidePersonalData(path.join(root, 'personal-other'), personal), false);
    assert.equal(isInsidePersonalData(path.join(root, 'demo'), personal), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
