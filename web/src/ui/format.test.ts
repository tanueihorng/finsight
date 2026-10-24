import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as format from './format.ts';

test('all formatters match legacy source for 20 sample values and known/unknown currencies', () => {
  const source = fs.readFileSync(new URL('../../../public/app.js', import.meta.url), 'utf8');
  const helpers = source.slice(source.indexOf('const fmt ='), source.indexOf('// Reads always'));
  const legacy = vm.runInNewContext(`${helpers}\n({fmt,fmtBig,signStr,csym,money,moneyBig,moneySigned})`) as typeof format;
  const samples = [null, undefined, NaN, 0, -0, 0.001, -0.001, 1, -1, 999.995, 1000, -1000, 1e6, -1e6, 1e9, -1e9, 1e12, -1e12, Infinity, -Infinity];
  assert.equal(samples.length, 20);
  for (const value of samples) {
    for (const decimals of [0, 2, 4]) {
      assert.equal(format.fmt(value, decimals), legacy.fmt(value, decimals));
      assert.equal(format.signStr(value, decimals), legacy.signStr(value, decimals));
      for (const ccy of ['USD', 'SGD', 'EUR', 'JPY', 'CHF', 'usd', 'ZZZ', '']) {
        assert.equal(format.money(ccy, value, decimals), legacy.money(ccy, value, decimals));
        assert.equal(format.moneySigned(ccy, value, decimals), legacy.moneySigned(ccy, value, decimals));
        assert.equal(format.moneyBig(ccy, value), legacy.moneyBig(ccy, value));
        assert.equal(format.csym(ccy), legacy.csym(ccy));
      }
    }
    assert.equal(format.fmtBig(value), legacy.fmtBig(value));
  }
});
