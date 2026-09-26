'use strict';
// Portfolio math against a fake market: USD stock, SGD base, USD/SGD moved
// from 1.40 (when bought) to 1.30 (now).
const { setSymbol, dailyBars, reset, DAY } = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const pf = require('../lib/portfolio');
const { loadPortfolio } = require('../lib/store');

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} !≈ ${b}`);
const BOUGHT = Date.now() - 400 * DAY;

function setupMarket() {
  reset();
  setSymbol('AAPL', { currency: 'USD', price: 120, prevClose: 118 });
  setSymbol('D05.SI', { currency: 'SGD', price: 40, prevClose: 40 });
  // Weekly-ish FX history: 1.40 until ~200 days ago, then 1.30.
  const fx = [];
  for (let i = 600; i >= 0; i -= 7) fx.push(i > 200 ? 1.40 : 1.30);
  setSymbol('USDSGD=X', { currency: 'SGD', price: 1.30, bars: dailyBars(fx).map((b, i, a) => ({ ...b, t: Date.now() - (a.length - 1 - i) * 7 * DAY })) });
  setSymbol('SGDUSD=X', { currency: 'USD', price: 1 / 1.30 });
}

test('buy records lots, quantity and average cost', async () => {
  setupMarket();
  await pf.buy('AAPL', 10, 100, BOUGHT, undefined, 'SGD');
  await pf.buy('aapl', 10, 110, null, undefined, 'SGD');
  const pos = loadPortfolio().accounts[0].positions[0];
  assert.equal(pos.symbol, 'AAPL');
  assert.equal(pos.quantity, 20);
  close(pos.avgCost, 105);
  assert.equal(pos.lots.length, 2);
  close(pos.lots[0].usdBase, 1.40);
  close(pos.lots[1].usdBase, 1.30);
});

test('unrealized P&L splits into stock move + FX move', async () => {
  setupMarket();
  await pf.buy('AAPL', 10, 100, BOUGHT, undefined, 'SGD');
  const r = await pf.portfolioWithQuotes('SGD');
  const p = r.positions[0];
  close(p.marketValue, 120 * 10 * 1.30);           // 1560
  close(p.cost, 100 * 10 * 1.40);                  // 1400 actually paid
  close(p.stockPnl, (120 - 100) * 10 * 1.30);      // +260
  close(p.fxPnl, 100 * 10 * (1.30 - 1.40));        // -100
  close(p.unrealized, p.stockPnl + p.fxPnl);       // +160
  close(r.summary.dayPnl, 2 * 10 * 1.30);
});

test('base-currency holdings carry no FX P&L', async () => {
  setupMarket();
  await pf.buy('D05.SI', 100, 35, BOUGHT, undefined, 'SGD');
  const p = (await pf.portfolioWithQuotes('SGD')).positions[0];
  assert.equal(p.fxPnl, 0);
  close(p.unrealized, 500);
});

test('sell realizes P&L split into stock and FX', async () => {
  setupMarket();
  await pf.buy('AAPL', 10, 100, BOUGHT, undefined, 'SGD');
  const { realized } = await pf.sell('AAPL', 5, 130, undefined, 'SGD');
  close(realized, 150); // native
  const r = await pf.portfolioWithQuotes('SGD');
  close(r.summary.realizedStockPnl, 5 * (130 - 100) * 1.30); // 195
  close(r.summary.realizedFxPnl, 5 * 100 * (1.30 - 1.40));   // -50
  close(r.summary.realizedPnl, 145);
  assert.equal(r.positions[0].quantity, 5);
});

test('selling more than held is rejected; selling all removes the position', async () => {
  setupMarket();
  await pf.buy('AAPL', 10, 100, null, undefined, 'SGD');
  await assert.rejects(pf.sell('AAPL', 11, 100, undefined, 'SGD'), /only hold/);
  await pf.sell('AAPL', 10, 100, undefined, 'SGD');
  assert.equal(loadPortfolio().accounts[0].positions.length, 0);
});

test('fxRisk reconciles with portfolio FX P&L', async () => {
  setupMarket();
  await pf.buy('AAPL', 10, 100, BOUGHT, undefined, 'SGD');
  await pf.buy('D05.SI', 100, 35, BOUGHT, undefined, 'SGD');
  const [r, fx] = await Promise.all([pf.portfolioWithQuotes('SGD'), pf.fxRisk('SGD')]);
  close(fx.totalFxPnl, r.summary.totalFxPnl);
  assert.equal(fx.exposures.length, 1);
  assert.equal(fx.exposures[0].ccy, 'USD');
  close(fx.exposures[0].blendedEntry, 1.40);
  close(fx.foreignBase, 1560);
});

test('accounts: separate books, ALL view merges, writes to ALL rejected', async () => {
  setupMarket();
  await pf.buy('AAPL', 10, 100, null, undefined, 'SGD');
  const id = await pf.accountAdd('Second', 'Test');
  await pf.buy('AAPL', 5, 100, null, id, 'SGD');
  assert.equal((await pf.portfolioWithQuotes('SGD', id)).positions[0].quantity, 5);
  assert.equal((await pf.portfolioWithQuotes('SGD', 'ALL')).positions[0].quantity, 15);
  await assert.rejects(pf.buy('AAPL', 1, 100, null, 'ALL', 'SGD'), /specific account/);
});

test('CSV import adds rows and reports failures', async () => {
  setupMarket();
  const r = await pf.importCsv('symbol,quantity,avg_price\nAAPL,3,150\nBAD,x,1\n', false, undefined, 'SGD');
  assert.equal(r.added, 1);
  assert.equal(loadPortfolio().accounts[0].positions[0].quantity, 3);
});
