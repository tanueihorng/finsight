import { reset, setSymbol, dailyBars, DAY } from './helpers.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { transfer } from '../lib/transfers.ts';
import * as pf from '../lib/portfolio.ts';
import * as store from '../lib/store.ts';
import { ledger, editBuy, deleteBuy } from '../lib/ledger.ts';
import { portfolioPerformance } from '../lib/performance.ts';
import { parseIbkrTrades } from '../lib/csv.ts';
import { importTrades, previewTradeImport } from '../lib/trade-import.ts';
const header = 'Trades,Header,DataDiscriminator,Asset Category,Currency,Symbol,Date/Time,Quantity,T. Price';
const csv = (...rows: string[]) => [header, ...rows.map((r) => 'Trades,Data,Order,Stocks,USD,' + r)].join('\n');
const date = (n: number) => new Date(Date.now() - n * DAY).toISOString().slice(0, 10);
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
function setup() { reset(); setSymbol('AAA', { bars: dailyBars([100, 110, 121, 130]) }); }
async function importCsv(text: string, account = 'main') {
  const p = previewTradeImport(text, account); assert.equal(p.kind, 'trades');
  if (p.kind !== 'trades') throw new Error('bad fixture');
  return importTrades(text, p.token, account, 'USD');
}
test('partial and full transfers preserve lot metadata, combined P&L and performance; one undo restores both', async () => {
  setup();
  await pf.buy('AAA', 10, 100, Date.now() - 3 * DAY, 'main', 'USD');
  await pf.buy('AAA', 10, 110, Date.now() - 2 * DAY, 'main', 'USD');
  const target = await pf.accountAdd('Other', '');
  const anchored = store.loadPortfolio();
  anchored.accounts[0]!.positions[0]!.lots.forEach((l, i) => { l.usdBase = 1.31 + i / 10; l.usdBaseCcy = 'SGD'; });
  store.savePortfolio(anchored);
  const original = store.loadPortfolio(), lots = original.accounts[0]!.positions[0]!.lots;
  const before = await portfolioPerformance('1mo', 'USD', 'ALL', 'none');
  const valueBefore = await pf.portfolioWithQuotes('USD', 'ALL');
  await transfer('AAA', 5, 'main', target);
  let p = store.loadPortfolio();
  close(p.accounts[0]!.positions[0]!.quantity, 15); close(p.accounts[1]!.positions[0]!.quantity, 5);
  for (const [i, l] of p.accounts[1]!.positions[0]!.lots.entries()) assert.deepEqual(l, { ...lots[i], q: lots[i]!.q / 4 });
  assert.equal((await ledger('USD', 'ALL')).rows.filter((r) => r.type === 'TRANSFER').length, 2);
  assert.equal((await ledger('USD', 'main')).rows.find((r) => r.type === 'BUY')!.editable, false);
  await assert.rejects(editBuy(lots[0]!.tx, { quantity: 40 }, 'USD'), /transferred/);
  await assert.rejects(deleteBuy(lots[0]!.tx), /transferred/);
  const after = await portfolioPerformance('1mo', 'USD', 'ALL', 'none');
  assert.deepEqual(after.points, before.points);
  assert.ok('netInvested' in after && 'netInvested' in before);
  assert.equal(after.twr, before.twr); assert.equal(after.netInvested, before.netInvested);
  const valueAfter = await pf.portfolioWithQuotes('USD', 'ALL');
  close(valueAfter.summary.totalUnrealized, valueBefore.summary.totalUnrealized);
  assert.equal(valueAfter.summary.realizedPnl, valueBefore.summary.realizedPnl);
  await store.undo(); assert.deepEqual(store.loadPortfolio(), original);
  await transfer('AAA', 20, 'main', target);
  p = store.loadPortfolio(); assert.equal(p.accounts[0]!.positions.length, 0); close(p.accounts[1]!.positions[0]!.quantity, 20);
  assert.equal((await portfolioPerformance('1mo', 'USD', 'ALL', 'none')).twr, before.twr);
});
test('invalid transfer inputs leave portfolio and undo stack unchanged', async () => {
  setup(); await pf.buy('AAA', 10, 100, null, 'main', 'USD');
  const target = await pf.accountAdd('Other', ''), original = store.loadPortfolio(), undo = store.undoInfo();
  for (const [q, from, to] of [[0, 'main', target], [-1, 'main', target], [Infinity, 'main', target], [11, 'main', target], [1, 'main', 'main'], [1, 'ALL', target], [1, 'main', 'unknown']] as const) await assert.rejects(transfer('AAA', q, from, to));
  assert.deepEqual(store.loadPortfolio(), original); assert.deepEqual(store.undoInfo(), undo);
});
test('parser handles quoted quantities, negative fills, exchange suffixes and refuses malformed/unsupported rows', () => {
  const text = csv(`AAA,"${date(3)}, 12:30:00","1,000",100`, `AAA,${date(2)},-5,110`);
  assert.deepEqual(parseIbkrTrades(text)?.map((r) => [r.type, r.quantity]), [['BUY', 1000], ['SELL', 5]]);
  assert.equal(parseIbkrTrades('symbol,quantity,avg_price\nAAA,1,100'), null);
  assert.throws(() => parseIbkrTrades(text.replace('Stocks', 'Options')), /Unsupported/);
  assert.throws(() => parseIbkrTrades(csv(`AAA,${date(2)},oops,100`)), /Invalid/);
  assert.throws(() => parseIbkrTrades(csv('AAA,2026-02-30,1,100')), /Invalid/);
});
test('IBKR fills preview, buys/sells, exact repeated import, and one-step undo', async () => {
  setup();
  const text = csv(`AAA,${date(3)},10,100`, `AAA,${date(2)},-4,110`);
  assert.equal(previewTradeImport(text, 'main').kind, 'trades');
  assert.equal((await importCsv(text)).added, 2);
  const p = store.loadPortfolio(); close(p.accounts[0]!.positions[0]!.quantity, 6);
  assert.equal(p.accounts[0]!.transactions[1]!.realized, 40);
  const undo = store.undoInfo();
  assert.equal((await importCsv(text)).added, 0);
  assert.deepEqual(store.loadPortfolio(), p); assert.deepEqual(store.undoInfo(), undo);
  await store.undo(); assert.equal(store.loadPortfolio().accounts[0]!.positions.length, 0);
});
test('deduplication uses multiplicity for identical fills and is scoped to the chosen account', async () => {
  setup(); const text = csv(`AAA,${date(3)},2,100`, `AAA,${date(3)},2,100`);
  assert.equal((await importCsv(text)).added, 2); assert.equal((await importCsv(text)).added, 0);
  const other = await pf.accountAdd('Other', ''); assert.equal((await importCsv(text, other)).added, 2);
});
test('stale previews, backfills and insufficient sells fail atomically, including concurrent confirms', async () => {
  setup(); const text = csv(`AAA,${date(3)},2,100`), preview = previewTradeImport(text, 'main');
  if (preview.kind !== 'trades') throw Error('fixture');
  const attempts = await Promise.allSettled([importTrades(text, preview.token, 'main', 'USD'), importTrades(text, preview.token, 'main', 'USD')]);
  assert.equal(attempts.filter((r) => r.status === 'fulfilled').length, 1);
  const p = store.loadPortfolio();
  await assert.rejects(importCsv(csv(`AAA,${date(2)},3,100`, `AAA,${date(1)},-100,110`)), /Insufficient/);
  assert.deepEqual(store.loadPortfolio(), p);
  await assert.rejects(importCsv(csv(`AAA,${date(4)},1,100`)), /backfill/);
  assert.deepEqual(store.loadPortfolio(), p);
});
