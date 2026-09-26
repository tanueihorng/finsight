'use strict';
// Performance replay: flows must not count as returns, and results must match
// hand-computed TWR / benchmark numbers.
const { setSymbol, dailyBars, reset, DAY } = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const pf = require('../lib/portfolio');
const { portfolioPerformance } = require('../lib/performance');

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} !≈ ${b}`);
const daysAgo = (n) => Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()) - n * DAY + 15 * 3600e3;

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
  close(d.benchmark.twr, 0);
  close(d.benchmark.shadowEnd, 2100);        // same cash in a flat index
  assert.deepEqual(d.transfers, []);
  assert.ok(d.mwr > 0);
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
  const store = require('../lib/store');
  const p = store.loadPortfolio(); p.accounts[0].transactions = []; store.savePortfolio(p);
  const d = await portfolioPerformance('1mo', 'USD', undefined, 'none');
  assert.deepEqual(d.approx, ['AAA']);
  close(d.twr, 5);
});
