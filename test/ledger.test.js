'use strict';
// Ledger edits, undo, cash balances and dividend withholding.
const { setSymbol, dailyBars, reset, DAY } = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const pf = require('../lib/portfolio');
const store = require('../lib/store');
const { ledger, editBuy, deleteBuy, realizedReport } = require('../lib/ledger');
const { dividendNet, estimateNextEx, marketOf } = require('../lib/dividends');
const { parseIbkrDividends } = require('../lib/csv');

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} !≈ ${b}`);

function market() {
  reset();
  setSymbol('AAPL', { currency: 'USD', price: 120 });
  const fx = [];
  for (let i = 600; i >= 0; i -= 7) fx.push(i > 200 ? 1.40 : 1.30);
  setSymbol('USDSGD=X', { currency: 'SGD', price: 1.30, bars: dailyBars(fx).map((b, i, a) => ({ ...b, t: Date.now() - (a.length - 1 - i) * 7 * DAY })) });
}

test('editing a buy\'s date re-anchors its FX', async () => {
  market();
  await pf.buy('AAPL', 10, 100, null, undefined, 'SGD'); // "today" at 1.30
  let r = await pf.portfolioWithQuotes('SGD');
  close(r.positions[0].fxPnl, 0);
  const { rows } = await ledger('SGD');
  assert.equal(rows[0].editable, true);
  await editBuy(rows[0].id, { date: new Date(Date.now() - 400 * DAY).toISOString().slice(0, 10), price: 90 }, 'SGD');
  r = await pf.portfolioWithQuotes('SGD');
  close(r.positions[0].avgCost, 90);
  close(r.positions[0].fxPnl, 90 * 10 * (1.30 - 1.40)); // now bought at 1.40
});

test('editing quantity after a partial sell keeps the proportional lot', async () => {
  market();
  await pf.buy('AAPL', 10, 100, null, undefined, 'SGD');
  await pf.sell('AAPL', 5, 120, undefined, 'SGD');
  const buyRow = (await ledger('SGD')).rows.find((x) => x.type === 'BUY');
  await editBuy(buyRow.id, { quantity: 20 }, 'SGD');
  assert.equal(store.loadPortfolio().accounts[0].positions[0].quantity, 10);
});

test('deleting a buy removes its lot; undo restores it', async () => {
  market();
  await pf.buy('AAPL', 10, 100, null, undefined, 'SGD');
  await pf.buy('AAPL', 5, 110, null, undefined, 'SGD');
  const last = (await ledger('SGD')).rows.find((x) => x.type === 'BUY' && x.quantity === 5);
  await deleteBuy(last.id);
  assert.equal(store.loadPortfolio().accounts[0].positions[0].quantity, 10);
  const u = await store.undo();
  assert.equal(u.undone, 'Delete buy');
  assert.equal(store.loadPortfolio().accounts[0].positions[0].quantity, 15);
});

test('undo reverses a sale but keeps the watchlist', async () => {
  market();
  await pf.buy('AAPL', 10, 100, null, undefined, 'SGD');
  await pf.sell('AAPL', 10, 120, undefined, 'SGD');
  await pf.watchAdd('AAPL');
  assert.equal(store.loadPortfolio().accounts[0].positions.length, 0);
  await store.undo();
  const p = store.loadPortfolio();
  assert.equal(p.accounts[0].positions[0].quantity, 10);
  assert.deepEqual(p.watchlist, ['AAPL']);
  await assert.rejects(async () => { await store.undo(); await store.undo(); }, /Nothing to undo/);
});

test('realized report groups sells by year with holding period', async () => {
  market();
  await pf.buy('AAPL', 10, 100, Date.now() - 400 * DAY, undefined, 'SGD');
  await pf.sell('AAPL', 4, 130, undefined, 'SGD');
  const r = await realizedReport('SGD');
  assert.equal(r.rows.length, 1);
  close(r.rows[0].total, 4 * 130 * 1.30 - 4 * 100 * 1.40);
  assert.ok(Math.abs(r.rows[0].heldDays - 400) <= 1);
  close(r.years[0].total, r.rows[0].total);
});

test('cash counts toward net worth and foreign cash toward FX exposure', async () => {
  market();
  await pf.setCash('USD', 1000);
  await pf.setCash('SGD', 500);
  const r = await pf.portfolioWithQuotes('SGD');
  close(r.summary.cashBase, 1000 * 1.30 + 500);
  close(r.summary.netWorth, r.summary.totalValue + r.summary.cashBase);
  const fx = await pf.fxRisk('SGD');
  close(fx.foreignBase, 1300);
  await pf.setCash('USD', 0);
  assert.deepEqual(store.loadPortfolio().accounts[0].cash, { SGD: 500 });
});

test('dividend withholding: actual tax wins, else market default', () => {
  assert.equal(marketOf('AAPL'), 'US');
  assert.equal(marketOf('D05.SI'), 'SG');
  close(dividendNet({ symbol: 'AAPL', amount: 10 }).net, 7);
  close(dividendNet({ symbol: 'D05.SI', amount: 10 }).net, 10);
  close(dividendNet({ symbol: 'AAPL', amount: 10, tax: 1.5 }).net, 8.5);
  close(dividendNet({ symbol: 'AAPL', amount: 10 }, { withholding: { US: 15 } }).net, 8.5);
});

test('IBKR withholding lines attach to their dividend', () => {
  const csv = [
    'Dividends,Data,USD,2025-05-15,AAPL(US0378331005) Cash Dividend USD 0.26 per Share,2.60',
    'Withholding Tax,Data,USD,2025-05-15,AAPL(US0378331005) Cash Dividend USD 0.26 per Share - US Tax,-0.78,',
  ].join('\n');
  assert.deepEqual(parseIbkrDividends(csv), [{ symbol: 'AAPL', date: '2025-05-15', amount: 2.6, currency: 'USD', tax: 0.78 }]);
});

test('next ex-date is estimated from the payment cadence', () => {
  const now = Date.UTC(2026, 8, 1);
  const q = 91 * DAY;
  const hist = [0, 1, 2, 3].map((i) => ({ t: now - 100 * DAY - (3 - i) * q, amount: 0.25 }));
  const e = estimateNextEx(hist, now);
  assert.equal(e.gapDays, 91);
  assert.ok(e.t > now - DAY && e.t < now + q);
  assert.equal(estimateNextEx(hist.map((h) => ({ ...h, t: h.t - 600 * DAY })), now), null); // stopped paying
});
