'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { periodReturn, chainReturns, annualize, xirr, YEAR_MS } = require('../lib/returns');

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} !≈ ${b}`);

test('periodReturn: no flows is plain growth', () => {
  close(periodReturn(100, 110), 0.10);
});

test('periodReturn: a buy is not a gain', () => {
  // Held 100 which grew to 110; bought 50 more at the close -> 10%.
  close(periodReturn(100, 160, 50, 0), 0.10);
});

test('periodReturn: new money\'s intraday move is excluded once a book exists', () => {
  // Held 100 -> 110 (+10%). Also bought 50 at 50 that closed worth 60.
  close(periodReturn(100, 170, 50, 0, 0, 60), 0.10);
});

test('periodReturn: first day measures the new money itself', () => {
  // Nothing held; bought 100 that closed at 105.
  close(periodReturn(0, 105, 100, 0, 0, 105), 0.05);
});

test('periodReturn: selling everything does not explode', () => {
  // Held 100, market +10%, sold all for 110 at the end: value 0, outflow 110.
  close(periodReturn(100, 0, 0, 110), 0.10);
});

test('periodReturn: dividends count as return', () => {
  close(periodReturn(100, 100, 0, 0, 5), 0.05);
});

test('periodReturn: nothing held -> 0', () => {
  assert.equal(periodReturn(0, 0), 0);
});

test('chainReturns compounds', () => {
  close(chainReturns([0.1, 0.1]), 0.21);
  close(chainReturns([]), 0);
});

test('annualize: leaves sub-year spans alone, compounds longer ones', () => {
  close(annualize(0.05, YEAR_MS / 2), 0.05);
  close(annualize(0.21, 2 * YEAR_MS), 0.10);
  assert.equal(annualize(null, YEAR_MS), null);
});

test('xirr: one year, +10%', () => {
  close(xirr([{ t: 0, amount: -100 }, { t: YEAR_MS, amount: 110 }]), 0.10, 1e-7);
});

test('xirr: two deposits', () => {
  // -100 at t0, -100 at 1y, +231 at 2y  => r = 10%  (100*1.21 + 100*1.1 = 231)
  close(xirr([{ t: 0, amount: -100 }, { t: YEAR_MS, amount: -100 }, { t: 2 * YEAR_MS, amount: 231 }]), 0.10, 1e-7);
});

test('xirr: losses and no-solution cases', () => {
  close(xirr([{ t: 0, amount: -100 }, { t: YEAR_MS, amount: 50 }]), -0.5, 1e-7);
  assert.equal(xirr([{ t: 0, amount: -100 }, { t: YEAR_MS, amount: -5 }]), null);
  assert.equal(xirr([{ t: 0, amount: -100 }]), null);
});
