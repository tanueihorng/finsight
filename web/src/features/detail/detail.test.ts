import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchRangeFor, firstSelectable, isIntraday, mergeMeta, rangeChange, rangeLabel, visibleStart } from './detail.ts';
import type { Position, QuotedQuote } from '../../../../shared/types.ts';

const DAY = 86400000;
test('fetch range warm-up, timeframes and labels', () => {
  assert.equal(fetchRangeFor({ range: '1d', interval: '5m' }), '5d');
  assert.equal(fetchRangeFor({ range: '6mo', interval: '1d' }), '2y');
  assert.equal(fetchRangeFor({ range: '1y', interval: '60m', tf: true }), '1y');
  assert.deepEqual([isIntraday('5m'), isIntraday('1h'), isIntraday('1d'), isIntraday('1wk')], [true, true, false, false]);
  assert.deepEqual([rangeLabel('1mo'), rangeLabel('ytd')], ['1M', 'YTD']);
});
test('visible start: calendar span for daily, sessions for intraday', () => {
  const daily = Array.from({ length: 100 }, (_, i) => ({ t: i * DAY, c: i + 1 }));
  assert.equal(visibleStart(daily, '1mo'), 99 * DAY - 31 * DAY);
  assert.equal(visibleStart([], '1mo'), 0);
  // two sessions of 5-minute bars separated by an overnight gap
  const s1 = [0, 1, 2].map((k) => ({ t: k * 300000, c: 1 })), s2 = [0, 1].map((k) => ({ t: 20 * 3600000 + k * 300000, c: 1 }));
  assert.equal(visibleStart([...s1, ...s2], '1d'), 20 * 3600000);
  const { chg, pct } = rangeChange(daily, 98 * DAY);
  assert.deepEqual([chg, pct], [2, 2 / 98 * 100]);
});
test('quote overrides history meta; first quoted holding is auto-selected', () => {
  assert.deepEqual(mergeMeta({ price: 1, name: 'A' } as QuotedQuote, { price: 2 } as QuotedQuote), { price: 2, name: 'A' });
  assert.equal(firstSelectable([{ symbol: 'M', quoted: false }, { symbol: 'Q', quoted: true }] as Position[]), 'Q');
  assert.equal(firstSelectable([{ symbol: 'M', quoted: false }] as Position[]), 'M');
  assert.equal(firstSelectable([]), null);
});
