import test from 'node:test';
import assert from 'node:assert/strict';
import { asOfLabel, earningsWhen, excludedSummary, excludedTitle, ipoPrice, ipoWhen, nextRow, readTab, staleNote, tzShort } from './discover.ts';
import type { DiscoverEarning, DiscoverMover } from '../../../../shared/types.ts';

test('exclusions summarise by reason in a fixed order, with a per-symbol title', () => {
  const list = [{ symbol: 'ERR', reason: 'no-quote', detail: 'HTTP 404' }, { symbol: '^GSPC', reason: 'index' }, { symbol: '^DJI', reason: 'index' }] as const;
  assert.equal(excludedSummary([...list]), '2 index · 1 no quote');
  assert.equal(excludedTitle([...list]), 'ERR: no quote (HTTP 404)\n^GSPC: index\n^DJI: index');
  assert.equal(excludedSummary([]), '');
});

test('stale rows say why', () => {
  const row = (staleReason: DiscoverMover['staleReason'], marketTime: number | null) => ({ staleReason, marketTime }) as DiscoverMover;
  assert.equal(staleNote(row(null, 1)), null);
  assert.equal(staleNote(row('cached-after-failure', 1)), 'last cached quote — live fetch failed');
  assert.match(staleNote(row('old-session', Date.UTC(2026, 9, 20, 15)))!, /^last trade Oct 2\d$/);
  assert.equal(staleNote(row('old-session', null)), 'no trade time');
});

test('earnings show the exchange-local day without shifting it into the viewer zone', () => {
  const e = (day: string, inDays: number) => ({ day, inDays }) as DiscoverEarning;
  assert.deepEqual(earningsWhen(e('2026-11-02', 3)), { date: 'Mon, Nov 02', rel: 'in 3d' });
  assert.equal(earningsWhen(e('2026-10-31', 0)).rel, 'today');
  assert.equal(earningsWhen(e('2026-11-01', 1)).rel, 'tomorrow');
  assert.equal(tzShort('America/New_York'), 'NY');
  assert.equal(tzShort('Asia/Tokyo'), 'Tokyo');
});

test('arrow keys move between rows and stop at the ends', () => {
  const rows = ['a', 'b', 'c'].map((id) => ({ id })) as unknown as Element[];
  assert.equal(nextRow(rows, rows[0]!, 'ArrowDown'), rows[1]);
  assert.equal(nextRow(rows, rows[2]!, 'ArrowDown'), rows[2]);
  assert.equal(nextRow(rows, rows[0]!, 'ArrowUp'), rows[0]);
  assert.equal(nextRow(rows, rows[1]!, 'End'), rows[2]);
  assert.equal(nextRow(rows, rows[1]!, 'Home'), rows[0]);
  assert.equal(nextRow(rows, {} as Element, 'ArrowDown'), null);
  assert.equal(asOfLabel(null), 'no trades');
});

test('IPO dates stay on the US Eastern day; expected dates are marked tentative; prices show ranges', () => {
  assert.equal(ipoWhen({ date: '2026-11-03', status: 'expected' }), '~Tue, Nov 03');
  assert.equal(ipoWhen({ date: '2026-10-29', status: 'priced' }), 'Thu, Oct 29');
  assert.equal(ipoWhen({ date: null, status: 'expected' }), 'date TBA');
  assert.equal(ipoPrice({ priceLow: 19, priceHigh: 21, status: 'expected' }), '$19.00–21.00');
  assert.equal(ipoPrice({ priceLow: 10, priceHigh: 10, status: 'priced' }), '$10.00');
  assert.equal(ipoPrice({ priceLow: null, priceHigh: null, status: 'expected' }), 'price TBA');
  assert.equal(ipoPrice({ priceLow: null, priceHigh: null, status: 'priced' }), 'price n/a'); // Nasdaq leaves some priced deals blank
});

test('the remembered view falls back to "yours" when storage is missing or blocked', () => {
  assert.equal(readTab(), 'yours'); // no localStorage under node
});
