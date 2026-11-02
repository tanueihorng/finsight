import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fakeFinsight, testConfig, testCtx, TOKEN } from './helpers.ts';
import type { Fake } from './helpers.ts';
import { buildRegistry } from '../src/tools/index.ts';
import { ADR_RATIOS, EARNINGS_6K, filerType } from '../src/tools/web.ts';

let fake: Fake;
before(async () => { fake = await fakeFinsight(); });
after(async () => { await fake.close(); });
const reg = buildRegistry();
const run = async (name: string, args: unknown, ctx = testCtx(testConfig(fake))) => {
  const r = await reg.execute(name, args, ctx);
  return { ...r, json: JSON.parse(r.content.split('\n…[TRUNCATED')[0]!) };
};

test('every tool has a JSON schema and a unique, valid name', () => {
  const s = reg.schemas();
  assert.ok(s.length >= 25);
  for (const t of s) { assert.equal(t.parameters.type, 'object'); assert.ok(t.description.length > 20, t.name); }
});

test('no tool can write to FinSight, trade or send (prohibited capabilities)', () => {
  const names = reg.list().map((t) => t.name).join(' ');
  for (const bad of ['buy', 'sell', 'order', 'trade', 'transfer', 'send_', 'email', 'delete', 'withdraw']) assert.ok(!new RegExp(`\\b${bad}`).test(names), bad);
});

test('facts calls use the GET-only token', async () => {
  await run('get_portfolio', {});
  const c = fake.calls.find((x) => x.path === '/api/portfolio')!;
  assert.equal(c.method, 'GET'); assert.equal(c.auth, `Bearer ${TOKEN}`);
});

test('query_positions filters, sorts and totals in code', async () => {
  const r = await run('query_positions', { currency: 'USD', sortBy: 'unrealizedPct', limit: 5 });
  assert.equal(r.ok, true);
  assert.deepEqual(r.json.rows.map((x: any) => x.symbol), ['NVDA', 'VOO']);
  assert.equal(r.json.totals.marketValue, 5400);
  assert.equal(r.json.totals.weightPct, 90);
});

test('query_positions by sector uses FinSight categories', async () => {
  const r = await run('query_positions', { sector: 'tech' });
  assert.deepEqual(r.json.rows.map((x: any) => x.symbol), ['NVDA']);
});

test('get_exposures by currency includes cash and sums to 100%', async () => {
  const r = await run('get_exposures', { by: 'currency' });
  const sum = r.json.rows.reduce((s: number, x: any) => s + x.weightPct, 0);
  assert.ok(Math.abs(sum - 100) < 0.05, String(sum));
  assert.equal(r.json.total, 10350);
  assert.equal(r.json.lookThrough, false);
});

test('invalid tool input is rejected before execution', async () => {
  const r = await run('query_positions', { limit: 999 });
  assert.equal(r.ok, false); assert.equal(r.json.error.code, 'TOOL_INPUT_INVALID');
});

test('FinSight down gives FINSIGHT_DOWN, never a guess', async () => {
  const cfg = testConfig(fake, { finsightUrl: 'http://127.0.0.1:9' });
  const r = await run('get_portfolio', {}, testCtx(cfg));
  assert.equal(r.ok, false); assert.equal(r.json.error.code, 'FINSIGHT_DOWN');
});

test('records tools are confined to the records folder', async () => {
  const r = await run('get_policy', {});
  assert.match(r.json.text, /Policy v0\.1/);
  const s = await run('search_memory', { query: 'HBM supply', scope: 'notes' });
  assert.match(s.json.results[0].source, /reviews\/semis\.md$/);
});

test('size_position: shares from net worth x risk / per-share risk in base currency, with warnings', async () => {
  const r = await run('size_position', { symbol: 'NVDA', entry: 200, stop: 190, riskPct: 1 });
  assert.equal(r.ok, true);
  // risk = 10350 x 1% = 103.5 SGD; per share = (200-190) x 1.35 = 13.5 SGD -> 7 shares
  assert.equal(r.json.result.shares, 7);
  assert.equal(r.json.result.costBase, Math.round(7 * 200 * 1.35));
  assert.ok(r.json.warnings.some((w: string) => /placeholder cap/.test(w)), 'concentration warning');
  assert.ok(r.json.warnings.some((w: string) => /Earnings/.test(w)), 'earnings warning');
  assert.match(r.json.placeholders, /not accepted policy/);
  const bad = await run('size_position', { symbol: 'NVDA', entry: 100, stop: 110 });
  assert.equal(bad.ok, false);
});

test('context pack is compact and dated', async () => {
  const r = await run('get_context_pack', {});
  assert.ok(r.json.asOf); assert.equal(r.json.summary.netWorth, 10350);
  assert.ok(r.content.length < 6000, `pack ${r.content.length} chars`);
  assert.equal(r.json.eventsNext14d[0].symbol, 'NVDA');
});

test('propose_record_update stores a proposal only', async () => {
  const ctx = testCtx(testConfig(fake));
  const r = await run('propose_record_update', { kind: 'profile', text: 'Loan rate is 4.5%' }, ctx);
  assert.equal(r.json.status, 'pending');
  assert.equal((ctx.db.prepare('SELECT COUNT(*) n FROM proposals').get() as any).n, 1);
});

test('strategy tools run the real FinSight engines in the sandbox', async () => {
  const cfg = testConfig(fake);
  const list = await run('list_strategies', {}, testCtx(cfg));
  assert.ok(list.json.strategies.length >= 5);
  assert.ok(list.json.strategies.every((s: any) => s.status && (s.status === 'accepted' || s.label)));
  const one = await run('run_strategy', { id: 'matrend', symbol: 'NVDA' }, testCtx(cfg));
  assert.equal(one.ok, true, one.content); assert.equal(one.json.result.kind, 'trade');
  const again = await run('run_strategy', { id: 'matrend', symbol: 'NVDA' }, testCtx(cfg));
  assert.deepEqual(again.json.result, one.json.result, 'deterministic');
  const scan = await run('scan_strategies', { scope: 'holdings', onlyLive: false }, testCtx(cfg));
  assert.equal(scan.ok, true, scan.content);
  assert.equal(scan.json.scanned.symbols, 3);
  assert.equal(fake.calls.filter((c) => c.path === '/api/history/batch').length >= 1, true, 'batch endpoint used');
});

test('private strategy plugins: valid one loads; escapes are denied', async () => {
  const cfg = testConfig(fake);
  const root = cfg.privateStrategiesDir;
  const mk = (id: string, engine: string, manifest: object = {}) => {
    fs.mkdirSync(path.join(root, id), { recursive: true });
    fs.writeFileSync(path.join(root, id, 'manifest.json'), JSON.stringify({ apiVersion: 1, kind: 'strategy', id, name: id, version: '0.1.0', status: 'idea', engine: 'engine.js', ...manifest }));
    fs.writeFileSync(path.join(root, id, 'engine.js'), engine);
  };
  mk('good', 'module.exports = { run: (bars) => ({ kind: "trade", stage: { code: "none", label: "No setup", detail: String(bars.length) }, setups: [], trades: [], stats: { n: 0 } }) };');
  mk('reads-file', 'const fs = require("fs"); module.exports = { run: () => ({ kind: "trade", stage: { label: fs.readFileSync("/etc/hosts", "utf8") } }) };');
  mk('net', 'const http = require("node:http"); module.exports = { run: () => ({}) };');
  mk('fetcher', 'module.exports = { run: () => { fetch("http://127.0.0.1:1"); return {}; } };');
  mk('escape', 'module.exports = {}', { engine: '../good/engine.js' });
  const list = await run('list_strategies', {}, testCtx(cfg));
  const ids = list.json.strategies.map((s: any) => s.key);
  assert.ok(ids.includes('good'));
  for (const bad of ['reads-file', 'net', 'escape']) assert.ok(list.json.invalid.some((i: any) => i.id === bad), `${bad} rejected`);
  const r = await run('run_strategy', { id: 'good', symbol: 'NVDA' }, testCtx(cfg));
  assert.equal(r.json.result.stage.label, 'No setup');
  const f = await run('run_strategy', { id: 'fetcher', symbol: 'NVDA' }, testCtx(cfg));
  assert.match(JSON.stringify(f.json), /fetch is not a function|error/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('weights name their basis; both denominators come from one snapshot and liabilities stay unknown', async () => {
  const p = await run('get_portfolio', {});
  assert.equal(p.json.weightBasis, 'securities');
  assert.equal(p.json.denominators.securities.value, 6000);
  assert.equal(p.json.denominators.securities_plus_cash.value, 10350);
  assert.equal(p.json.denominators.liabilities, 'not tracked');
  const voo = p.json.positions.find((x: any) => x.symbol === 'VOO');
  assert.equal(voo.weightPct, 45); // displayed meaning unchanged
  assert.equal(voo.weightInclCashPct, 26.09);
  const q = await run('query_positions', { currency: 'USD' });
  assert.equal(q.json.weightBasis, 'securities');
  assert.equal(q.json.totals.weightInclCashPct, 52.18);
  const e = await run('get_exposures', { by: 'currency' });
  assert.equal(e.json.weightBasis, 'securities_plus_cash');
  assert.equal(e.json.denominator.value, e.json.total);
});

test('portfolio_weights computes single and combined weights on both bases in code', async () => {
  const r = await run('portfolio_weights', { symbols: ['voo', 'NVDA', 'ZZZZ'] });
  assert.equal(r.ok, true);
  assert.deepEqual(r.json.rows.map((x: any) => [x.symbol, x.securitiesPct, x.weightInclCashPct]), [['VOO', 45, 26.09], ['NVDA', 45, 26.09]]);
  assert.deepEqual([r.json.combined.marketValue, r.json.combined.securitiesPct, r.json.combined.weightInclCashPct], [5400, 90, 52.17]);
  assert.deepEqual(r.json.notHeld, ['ZZZZ']);
  assert.equal(r.json.denominators.liabilities, 'not tracked');
});

test('sector exposure lists members, separates sector from instrument type and never hides failed lookups as Other', async () => {
  const r = await run('get_exposures', { by: 'sector' });
  const row = (g: string) => r.json.rows.find((x: any) => x.group === g);
  assert.deepEqual(row('ETF / Fund').members.map((m: any) => [m.symbol, m.classification]), [['VOO', 'instrument_type']]);
  assert.deepEqual(row('Technology').members.map((m: any) => [m.symbol, m.classification]), [['NVDA', 'sector']]);
  assert.deepEqual(row('Unclassified').members.map((m: any) => m.symbol), ['D05.SI']);
  assert.equal(row('Other'), undefined);
  for (const x of r.json.rows) assert.ok(Math.abs(x.members.reduce((s: number, m: any) => s + m.value, 0) - x.value) < 0.01, x.group);
  assert.deepEqual([r.json.coverage.bySectorPct, r.json.coverage.byInstrumentTypePct, r.json.coverage.unclassifiedPct], [45, 45, 10]);
  assert.deepEqual(r.json.coverage.funds, ['VOO']);
  assert.equal(r.json.coverage.fundLookThrough, 'unknown');
  assert.equal(r.json.lookThrough, false);
});

test('get_fund_profile labels an aggregator source and partial look-through; non-funds fail plainly', async () => {
  const r = await run('get_fund_profile', { symbol: 'VOO' });
  assert.equal(r.ok, true);
  assert.equal(r.json.sourceClass, 'aggregator');
  assert.equal(r.json.lookThrough.coveragePct, 13.5);
  assert.equal(r.json.expenseRatioPct, 0.03);
  const miss = await run('get_fund_profile', { symbol: 'NVDA' });
  assert.equal(miss.ok, false);
});

test('get_history labels price return and derives range distances in code', async () => {
  const r = await run('get_history', { symbol: 'NVDA', range: '1y' });
  assert.equal(r.json.returnKind, 'price');
  assert.equal(r.json.lastVsHighPct, Math.round((r.json.lastClose / r.json.high - 1) * 10000) / 100);
  assert.ok(r.json.lastVsLowPct >= 0 && r.json.lastVsHighPct <= 0);
});

test('get_macro_series summarises in code instead of returning every daily point', async () => {
  const r = await run('get_macro_series', { series: 'DGS10', start: '2026-01-01' });
  assert.equal(r.json.observations, 30);
  assert.deepEqual([r.json.first.date, r.json.last.date], ['2026-01-01', '2026-07-23']);
  assert.equal(r.json.high.value, 4.6); assert.equal(r.json.low.value, 4);
  assert.equal(r.json.changeFromFirst, Math.round((r.json.last.value - r.json.first.value) * 100) / 100);
  assert.equal(r.json.recent.length, 10); assert.equal(r.json.monthEnd.length, 7);
  assert.equal(r.json.points, undefined);
  assert.equal((await run('get_macro_series', { series: 'DGS10', start: '2026-01-01', full: true })).json.points.length, 30);
});

test('valuation_metrics derives trailing EPS, P/E, earnings yield and market cap in code from SEC data and the live quote', async () => {
  const r = await run('valuation_metrics', { ticker: 'AMD' });
  assert.equal(r.ok, true, JSON.stringify(r.json));
  assert.equal(r.json.ttm.epsDiluted.value, 1.5);
  assert.equal(r.json.ttm.epsDiluted.method, 'sum of last four discrete quarters');
  assert.equal(r.json.price.value, 10);
  assert.equal(r.json.peTrailing, 6.67); assert.equal(r.json.earningsYieldPct, 15);
  assert.equal(r.json.marketCap, 10000); assert.equal(r.json.psTrailing, 10);
  assert.equal(r.json.ttm.revenue.concept, 'RevenueFromContractWithCustomerExcludingAssessedTax');
  assert.deepEqual(r.json.sharesOutstanding, { value: 1000, asOf: '2026-07-25', filed: '2026-08-01', kind: 'common shares' });
  assert.equal(r.json.filerType, 'domestic'); assert.equal(r.json.adr, undefined); assert.deepEqual(r.json.gaps, []);
});

test('edgar_recent_8k reads the earnings exhibit when present, bounded and marked untrusted', async () => {
  const r = await run('edgar_recent_8k', { ticker: 'AMD', limit: 2 });
  assert.equal(r.ok, true, JSON.stringify(r.json));
  assert.match(r.json.notice, /UNTRUSTED/);
  assert.deepEqual(r.json.reports.map((x: any) => [x.filed, x.items, x.exhibit]), [['2026-09-28', '8.01', false], ['2026-08-04', '2.02,9.01', true]]);
  assert.match(r.json.reports[1].text, /Synthetic quarterly results/);
  assert.ok(r.json.reports.every((x: any) => x.text.length <= 3000 && x.url.startsWith('https://www.sec.gov/Archives/edgar/data/2488/')));
});

// AMD council audit 2026-10-31: the tools now carry the facts the answer got wrong.
test('edgar_recent_8k finds the latest earnings release by item and flags a pending agreement', async () => {
  const latest = await run('edgar_recent_8k', { ticker: 'AMD', limit: 1 });
  assert.equal(latest.json.reports[0].eventStatus, 'pending');
  assert.match(latest.json.reports[0].eventNote, /potential/);
  const earnings = await run('edgar_recent_8k', { ticker: 'AMD', limit: 1, items: ['2.02'], maxChars: 8000 });
  assert.deepEqual(earnings.json.reports.map((x: any) => [x.filed, x.exhibit, x.eventStatus]), [['2026-08-04', true, undefined]]);
  const none = await run('edgar_recent_8k', { ticker: 'AMD', items: ['5.02'] });
  assert.deepEqual(none.json.reports, []); assert.match(none.json.note, /No recent 8-K reports item 5\.02/);
});

test('edgar_financials computes the annual change, and valuation_metrics marks combined EPS approximate', async () => {
  const f = await run('edgar_financials', { ticker: 'AMD', concepts: ['RevenueFromContractWithCustomerExcludingAssessedTax'] });
  const annual = f.json.concepts.RevenueFromContractWithCustomerExcludingAssessedTax.annual;
  assert.deepEqual(annual.map((x: any) => [x.fy, x.changePctFromPriorYear]), [[2025, 34.41], [2024, undefined]]);
  const v = await run('valuation_metrics', { ticker: 'AMD' });
  assert.equal(v.json.epsApproximate, true);
  assert.match(v.json.epsMethodNote, /approximate/);
});

// TSM council audit 2026-10-31: a foreign private issuer files 6-K and 20-F,
// never 8-K, and its ADR price must not be multiplied by ordinary shares.
test('edgar_recent_8k uses the 6-K results release and names the 20-F for a foreign private issuer', async () => {
  const r = await run('edgar_recent_8k', { ticker: 'TSM', limit: 1, items: ['2.02'], maxChars: 8000 });
  assert.equal(r.ok, true, JSON.stringify(r.json));
  assert.equal(r.json.filerType, 'foreign_private_issuer');
  assert.equal(r.json.formUsed, '6-K earnings release filed 2026-10-15');
  // The newer monthly revenue 6-K is not mistaken for results.
  assert.deepEqual(r.json.reports.map((x: any) => [x.form, x.filed, x.classification, x.document, x.items]), [['6-K', '2026-10-15', 'earnings_release', 'q3release.htm', null]]);
  assert.match(r.json.reports[0].text, /third quarter EPS of 1\.20 per ADR/);
  assert.deepEqual(r.json.annualReport, { form: '20-F', filed: '2026-04-16', period: '2025-12-31', url: 'https://www.sec.gov/Archives/edgar/data/9001/000000900126000001/annual.htm' });
  assert.match(r.json.note, /6-K, not 8-K/);
  const latest = await run('edgar_recent_8k', { ticker: 'TSM', limit: 2 });
  assert.deepEqual(latest.json.reports.map((x: any) => [x.filed, x.classification]), [['2026-10-08', 'other'], ['2026-10-15', 'earnings_release']]);
  const none = await run('edgar_recent_8k', { ticker: 'FPX', items: ['2.02'] });
  assert.deepEqual(none.json.reports, []); assert.match(none.json.note, /None of the last 1 6-K reports names quarterly results/);
  // A US registrant keeps the 8-K path.
  assert.equal((await run('edgar_recent_8k', { ticker: 'AMD', limit: 1 })).json.formUsed, '8-K filed 2026-09-28');
});

test('the 6-K earnings classifier accepts results releases and rejects other home-market disclosures', () => {
  for (const yes of ['99.2 2026 Third Quarter Earnings Conference Presentation Material', 'TSMC Reports Third Quarter EPS of NT$29.43', 'Announcement of fourth quarter 2025 financial results', 'Quarterly results for the period']) assert.ok(EARNINGS_6K.test(yes), yes);
  for (const no of ['TSMC September 2026 Revenue Report', 'Board of Directors Meeting Resolutions: approved the 2026 second quarter Business Report and Financial Statements', 'Adjustment to Cash Dividend Per Share', 'Consolidated Financial Statements for the Six Months Ended June 30, 2026', 'changes in the shareholdings of directors']) assert.ok(!EARNINGS_6K.test(no), no);
  assert.equal(filerType(['6-K', '20-F']), 'foreign_private_issuer'); assert.equal(filerType(['8-K', '10-Q']), 'domestic'); assert.equal(filerType(['SC 13G']), 'unknown');
});

test('valuation_metrics converts ordinary shares with the ADR ratio and refuses mixed-currency multiples', async () => {
  const v = await run('valuation_metrics', { ticker: 'TSM' });
  assert.equal(v.ok, true, JSON.stringify(v.json));
  assert.equal(v.json.filerType, 'foreign_private_issuer'); assert.equal(v.json.taxonomy, 'ifrs-full');
  // 10 USD per ADR × (5,000 ordinary ÷ 5) — not 10 × 5,000.
  assert.equal(v.json.price.value, 10);
  assert.deepEqual([v.json.adr.ordinaryPerAdr, v.json.adr.adrEquivalentShares], [5, 1000]);
  assert.equal(v.json.marketCap, 10000); assert.match(v.json.marketCapBasis, /ordinary shares ÷ 5/);
  // EPS and revenue are in the reporting currency (not the USD convenience translation), converted at spot XTW→USD 0.032.
  assert.equal(v.json.ttm.epsDiluted.unit, 'XTW/shares'); assert.equal(v.json.ttm.revenue.unit, 'XTW');
  // EPS 3.2 XTW × 5 per ADR × 0.032 = 0.512 USD; P/E 10 ÷ 0.512; revenue 64,000 × 0.032 = 2,048 USD.
  assert.equal(v.json.peTrailing, 19.53); assert.equal(v.json.earningsYieldPct, 5.12); assert.equal(v.json.psTrailing, 4.88);
  assert.deepEqual([v.json.fxConversion.currency, v.json.fxConversion.usdPerUnit, v.json.fxConversion.symbol], ['XTW', 0.032, 'XTWUSD=X']);
  assert.equal(v.json.epsApproximate, true); assert.match(v.json.epsMethodNote, /converted from XTW at the spot rate/);
  assert.ok(v.json.gaps.some((g: string) => /6-K without XBRL/.test(g)));
});

test('valuation_metrics refuses foreign-currency multiples when no USD rate is available', async () => {
  const noFx = await fakeFinsight({ fx: {} });
  try {
    const v = await run('valuation_metrics', { ticker: 'TSM' }, testCtx(testConfig(noFx)));
    assert.equal(v.json.marketCap, 10000);
    assert.equal(v.json.peTrailing, null); assert.equal(v.json.earningsYieldPct, null); assert.equal(v.json.psTrailing, null); assert.equal(v.json.fxConversion, null);
    assert.ok(v.json.gaps.some((g: string) => /XTW\/shares/.test(g) && /No XTW to USD rate/.test(g)));
  } finally { await noFx.close(); }
});

test('valuation_metrics refuses market cap and P/E for a foreign issuer with an unknown ADR ratio, and uses a known one', async () => {
  const v = await run('valuation_metrics', { ticker: 'FPX' });
  assert.equal(v.json.filerType, 'foreign_private_issuer');
  assert.deepEqual(v.json.adr, { ordinaryPerAdr: null, status: 'ratio_unknown' });
  assert.equal(v.json.marketCap, null); assert.equal(v.json.peTrailing, null); assert.equal(v.json.earningsYieldPct, null);
  assert.match(v.json.gaps[0], /ordinary shares per ADR are not known/);
  ADR_RATIOS.FPX = { ordinaryPerAdr: 2, source: 'synthetic' };
  try {
    const k = await run('valuation_metrics', { ticker: 'FPX' });
    // 10 × 2,000 ÷ 2; EPS 1 USD per ordinary share is 2 per ADR, so P/E 5.
    assert.equal(k.json.marketCap, 10000); assert.equal(k.json.peTrailing, 5); assert.equal(k.json.earningsYieldPct, 20);
  } finally { delete ADR_RATIOS.FPX; }
});

test('ADR ratios come from filings and leave dual-class issuers out', () => {
  assert.deepEqual([ADR_RATIOS.BABA?.ordinaryPerAdr, ADR_RATIOS.TM?.ordinaryPerAdr, ADR_RATIOS.SHEL?.ordinaryPerAdr], [8, 10, 2]);
  for (const [t, r] of Object.entries(ADR_RATIOS)) assert.match(r.source, /20-F/, t);
  for (const t of ['PDD', 'BIDU', 'JD']) assert.equal(ADR_RATIOS[t], undefined, t);
});

test('edgar_financials reads IFRS 20-F facts for a foreign private issuer', async () => {
  const f = await run('edgar_financials', { ticker: 'TSM', concepts: ['Revenues', 'EarningsPerShareDiluted'] });
  assert.equal(f.json.taxonomy, 'ifrs-full');
  assert.deepEqual([f.json.concepts.Revenues.concept, f.json.concepts.Revenues.annualForm, f.json.concepts.Revenues.annual[0].value], ['Revenue', '20-F', 64000]);
  assert.deepEqual(f.json.missing, []); assert.match(f.json.note, /furnished on 6-K without XBRL/);
});

test('get_earnings_dates reports whether each date is past or upcoming', async () => {
  const r = await run('get_earnings_dates', { symbols: ['amd'] });
  assert.equal(r.ok, true, JSON.stringify(r.json));
  assert.deepEqual(r.json.rows.map((x: any) => [x.symbol, x.earningsDate, x.estimated]), [['AMD', '2026-11-03T21:00:00.000Z', false]]);
  assert.ok(['past', 'upcoming'].includes(r.json.rows[0].timing));
});

test('portfolio weights and exposures name their account scope', async () => {
  assert.equal((await run('portfolio_weights', { symbols: ['NVDA'] })).json.accountScope, 'All accounts combined');
  assert.equal((await run('portfolio_weights', { symbols: ['NVDA'], account: 'a1' })).json.accountScope, 'Account a1 only');
  assert.equal((await run('get_exposures', { by: 'sector' })).json.accountScope, 'All accounts combined');
});

test('the EX-99 release is found under filer-specific names', async () => {
  const { exhibit99 } = await import('../src/tools/web.ts');
  const amd = [{ name: '0000002488-26-000121-index.html', size: '' }, { name: 'amd-20260804.htm', size: '30308' }, { name: 'amdq22026earningsslidesf.htm', size: '35590' }, { name: 'q22026991.htm', size: '448891' }, { name: 'R1.htm', size: '38073' }];
  assert.equal(exhibit99(amd, 'amd-20260804.htm'), 'q22026991.htm');
  assert.equal(exhibit99([{ name: 'k2.htm' }, { name: 'ex99-1.htm' }], 'k2.htm'), 'ex99-1.htm');
  assert.equal(exhibit99([{ name: 'k3.htm' }], 'k3.htm'), undefined);
});

test('an exhibit in an SEC SGML envelope still yields its text', async () => {
  const { secHtml, htmlToText } = await import('../src/tools/web.ts');
  const body = '<html><head><title>Document</title></head><body><p>' + 'Second quarter revenue was $11.5 billion. '.repeat(10) + '</p></body></html>';
  const raw = '<DOCUMENT>\n<TYPE>EX-99.1\n<SEQUENCE>2\n<FILENAME>q22026991.htm\n<TEXT>\n' + body;
  assert.equal(htmlToText(raw, 'u').text, '');
  assert.match(htmlToText(secHtml(raw), 'u').text, /Second quarter revenue/);
  assert.equal(secHtml(body), body);
});
