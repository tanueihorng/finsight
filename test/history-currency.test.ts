// Portfolio backtests must not assume a currency Yahoo did not send (FEAT-014).
import test from 'node:test';
import assert from 'node:assert/strict';
import { setSymbol, dailyBars, reset } from './helpers.ts';
import { getHistory } from '../lib/market.ts';

test('history says whether Yahoo reported the currency, while display keeps its USD default', async () => {
  reset();
  setSymbol('HCUSD', { bars: dailyBars([10, 11, 12]) });
  setSymbol('HCEUR', { currency: 'EUR', bars: dailyBars([10, 11, 12]) });
  setSymbol('HCNONE', { currency: '', bars: dailyBars([10, 11, 12]) });
  const meta = async (s: string) => (await getHistory(s, '1mo', '1d')).meta!;
  assert.deepEqual([(await meta('HCUSD')).currency, (await meta('HCUSD')).currencyReported], ['USD', true]);
  assert.deepEqual([(await meta('HCEUR')).currency, (await meta('HCEUR')).currencyReported], ['EUR', true]);
  assert.deepEqual([(await meta('HCNONE')).currency, (await meta('HCNONE')).currencyReported], ['USD', false]);
});
