import { test } from 'node:test';
import assert from 'node:assert/strict';
import { timeAgo } from './news.ts';

test('news age preserves minute/hour/day boundaries and the legacy one-minute floor', () => {
  const now = 1_000_000_000;
  for (const [age, expected] of [[-60_000, '1m ago'], [0, '1m ago'], [59_999, '1m ago'], [3599_000, '59m ago'], [3600_000, '1h ago'], [86399_000, '23h ago'], [86400_000, '1d ago'], [172800_000, '2d ago']] as const) {
    assert.equal(timeAgo(now - age, now), expected);
  }
});
