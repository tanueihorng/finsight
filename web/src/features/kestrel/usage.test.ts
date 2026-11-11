import assert from 'node:assert/strict';
import test from 'node:test';
import { modelTokens, rateLabel, tokenLabel, usdLabel, type UsageModel } from './usage.ts';

test('usage numbers read as money and tokens', () => {
  assert.deepEqual([2, 10, 1.32, 0.1, 0.3, 0.044, 0.006, 0.00075].map(rateLabel), ['$2.00', '$10.00', '$1.32', '$0.10', '$0.30', '$0.044', '$0.006', '$0.00075']);
  assert.deepEqual([0, 0.00075, 0.008, 0.5, 1.5].map(usdLabel), ['$0.00', '$0.000750', '$0.0080', '$0.5000', '$1.50']);
  assert.deepEqual([950, 1500, 123_456, 999_500, 1_234_567, 150_000_000].map(tokenLabel), ['950', '1.5K', '123K', '1.00M', '1.23M', '150M']);
});

test('a model total counts cached input once and includes older unsplit usage', () => {
  const m: UsageModel = { id: 'a', label: 'A', calls: 1, inputTokens: 1000, cacheReadTokens: 400, cacheWriteTokens: 100, outputTokens: 50, unsplitTokens: 7, usd: 0 };
  assert.equal(modelTokens(m), 1057);
});
