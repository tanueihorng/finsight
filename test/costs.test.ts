import './helpers.ts'; // isolated data dir before lib/ loads
import test from 'node:test';
import assert from 'node:assert';
import { summarize, type CostInput } from '../lib/costs.ts';

const input: CostInput = {
  base: 'SGD', account: 'ALL', asOf: 1,
  positions: [
    { symbol: 'AAA', marketValue: 1000, stockPnl: 200, fxPnl: -50, quoted: true },
    { symbol: 'aaa', marketValue: 500, stockPnl: 100, fxPnl: -25, quoted: true }, // same symbol, second account
    { symbol: 'FUND', marketValue: 2000, stockPnl: 300, fxPnl: 10, quoted: true },
    { symbol: 'BOND', marketValue: 500, stockPnl: 0, fxPnl: 0, quoted: false },
  ],
  realized: { price: 40, fx: -5, legacy: 15 },
  dividends: [
    { symbol: 'AAA', gross: 100, tax: 30, net: 70 },
    { symbol: 'SOLD', gross: 20, tax: 6, net: 14 }, // dividends from a symbol no longer held
  ],
  funds: { FUND: { expenseRatioPct: 0.2 }, BOND: { expenseRatioPct: null } },
  returns: { twrPct: 12, mwrPct: 10, spanDays: 400, range: 'max' },
};

test('costs: decomposition adds up and merges a symbol across accounts', () => {
  const r = summarize(input);
  const aaa = r.rows.find((x) => x.symbol === 'AAA')!;
  assert.strictEqual(aaa.marketValue, 1500);
  assert.strictEqual(aaa.pricePnl, 300);
  assert.strictEqual(aaa.fxPnl, -75);
  assert.strictEqual(aaa.netGain, 300 - 75 + 70);
  const t = r.totals;
  assert.strictEqual(t.unrealizedPrice, 600);
  assert.strictEqual(t.unrealizedFx, -65);
  assert.strictEqual(t.divGross, 120);
  assert.strictEqual(t.withholding, 36);
  assert.strictEqual(t.withholdingPctOfGross, 30);
  assert.strictEqual(t.netGain, 600 - 65 + 40 - 5 + 15 + 84);
  assert.strictEqual(t.fees, null, 'fees are unknown, never zero');
  const sold = r.rows.find((x) => x.symbol === 'SOLD')!;
  assert.strictEqual(sold.held, false);
  assert.strictEqual(sold.marketValue, 0);
});

test('costs: fund fees are estimated only where a ratio exists, and disclosed otherwise', () => {
  const r = summarize(input);
  assert.strictEqual(r.totals.annualFundFees, 4); // 2000 x 0.2%
  assert.strictEqual(r.totals.fundFeePctOfBook, 0.1); // 4 / 4000
  assert.deepStrictEqual(r.fundsWithoutRatio, ['BOND']);
  assert.ok(r.notes.some((x) => x.includes('BOND')));
  assert.ok(r.notes.some((x) => /not recorded/.test(x)));
  assert.ok(r.notes.some((x) => /Unquoted/.test(x)));
});

test('costs: an empty book has no ratios to divide', () => {
  const r = summarize({ ...input, positions: [], dividends: [], funds: {}, returns: null });
  assert.strictEqual(r.totals.withholdingPctOfGross, null);
  assert.strictEqual(r.totals.fundFeePctOfBook, null);
  assert.strictEqual(r.rows.length, 0);
});
