// FEAT-018 /api/exposure end to end: real server, fake market, isolated data
// dir with the synthetic holdings fixtures. Expected values are rebuilt from
// /api/portfolio's market values and the fixture weights, not from the engine.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer, setup, json } from './serverproc.ts';

const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} !≈ ${b}`);
const FIX = path.join(import.meta.dirname, 'fixtures', 'etf-holdings');

test('/api/exposure aggregates NVDA across a direct holding, VOO and QQQM, per account and book', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'finsight-exposure-'));
  fs.mkdirSync(path.join(dataDir, 'etf-holdings'));
  for (const f of fs.readdirSync(FIX).filter((x) => x.endsWith('.json'))) fs.copyFileSync(path.join(FIX, f), path.join(dataDir, 'etf-holdings', f));
  const s = await startServer({ dataDir }); t.after(() => s.stop());
  const c = await setup(s);
  for (const [symbol, quantity, price] of [['NVDA', 10, 100], ['VOO', 5, 500], ['QQQM', 10, 200]] as const) {
    const r = await s.req('POST', '/api/portfolio/buy?base=USD', json(c, { symbol, quantity, price }));
    assert.equal(r.status, 200, r.text);
  }
  const pf = (await s.req('GET', '/api/portfolio?base=USD', json(c))).json;
  const mv = Object.fromEntries(pf.positions.map((p: { symbol: string; marketValue: number }) => [p.symbol, p.marketValue]));
  const ex = (await s.req('GET', '/api/exposure?base=USD&asOf=2026-11-11', json(c))).json;
  assert.equal(ex.book, 'real'); assert.equal(ex.base, 'USD'); assert.equal(ex.asOf, '2026-11-11');
  const basis = mv.NVDA + mv.VOO + mv.QQQM;
  close(ex.basis, basis);
  const nvda = ex.issuers.find((e: { issuer: string }) => e.issuer === 'NVDA');
  // Fixture weights: VOO NVDA 7.5%, QQQM NVDA 9.0% (the 2026-10-31 file, not 8.4% from 09-30).
  close(nvda.direct, mv.NVDA); close(nvda.indirect, mv.VOO * 0.075 + mv.QQQM * 0.09);
  assert.deepEqual(nvda.contributions.map((x: { via: string; holdingsDate: string | null }) => [x.via, x.holdingsDate]).sort(),
    [['DIRECT', null], ['QQQM', '2026-10-31'], ['VOO', '2026-10-31']]);
  assert.equal(ex.reconciles, true); close(ex.mapped + ex.unmapped, basis);
  // VOO lists 34.9% (34.6% equities + 0.3% cash), QQQM 45.3% (45.1% + 0.2% cash): the rest is residual.
  close(ex.funds.find((f: { fund: string }) => f.fund === 'VOO').mappedValue, mv.VOO * 0.346);
  close(ex.funds.find((f: { fund: string }) => f.fund === 'QQQM').mappedValue, mv.QQQM * 0.451);
  assert.deepEqual(ex.fileErrors, []);

  // An account holding only VOO: no direct NVDA, nothing from the first account.
  const acct = (await s.req('POST', '/api/accounts/add', json(c, { name: 'Second', type: 'brokerage' }))).json.newId;
  await s.req('POST', `/api/portfolio/buy?base=USD&account=${acct}`, json(c, { symbol: 'VOO', quantity: 2, price: 500 }));
  const ex2 = (await s.req('GET', `/api/exposure?base=USD&asOf=2026-11-11&account=${acct}`, json(c))).json;
  assert.equal(ex2.account, acct);
  const n2 = ex2.issuers.find((e: { issuer: string }) => e.issuer === 'NVDA');
  close(n2.direct, 0); assert.deepEqual(n2.contributions.map((x: { via: string }) => x.via), ['VOO']);
  assert.equal(ex2.issuers.some((e: { issuer: string }) => e.issuer === 'AMD'), false, 'AMD is only in QQQM, held in the other account');

  // PAPER is a different book: none of the REAL rows.
  assert.equal((await s.req('POST', '/api/book', json(c, { book: 'paper' }))).status, 200);
  const ex3 = (await s.req('GET', '/api/exposure?base=USD&asOf=2026-11-11', json(c))).json;
  assert.equal(ex3.book, 'paper'); assert.equal(ex3.issuers.length, 0); close(ex3.basis, 0);

  assert.equal((await s.req('GET', '/api/exposure?asOf=11/11/2026', json(c))).status, 400);
  // Read-only: the REAL portfolio file is unchanged by exposure reads.
  await s.req('POST', '/api/book', json(c, { book: 'real' }));
  const after = (await s.req('GET', `/api/portfolio?base=USD&account=${pf.account}`, json(c))).json;
  assert.deepEqual(after.positions.map((p: { symbol: string; quantity: number }) => [p.symbol, p.quantity]), pf.positions.map((p: { symbol: string; quantity: number }) => [p.symbol, p.quantity]));
});
