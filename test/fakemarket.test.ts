// FINSIGHT_FAKE_MARKET=1: fixtures answer every market fetch, deterministically and offline.
import test from 'node:test';
import assert from 'node:assert';
import { install } from '../lib/fakemarket.ts';

install();
const get = async (url: string): Promise<{ status: number; body: any }> => { const r = await fetch(url); return { status: r.status, body: await r.json() }; };
const chart = (sym: string, q = 'interval=1d&range=2y') => get(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?${q}`);

test('quotes end at the fixture price and repeat exactly', async () => {
  const a = await chart('AAPL'), b = await chart('AAPL');
  const r = a.body.chart.result[0];
  assert.strictEqual(r.meta.regularMarketPrice, 231.5);
  assert.strictEqual(r.indicators.quote[0].close.at(-1), 231.5);
  assert.ok(r.timestamp.length >= 730, '2 years of daily bars');
  assert.deepStrictEqual(a.body, b.body);
});

test('FX pairs derive from the fixture rates; unknown symbols 404', async () => {
  assert.strictEqual((await chart('USDSGD=X', 'interval=1d&range=1d')).body.chart.result[0].meta.regularMarketPrice, 1.29);
  const miss = await chart('NOPE');
  assert.strictEqual(miss.status, 404);
  assert.strictEqual(miss.body.chart.result, null);
});

test('FRED, World Bank and calendar answer offline; other hosts are blocked', async () => {
  const fred = await (await fetch('https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS10&cosd=2024-01-01')).text();
  assert.match(fred.split('\n')[1]!, /^2024-01-01,\d/);
  const wb = (await get('https://api.worldbank.org/v2/country/SG/indicator/SP.POP.TOTL?format=json')).body;
  assert.strictEqual(wb[1][0].country.value, 'Singapore');
  const ff = (await get('https://nfs.faireconomy.media/ff_calendar_thisweek.json')).body;
  assert.ok(ff.some((e: { country: string; impact: string }) => e.country === 'USD' && e.impact === 'High'));
  await assert.rejects(fetch('https://example.org/'), /fetch blocked/);
});
