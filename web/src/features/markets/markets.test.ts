import test from 'node:test';
import assert from 'node:assert/strict';
import { marketState, priceDecimals, updatedLabel } from './markets.ts';
import type { Markets } from '../../../../shared/types.ts';

const sp = (marketTime: number | null) => ({ Indices: [{ symbol: '^GSPC', label: 'S&P 500', price: 6000, marketTime }] }) as unknown as Markets;

test('market state pill follows the S&P 500 quote age (6 minute window)', () => {
  const now = Date.UTC(2026, 9, 25, 15);
  assert.deepEqual(marketState(sp(now - 5 * 60000), now), { text: 'LIVE', className: 'pill open' });
  assert.deepEqual(marketState(sp(now - 6 * 60000), now), { text: 'CLOSED', className: 'pill closed' });
  assert.equal(marketState(sp(null), now), null);
  assert.equal(marketState({ FX: [] } as unknown as Markets, now), null);
});

test('prices under 10 show 4 decimals; the update label uses 24 h time', () => {
  assert.equal(priceDecimals(1.29), 4);
  assert.equal(priceDecimals(10), 2);
  assert.equal(priceDecimals(null), 2);
  assert.match(updatedLabel(Date.UTC(2026, 9, 25, 15, 4, 5)), /^upd \d{2}:\d{2}:\d{2}$/);
});
