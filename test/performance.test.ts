// Performance replay: flows must not count as returns, and results must match
// hand-computed TWR / benchmark numbers.
import { setSymbol, dailyBars, reset, DAY } from './helpers.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as pf from '../lib/portfolio.ts';
import * as store from '../lib/store.ts';
import { portfolioPerformance as perfAny } from '../lib/performance.ts';

// These cases all have holdings, so the full result (not the empty early exit) comes back.
type Full = Exclude<Awaited<ReturnType<typeof perfAny>>, { points: never[] }>;
const portfolioPerformance = async (...a: Parameters<typeof perfAny>) => (await perfAny(...a)) as Full;

const close = (a: number | null | undefined, b: number, eps = 1e-6) => assert.ok(Math.abs(a! - b) < eps, `${a} !≈ ${b}`);
const daysAgo = (n: number) => Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()) - n * DAY + 15 * 3600e3;

test('TWR ignores deposits; value/invested track the flows', async () => {
  reset();
  // AAA: 100, 110, 121, 121 (last 4 days). Benchmark flat.
  setSymbol('AAA', { bars: dailyBars([100, 110, 121, 121]) });
  setSymbol('IDX', { bars: dailyBars([50, 50, 50, 50]) });
  await pf.buy('AAA', 10, 100, daysAgo(3), undefined, 'USD');
  await pf.buy('AAA', 10, 110, daysAgo(2), undefined, 'USD'); // doubles the stake mid-way
  const d = await portfolioPerformance('1mo', 'USD', undefined, 'IDX');
  close(d.twr, 21);                          // 1.1 * 1.1 - 1, whatever you added
  close(d.end, 20 * 121);
  close(d.totalIn, 1000 + 1100);
  close(d.gain, 20 * 121 - 2100);            // 320
  close(d.benchmark!.twr, 0);
  close(d.benchmark!.shadowEnd, 2100);        // same cash in a flat index
  assert.deepEqual(d.transfers, []);
  assert.ok(d.mwr! > 0);
});

test('a sell is a withdrawal, not a loss', async () => {
  reset();
  setSymbol('AAA', { bars: dailyBars([100, 100, 100]) });
  await pf.buy('AAA', 10, 100, daysAgo(2), undefined, 'USD');
  await pf.sell('AAA', 5, 100, undefined, 'USD');
  const d = await portfolioPerformance('1mo', 'USD', undefined, 'none');
  close(d.twr, 0);
  close(d.totalOut, 500);
  close(d.end, 500);
  assert.equal(d.benchmark, null);
});

test('FX moves show up in base-currency performance', async () => {
  reset();
  setSymbol('AAA', { currency: 'USD', bars: dailyBars([100, 100, 100]) });
  setSymbol('USDSGD=X', { currency: 'SGD', price: 1.43, bars: dailyBars([1.30, 1.30, 1.43]) });
  await pf.buy('AAA', 10, 100, daysAgo(2), undefined, 'SGD');
  const d = await portfolioPerformance('1mo', 'SGD', undefined, 'none');
  close(d.twr, 10, 1e-4); // stock flat, USD +10% vs SGD
});

test('an off-market "buy" (average cost, no date) enters at market value', async () => {
  reset();
  setSymbol('AAA', { bars: dailyBars([300, 300, 330]) });
  await pf.buy('AAA', 10, 150, daysAgo(2), undefined, 'USD'); // 150 never traded
  const d = await portfolioPerformance('1mo', 'USD', undefined, 'none');
  assert.deepEqual(d.transfers, ['AAA']);
  close(d.totalIn, 3000);
  close(d.twr, 10);
});

test('holdings without transactions are treated as held all along', async () => {
  reset();
  setSymbol('AAA', { bars: dailyBars([100, 105]) });
  await pf.buy('AAA', 10, 100, daysAgo(1), undefined, 'USD');
  // Simulate legacy data: wipe the transaction log, keep the position.
  const p = store.loadPortfolio(); p.accounts[0]!.transactions = []; store.savePortfolio(p);
  const d = await portfolioPerformance('1mo', 'USD', undefined, 'none');
  assert.deepEqual(d.approx, ['AAA']);
  close(d.twr, 5);
});

test('long spans ask Yahoo for explicit year ranges, never range=max', async () => {
  reset();
  setSymbol('AAA', { bars: dailyBars([100, 100, 110]) });
  setSymbol('IDX', { bars: dailyBars([50, 50, 55]) });
  setSymbol('USDSGD=X', { currency: 'SGD', price: 1.3, bars: dailyBars([1.3, 1.3, 1.3]) });
  await pf.buy('AAA', 10, 100, daysAgo(15 * 365), undefined, 'SGD'); // > 10y span
  const ranges: string[] = [];
  const realFetch = global.fetch;
  global.fetch = async (url) => {
    const u = new URL(String(url));
    if (u.pathname.includes('/v8/finance/chart/')) ranges.push(u.searchParams.get('range')!);
    return realFetch(url);
  };
  try {
    const d = await portfolioPerformance('max', 'SGD', undefined, 'IDX');
    assert.equal(d.range, 'max');
    assert.equal(d.interval, '1wk');
    assert.ok(d.points.length > 0);
  } finally { global.fetch = realFetch; }
  assert.ok(ranges.includes('20y'), `ranges: ${ranges}`);
  assert.ok(!ranges.includes('max'), `ranges: ${ranges}`);
});
