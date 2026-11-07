import './helpers.ts'; // isolated data dir before lib/ loads
import test from 'node:test';
import assert from 'node:assert';
import * as g from '../lib/guardrails.ts';

const input: g.GuardrailInput = {
  base: 'SGD',
  positions: [
    { symbol: 'AAA', currency: 'USD', marketValue: 300 },
    { symbol: 'aaa', currency: 'USD', marketValue: 100 }, // same issuer in a second account
    { symbol: 'BBB.SI', currency: 'SGD', marketValue: 200, quoted: false },
    { symbol: 'FUND', currency: 'USD', marketValue: 300 },
  ],
  cash: [{ ccy: 'SGD', base: 50 }, { ccy: 'USD', base: 50 }],
  accounts: [{ id: 'a', name: 'Broker A', netWorth: 700 }, { id: 'b', name: 'Broker B', netWorth: 300 }],
};
const lim = (kind: g.Kind, pct: number, extra: Partial<g.Limit> = {}): g.Limit => ({ kind, pct, status: 'proposed', updatedAt: 1, ...extra });
const find = (r: g.GuardrailReport, kind: g.Kind, symbol?: string) => r.checks.find((c) => c.kind === kind && c.symbol === symbol)!;

test('guardrails: with no limits every check is unset and nothing is a breach', () => {
  const r = g.evaluate(input, []);
  assert.strictEqual(r.netWorth, 1000);
  assert.deepStrictEqual(r.counts, { breach: 0, near: 0, ok: 0, unset: 5 });
  for (const c of r.checks) { assert.strictEqual(c.state, 'unset'); assert.strictEqual(c.limit, null); }
  // Observations are still shown so the user can pick a sensible limit.
  assert.deepStrictEqual(find(r, 'positionMax').worst, { key: 'AAA', value: 400, pct: 40 });
});

test('guardrails: one issuer across accounts counts once; currency includes cash', () => {
  const r = g.evaluate(input, [lim('positionMax', 30), lim('currencyMax', 80), lim('accountMax', 80)]);
  const pos = find(r, 'positionMax');
  assert.strictEqual(pos.state, 'breach');
  assert.deepStrictEqual(pos.over.map((o) => o.key), ['AAA']);
  const ccy = find(r, 'currencyMax'); // USD 400+300+50 = 75% of 1000
  assert.strictEqual(ccy.worst!.pct, 75);
  assert.strictEqual(ccy.state, 'near'); // 75 >= 0.9 * 80
  assert.strictEqual(find(r, 'accountMax').state, 'ok'); // 70% vs 80% (near starts at 72%)
});

test('guardrails: near threshold and cash floor/ceiling', () => {
  const r = g.evaluate(input, [lim('accountMax', 75), lim('cashMin', 5), lim('cashMax', 8, { status: 'accepted' })]);
  assert.strictEqual(find(r, 'accountMax').state, 'near');
  assert.strictEqual(find(r, 'cashMin').state, 'ok'); // 10% vs floor 5% (not within 5/0.9)
  const max = find(r, 'cashMax');
  assert.strictEqual(max.state, 'breach');
  assert.strictEqual(max.limit!.status, 'accepted');
  const floor = g.evaluate({ ...input, cash: [] }, [lim('cashMin', 5)]);
  assert.strictEqual(find(floor, 'cashMin').state, 'breach');
  const zero = g.evaluate({ ...input, cash: [] }, [lim('cashMin', 0)]);
  assert.strictEqual(find(zero, 'cashMin').state, 'ok');
});

test('guardrails: named-holding limits, missing holdings and notes', () => {
  const r = g.evaluate(input, [lim('symbolMax', 20, { symbol: 'FUND' }), lim('symbolMax', 5, { symbol: 'ZZZ' })]);
  assert.strictEqual(find(r, 'symbolMax', 'FUND').state, 'breach');
  assert.strictEqual(find(r, 'symbolMax', 'ZZZ').state, 'ok');
  assert.ok(r.notes.some((n) => n.includes('BBB.SI')));
  assert.ok(r.notes.some((n) => /looked through/.test(n)));
});

test('guardrails: zero net worth is no-data, not ok', () => {
  const r = g.evaluate({ base: 'SGD', positions: [], cash: [], accounts: [] }, [lim('positionMax', 10)]);
  assert.strictEqual(find(r, 'positionMax').state, 'no-data');
});

test('guardrails: validation and persistence', () => {
  assert.throws(() => g.cleanLimit({ kind: 'nope', pct: 1 }), /Unknown limit kind/);
  assert.throws(() => g.cleanLimit({ kind: 'positionMax', pct: 120 }), /0 to 100/);
  assert.throws(() => g.cleanLimit({ kind: 'positionMax', pct: 'abc' }), /0 to 100/);
  assert.throws(() => g.cleanLimit({ kind: 'symbolMax', pct: 5, symbol: 'bad sym!' }), /valid symbol/);
  assert.throws(() => g.cleanLimit({ kind: 'cashMax', pct: 5, status: 'auto' }), /proposed or accepted/);
  assert.throws(() => g.cleanLimits([{ kind: 'cashMin', pct: 20 }, { kind: 'cashMax', pct: 10 }]), /floor is above/);
  assert.strictEqual(g.cleanLimit({ kind: 'cashMax', pct: '12.345' }).pct, 12.35);
  assert.strictEqual(g.cleanLimit({ kind: 'cashMax', pct: 5 }).status, 'proposed'); // never defaults to accepted

  assert.deepStrictEqual(g.loadLimits(), []);
  const saved = g.saveLimits([{ kind: 'positionMax', pct: 10, status: 'accepted', note: 'policy v0.2' }, { kind: 'symbolMax', symbol: 'aaa', pct: 4 }]);
  assert.strictEqual(saved.length, 2);
  const again = g.saveLimits(saved);
  assert.strictEqual(again[0]!.updatedAt, saved[0]!.updatedAt); // unchanged entries keep their date
  assert.deepStrictEqual(g.loadLimits().map((l) => [l.kind, l.symbol, l.pct, l.status]), [['positionMax', undefined, 10, 'accepted'], ['symbolMax', 'AAA', 4, 'proposed']]);
  g.saveLimits([]);
  assert.deepStrictEqual(g.loadLimits(), []);
});
