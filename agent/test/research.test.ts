// KESTRELTOOLS-001: research tools. Synthetic data only; no network.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config.ts';
import { openDb } from '../src/store/db.ts';
import { ToolRegistry } from '../src/tools/registry.ts';
import type { ToolCtx } from '../src/tools/registry.ts';
import { buildRegistry } from '../src/tools/index.ts';
import { createResearchTools, parseForm4, summariseInsiders, applyAmendments, technicals, rsi, dcfPerShare, impliedGrowth, median, latestShares, fundamentals } from '../src/tools/research.ts';

const cleanup: (() => void)[] = [];
afterEach(() => { for (const f of cleanup.splice(0).reverse()) f(); });

function ctxWith(finsightGet: (p: string, q?: any) => any = () => { throw Error('unused'); }): ToolCtx {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kestrel-research-'));
  cleanup.push(() => fs.rmSync(home, { recursive: true, force: true }));
  process.env.AGENT_NO_KEYCHAIN = '1';
  const cfg = loadConfig({ AGENT_HOME: home, FINSIGHT_DATA_DIR: home });
  const db = openDb(':memory:'); cleanup.push(() => db.close());
  return { cfg, db, finsight: { get: async (p: string, q?: any) => finsightGet(p, q) }, signal: new AbortController().signal, turnId: 't', threadId: 'th', citations: [], budget: { searches: 5, fetches: 5 } };
}
const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status });

const FORM4 = (code: string, shares: number, price: number, plan = false, ad = code === 'P' ? 'A' : 'D') => `<?xml version="1.0"?>
<ownershipDocument><documentType>4</documentType>
<reportingOwner><reportingOwnerId><rptOwnerName>Doe Jane</rptOwnerName></reportingOwnerId>
<reportingOwnerRelationship><isDirector>0</isDirector><isOfficer>1</isOfficer><isTenPercentOwner>0</isTenPercentOwner><officerTitle>CFO &amp; EVP</officerTitle></reportingOwnerRelationship></reportingOwner>
<aff10b5One>${plan ? 1 : 0}</aff10b5One>
<nonDerivativeTable><nonDerivativeTransaction><securityTitle><value>Common Stock</value></securityTitle><transactionDate><value>2026-10-15</value></transactionDate>
<transactionCoding><transactionFormType>4</transactionFormType><transactionCode>${code}</transactionCode></transactionCoding>
<transactionAmounts><transactionShares><value>${shares}</value><footnoteId id="F1"/></transactionShares><transactionPricePerShare><value>${price}</value></transactionPricePerShare>
<transactionAcquiredDisposedCode><value>${ad}</value></transactionAcquiredDisposedCode></transactionAmounts>
<postTransactionAmounts><sharesOwnedFollowingTransaction><value>5000</value></sharesOwnedFollowingTransaction></postTransactionAmounts></nonDerivativeTransaction></nonDerivativeTable>
</ownershipDocument>`;

test('Form 4 parsing keeps owner role, code, amounts and 10b5-1 flag', () => {
  const [t] = parseForm4(FORM4('S', 1000, 150.5, true), '2026-10-17', 'u');
  assert.deepEqual([t!.owner, t!.roles[0], t!.code, t!.shares, t!.price, t!.acquired, t!.ownedAfter, t!.plan10b5_1, t!.date], ['Doe Jane', 'CFO & EVP', 'S', 1000, 150.5, false, 5000, true, '2026-10-15']);
});

test('insider summary counts only open-market P/S and separates other codes', () => {
  const txs = [...parseForm4(FORM4('P', 100, 10), 'd', 'u'), ...parseForm4(FORM4('S', 300, 20, true), 'd', 'u'), ...parseForm4(FORM4('M', 999, 1), 'd', 'u'), ...parseForm4(FORM4('F', 50, 20), 'd', 'u')];
  const s = summariseInsiders(txs);
  assert.equal(s.openMarketBuys.valueUsd, 1000); assert.equal(s.openMarketSells.valueUsd, 6000); assert.equal(s.openMarketSells.under10b5_1Plan, 1);
  assert.equal(s.netOpenMarketValueUsd, -5000); assert.equal(s.byInsider[0]!.netValueUsd, -5000);
  assert.deepEqual(s.otherTransactionCodes.map((x) => x.code).sort(), ['F', 'M']);
});

test('insider_trades reads raw XML (not the XSL view), respects the window and records unreadable filings', async () => {
  const ctx = ctxWith(); const urls: string[] = [];
  const today = new Date().toISOString().slice(0, 10);
  const f = (async (u: any) => {
    const s = String(u); urls.push(s);
    if (s.endsWith('company_tickers.json')) return json({ 0: { cik_str: 77, ticker: 'SYN', title: 'Synthetic Inc' } });
    if (s.includes('/submissions/')) return json({ filings: { recent: { form: ['4', '8-K', '4', '4'], filingDate: [today, today, today, '2001-01-01'], accessionNumber: ['0001-26-1', '0001-26-2', '0001-26-3', '0001-01-4'], primaryDocument: ['xslF345X06/a.xml', 'k.htm', 'xslF345X06/b.xml', 'xslF345X06/c.xml'] } } });
    if (s.endsWith('/a.xml')) return new Response(FORM4('P', 10, 5));
    if (s.endsWith('/b.xml')) return new Response('nope', { status: 500 });
    throw Error('unexpected ' + s);
  }) as typeof fetch;
  const r = new ToolRegistry().add(...createResearchTools(f));
  const out = JSON.parse((await r.execute('insider_trades', { ticker: 'SYN', maxFilings: 2 }, ctx)).content);
  assert.ok(urls.some((u) => u.endsWith('/a.xml') && !u.includes('xsl')));
  assert.equal(out.filingsInWindow, 2); assert.equal(out.filingsRead, 2);
  assert.equal(out.summary.openMarketBuys.valueUsd, 50); assert.equal(out.errors.length, 1); assert.match(out.errors[0], /500/);
  assert.equal(out.sourceClass, 'primary'); assert.equal(ctx.citations.length, 1);
});

test('short_interest maps FINRA rows, sorts by date and computes % of shares outstanding', async () => {
  const ctx = ctxWith(); let body: any;
  const f = (async (u: any, o: any) => {
    const s = String(u);
    if (s.includes('finra')) { body = JSON.parse(o.body); return json([
      { settlementDate: '2026-10-15', currentShortPositionQuantity: 2000, changePercent: 100, averageDailyVolumeQuantity: 1000, daysToCoverQuantity: 2, issueName: 'Synthetic' },
      { settlementDate: '2026-09-30', currentShortPositionQuantity: 1000, changePercent: 0, averageDailyVolumeQuantity: 1000, daysToCoverQuantity: 1, issueName: 'Synthetic' }]); }
    if (s.endsWith('company_tickers.json')) return json({ 0: { cik_str: 77, ticker: 'SYN', title: 'Synthetic Inc' } });
    if (s.includes('companyfacts')) return json({ facts: { dei: { EntityCommonStockSharesOutstanding: { units: { shares: [{ end: '2026-09-30', val: 100000, accn: 'a', filed: '2026-10-01' }] } } } } });
    throw Error('unexpected ' + s);
  }) as typeof fetch;
  const out = JSON.parse((await new ToolRegistry().add(...createResearchTools(f)).execute('short_interest', { symbol: 'syn' }, ctx)).content);
  assert.equal(body.compareFilters[0].fieldValue, 'SYN');
  assert.equal(out.series[0].settlementDate, '2026-09-30'); assert.equal(out.latest.shortShares, 2000);
  assert.equal(out.latest.pctOfSharesOutstanding, 2); assert.equal(out.changeOverWindowPct, 100);
});

test('short_interest reports no data explicitly', async () => {
  const f = (async () => new Response(null, { status: 204 })) as unknown as typeof fetch;
  const out = JSON.parse((await new ToolRegistry().add(...createResearchTools(f)).execute('short_interest', { symbol: 'ZZZ' }, ctxWith())).content);
  assert.deepEqual(out.series, []); assert.match(out.gaps[0], /No FINRA/);
});

test('RSI and technicals on a known series', () => {
  assert.equal(rsi(Array.from({ length: 30 }, (_, i) => 100 + i)), 100);
  assert.equal(rsi([1, 2]), null);
  const day = 864e5, pts = Array.from({ length: 300 }, (_, i) => ({ t: Date.UTC(2025, 0, 1) + i * day, c: 100 + i }));
  const t = technicals(pts);
  assert.equal(t.movingAverages.sma20, 389.5); assert.equal(t.movingAverages.sma50AboveSma200, true);
  assert.equal(t.range52w.maxDrawdownPct, 0); assert.equal(t.returnsPct.m1, Math.round((399 / 378 - 1) * 10000) / 100);
  assert.ok(t.macd && t.macd.line! > 0); assert.equal(t.realizedVolAnnualPct.d30! > 0, true);
  // A dip then recovery produces a death then golden cross; the latest is golden.
  const v = [...Array.from({ length: 220 }, (_, i) => 200 - i * 0.5), ...Array.from({ length: 200 }, (_, i) => 90 + i)];
  assert.equal(technicals(v.map((c, i) => ({ t: i * day, c }))).movingAverages.lastCross?.type, 'golden');
});

test('technical_indicators returns relative returns vs the benchmark', async () => {
  const day = 864e5, series = (k: number) => Array.from({ length: 300 }, (_, i) => ({ t: i * day, c: 100 + k * i }));
  const ctx = ctxWith((p, q) => { assert.equal(p, '/api/history'); return { points: q.symbol === 'SPY' ? series(0.1) : series(1), meta: { currency: 'USD' } }; });
  const out = JSON.parse((await new ToolRegistry().add(...createResearchTools()).execute('technical_indicators', { symbol: 'SYN' }, ctx)).content);
  assert.ok(out.relativeToBenchmarkPctPts.m3 > 0); assert.equal(out.currency, 'USD');
});

test('DCF: constant growth matches a closed form; implied growth recovers the input', () => {
  // No growth, no fade: value = FCF/r exactly (perpetuity) when terminal growth is 0.
  const base = { fcf0: 100, growth: 0, discount: 0.1, terminal: 0, years: 10, fade: false, netDebt: 0, shares: 1 };
  assert.ok(Math.abs(dcfPerShare(base).perShare - 1000) < 1e-6);
  assert.ok(Math.abs(dcfPerShare({ ...base, netDebt: 200 }).perShare - 800) < 1e-6);
  const p = dcfPerShare({ ...base, growth: 0.12, fade: true, terminal: 0.025 }).perShare;
  const g = impliedGrowth({ fcf0: 100, discount: 0.1, terminal: 0.025, years: 10, fade: true, netDebt: 0, shares: 1 }, p);
  assert.ok(g !== null && Math.abs(g - 0.12) < 1e-6);
  assert.equal(impliedGrowth({ ...base, terminal: 0.025, fade: true }, 1e12), null);
  assert.throws(() => dcfPerShare({ ...base, terminal: 0.1 }), /Discount rate/);
});

test('fundamentals: FCF from matching periods, margins, net debt; shares summed across classes in one filing', () => {
  const q = (s: string, e: string, val: number) => ({ start: s, end: e, val, form: '10-Q', fp: 'Q', filed: e });
  const quarters = (v: number) => [q('2025-10-01', '2025-12-31', v), q('2026-01-01', '2026-03-31', v), q('2026-04-01', '2026-06-30', v), q('2026-07-01', '2026-09-30', v)];
  const facts = { facts: { 'us-gaap': {
    Revenues: { units: { USD: quarters(100) } }, OperatingIncomeLoss: { units: { USD: quarters(25) } }, NetIncomeLoss: { units: { USD: quarters(20) } },
    NetCashProvidedByUsedInOperatingActivities: { units: { USD: quarters(30) } }, PaymentsToAcquirePropertyPlantAndEquipment: { units: { USD: quarters(5) } },
    CashAndCashEquivalentsAtCarryingValue: { units: { USD: [{ end: '2026-09-30', val: 50, filed: 'x' }] } }, LongTermDebtNoncurrent: { units: { USD: [{ end: '2026-09-30', val: 80, filed: 'x' }] } },
  }, dei: { EntityCommonStockSharesOutstanding: { units: { shares: [{ end: '2026-10-20', val: 60, accn: 'b', filed: '2026-10-25' }, { end: '2026-10-20', val: 40, accn: 'b', filed: '2026-10-25' }, { end: '2026-07-20', val: 95, accn: 'a', filed: '2026-07-25' }] } } } } };
  const f = fundamentals(facts);
  assert.equal(f.ttm.freeCashFlow, 100); assert.equal(f.marginsPct.operating, 25); assert.equal(f.marginsPct.freeCashFlow, 25);
  assert.equal(f.balance.netDebt, 30);
  assert.deepEqual(latestShares(facts), { value: 100, asOf: '2026-10-20', filed: '2026-10-25', classes: 2 });
  assert.equal(median([3, null, 1, 2]), 2); assert.equal(median([1, 2, 3, 4]), 2.5); assert.equal(median([null]), null);
});

test('research tools are registered, read-only and offered to the Council', () => {
  const names = buildRegistry().list().map((t) => t.name);
  for (const n of ['insider_trades', 'short_interest', 'technical_indicators', 'dcf_valuation', 'peer_comparison']) assert.ok(names.includes(n), n);
  const src = fs.readFileSync(new URL('../src/chat/council.ts', import.meta.url), 'utf8');
  assert.match(src, /'dcf_valuation', 'peer_comparison'\]/);
});

test('ttm uses a first-quarter YTD (FY + Q1 − prior Q1) and prefers the longest YTD at the latest end', async () => {
  const { ttm } = await import('../src/tools/web.ts');
  const fy = { start: '2025-07-01', end: '2026-06-30', val: 400, form: '10-K', fp: 'FY', filed: '2026-07-30' };
  const q1 = { start: '2026-07-01', end: '2026-09-30', val: 120, form: '10-Q', fp: 'Q1', filed: '2026-10-25' };
  const pq1 = { start: '2025-07-01', end: '2025-09-30', val: 100, form: '10-Q', fp: 'Q1', filed: '2025-10-25' };
  const t1 = ttm([fy, q1, pq1])!;
  assert.equal(t1.value, 420); assert.equal(t1.periodEnd, '2026-09-30');
  // At Q3 a discrete three-month quarter and the nine-month YTD share an end date: use the YTD.
  const ytd9 = { start: '2026-07-01', end: '2027-03-31', val: 330, form: '10-Q', fp: 'Q3', filed: '2027-04-25' };
  const q3 = { start: '2027-01-01', end: '2027-03-31', val: 110, form: '10-Q', fp: 'Q3', filed: '2027-04-25' };
  const p9 = { start: '2025-07-01', end: '2026-03-31', val: 300, form: '10-Q', fp: 'Q3', filed: '2026-04-25' };
  const t3 = ttm([fy, ytd9, q3, p9])!;
  assert.equal(t3.value, 430); assert.match(t3.method, /year-to-date/);
});

test('net debt uses one balance-sheet date, picks up DebtSecuritiesCurrent and never double-counts current debt', () => {
  const i = (end: string, val: number) => ({ end, val, filed: end });
  const g = (extra: Record<string, unknown>) => fundamentals({ facts: { 'us-gaap': {
    CashAndCashEquivalentsAtCarryingValue: { units: { USD: [i('2026-07-26', 22)] } },
    MarketableSecuritiesCurrent: { units: { USD: [i('2025-10-26', 49)] } },
    ...extra } } });
  // NVDA pattern: securities moved to DebtSecuritiesCurrent; total LongTermDebt includes the current portion.
  const nv = g({ DebtSecuritiesCurrent: { units: { USD: [i('2026-07-26', 34)] } }, LongTermDebt: { units: { USD: [i('2026-07-26', 33)] } }, LongTermDebtCurrent: { units: { USD: [i('2026-07-26', 1)] } } });
  assert.equal(nv.balance.cashAndShortTermInvestments, 56); assert.equal(nv.balance.totalDebt, 33); assert.equal(nv.balance.netDebt, -23);
  // Noncurrent debt adds the current portion at the same date.
  assert.equal(g({ DebtSecuritiesCurrent: { units: { USD: [i('2026-07-26', 34)] } }, LongTermDebtNoncurrent: { units: { USD: [i('2026-07-26', 32)] } }, LongTermDebtCurrent: { units: { USD: [i('2026-07-26', 1)] } } }).balance.totalDebt, 33);
  // Securities only at an older date are excluded with a gap, not added or silently dropped.
  const stale = g({ LongTermDebtNoncurrent: { units: { USD: [i('2026-07-26', 32)] } } });
  assert.equal(stale.balance.cashAndShortTermInvestments, 22); assert.ok(stale.gaps.some((x) => /last reported 2025-10-26/.test(x)));
  // Debt reported only at another date: net debt refused.
  const mism = g({ DebtSecuritiesCurrent: { units: { USD: [i('2026-07-26', 34)] } }, LongTermDebtNoncurrent: { units: { USD: [i('2026-04-26', 32)] } } });
  assert.equal(mism.balance.netDebt, null); assert.ok(mism.gaps.some((x) => /net debt not computed/.test(x)));
});

test('revenue CAGR merges concepts by fiscal year and measures the span by date; share count falls back to diluted weighted average', () => {
  const y = (end: string, val: number) => ({ start: `${Number(end.slice(0, 4)) - 1}-12-31`.replace(/-12-31$/, '-01-01').replace(/^(\d{4})/, (m) => String(Number(m) + 1)), end, val, fp: 'FY', form: '10-K', filed: end });
  const thisYear = new Date().getUTCFullYear() - 1;
  const e = (k: number) => `${thisYear - k}-12-31`;
  const facts = { facts: { 'us-gaap': {
    Revenues: { units: { USD: [y(e(4), 100), y(e(2), 121), y(e(1), 133.1), y(e(0), 146.41)] } },
    RevenueFromContractWithCustomerExcludingAssessedTax: { units: { USD: [y(e(3), 110)] } },
    WeightedAverageNumberOfDilutedSharesOutstanding: { units: { shares: [{ start: `${thisYear}-07-01`, end: `${thisYear}-09-30`, val: 12, filed: 'x' }, { start: `${thisYear}-01-01`, end: `${thisYear}-09-30`, val: 13, filed: 'x' }] } },
  } } };
  const c = fundamentals(facts).revenueCagr!;
  assert.equal(c.years, 3); assert.equal(c.fromFiscalYearEnd, e(3)); assert.equal(c.cagrPct, 10);
  const sh = latestShares(facts)!; assert.equal(sh.value, 12); assert.match(sh.basis!, /weighted-average diluted/);
});

test('research tools give the Council a dated observation (asOf, at most 80 characters)', async () => {
  const day = 864e5;
  const ctx = ctxWith(() => ({ points: Array.from({ length: 60 }, (_, i) => ({ t: Date.UTC(2026, 8, 1) + i * day, c: 100 + i })) }));
  const t = JSON.parse((await new ToolRegistry().add(...createResearchTools()).execute('technical_indicators', { symbol: 'SYN', benchmark: 'SYN' }, ctx)).content);
  assert.equal(t.asOf, 'last daily bar 2026-10-30'); assert.ok(t.asOf.length <= 80);
  const src = fs.readFileSync(new URL('../src/tools/research.ts', import.meta.url), 'utf8');
  assert.equal((src.match(/asOf: (ends\.length \? )?`/g) ?? []).length, 5);
});

const withOwner = (xml: string, cik: string, period: string, amended = false) => xml
  .replace('<rptOwnerName>', `<rptOwnerCik>${cik}</rptOwnerCik><rptOwnerName>`)
  .replace('<documentType>4</documentType>', `<documentType>${amended ? '4/A' : '4'}</documentType><periodOfReport>${period}</periodOfReport>`);

test('a Form 4/A replaces the original report for the same owner and period instead of adding to it', () => {
  const orig = parseForm4(withOwner(FORM4('S', 1000, 100), '01', '2026-10-15'), '2026-10-17', 'u1');
  const amend = parseForm4(withOwner(FORM4('S', 1000, 110), '01', '2026-10-15', true), '2026-10-20', 'u2');
  const other = parseForm4(withOwner(FORM4('S', 500, 100), '02', '2026-10-15'), '2026-10-17', 'u3');
  const { kept, superseded } = applyAmendments([...amend, ...orig, ...other]);
  assert.equal(superseded, 1); assert.equal(kept.length, 2);
  assert.equal(summariseInsiders(kept).openMarketSells.valueUsd, 110000 + 50000);
});

test('insider_trades reports truncation when the window holds more filings than maxFilings', async () => {
  const ctx = ctxWith(); const today = new Date().toISOString().slice(0, 10);
  const f = (async (u: any) => {
    const s = String(u);
    if (s.endsWith('company_tickers.json')) return json({ 0: { cik_str: 77, ticker: 'SYN', title: 'Synthetic Inc' } });
    if (s.includes('/submissions/')) return json({ filings: { recent: { form: ['4', '4', '4'], filingDate: [today, today, today], accessionNumber: ['a-1', 'a-2', 'a-3'], primaryDocument: ['x1.xml', 'x2.xml', 'x3.xml'] } } });
    return new Response(FORM4('P', 1, 1));
  }) as typeof fetch;
  const out = JSON.parse((await new ToolRegistry().add(...createResearchTools(f)).execute('insider_trades', { ticker: 'SYN', maxFilings: 2 }, ctx)).content);
  assert.equal(out.filingsInWindow, 3); assert.equal(out.filingsRead, 2); assert.match(out.truncated, /2 most recent of 3/);
});

test('short_interest keeps FINRA nulls as null, not zero', async () => {
  const f = (async (u: any) => {
    const s = String(u);
    if (s.includes('finra')) return json([{ settlementDate: '2026-10-15', currentShortPositionQuantity: 10, changePercent: null, averageDailyVolumeQuantity: null, daysToCoverQuantity: null }]);
    return new Response('{}', { status: 404 });
  }) as typeof fetch;
  const out = JSON.parse((await new ToolRegistry().add(...createResearchTools(f)).execute('short_interest', { symbol: 'NUL' }, ctxWith())).content);
  assert.equal(out.latest.changePct, null); assert.equal(out.latest.daysToCover, null); assert.equal(out.latest.avgDailyVolume, null);
});

test('margins are refused when a flow ends on a different period from revenue', () => {
  const q = (s: string, e: string, val: number) => ({ start: s, end: e, val, form: '10-Q', fp: 'Q', filed: e });
  const four = (v: number) => [q('2025-10-01', '2025-12-31', v), q('2026-01-01', '2026-03-31', v), q('2026-04-01', '2026-06-30', v), q('2026-07-01', '2026-09-30', v)];
  const f = fundamentals({ facts: { 'us-gaap': {
    Revenues: { units: { USD: four(100) } },
    OperatingIncomeLoss: { units: { USD: [{ start: '2025-07-01', end: '2026-06-30', val: 90, form: '10-K', fp: 'FY', filed: 'x' }] } },
    NetIncomeLoss: { units: { USD: four(10) } },
  } } });
  assert.equal(f.marginsPct.operating, null); assert.equal(f.marginsPct.net, 10);
  assert.ok(f.gaps.some((g) => /operating income to 2026-06-30/.test(g)));
});

test('peer_comparison runs each company, keeps input order, reports per-company errors and medians', async () => {
  const q = (s: string, e: string, val: number) => ({ start: s, end: e, val, form: '10-Q', fp: 'Q', filed: e });
  const four = (v: number) => [q('2025-10-01', '2025-12-31', v), q('2026-01-01', '2026-03-31', v), q('2026-04-01', '2026-06-30', v), q('2026-07-01', '2026-09-30', v)];
  const facts = (k: number) => ({ facts: { dei: { EntityCommonStockSharesOutstanding: { units: { shares: [{ end: '2026-10-20', val: 100, accn: 'a', filed: '2026-10-25' }] } } }, 'us-gaap': {
    Revenues: { units: { USD: four(25 * k) } }, OperatingIncomeLoss: { units: { USD: four(5 * k) } }, NetIncomeLoss: { units: { USD: four(4 * k) } },
    EarningsPerShareDiluted: { units: { 'USD/shares': four(0.04 * k) } },
    NetCashProvidedByUsedInOperatingActivities: { units: { USD: four(6 * k) } }, PaymentsToAcquirePropertyPlantAndEquipment: { units: { USD: four(1 * k) } },
    CashAndCashEquivalentsAtCarryingValue: { units: { USD: [{ end: '2026-09-30', val: 50, filed: 'x' }] } }, LongTermDebtNoncurrent: { units: { USD: [{ end: '2026-09-30', val: 10, filed: 'x' }] } },
  } } });
  const fake = (async (u: any) => {
    const s = String(u);
    if (s.endsWith('company_tickers.json')) return json({ 0: { cik_str: 1, ticker: 'AAA', title: 'A Co' }, 1: { cik_str: 2, ticker: 'BBB', title: 'B Co' } });
    if (s.includes('/submissions/')) return json({ filings: { recent: { form: ['10-K', '10-Q'] } } });
    if (s.includes('companyfacts/CIK0000000001')) return json(facts(1));
    if (s.includes('companyfacts/CIK0000000002')) return json(facts(2));
    throw Error('unexpected ' + s);
  }) as typeof fetch;
  const real = globalThis.fetch; globalThis.fetch = fake; cleanup.push(() => { globalThis.fetch = real; });
  const ctx = ctxWith((p, qs) => ({ quotes: [{ symbol: qs.symbols, price: 10, currency: 'USD', marketTime: 1_790_000_000 }] }));
  const out = JSON.parse((await new ToolRegistry().add(...createResearchTools(fake)).execute('peer_comparison', { tickers: ['bbb', 'AAA', 'ZZZ'] }, ctx)).content);
  assert.deepEqual(out.companies.map((c: any) => c.ticker), ['BBB', 'AAA', 'ZZZ']);
  assert.match(out.companies[2].error, /not an SEC registrant/);
  const a = out.companies[1];
  assert.equal(a.marketCap, 1000); assert.equal(a.operatingMarginPct, 20); assert.equal(a.fcfYieldPct, 2); assert.equal(a.evToSales, 9.6);
  assert.equal(out.peerMedian.operatingMarginPct, 20); assert.match(out.asOf, /2026-09-30/);
});

test('dcf_valuation refuses on typed blockers (negative FCF), not on gap wording', async () => {
  const q = (s: string, e: string, val: number) => ({ start: s, end: e, val, form: '10-Q', fp: 'Q', filed: e });
  const four = (v: number) => [q('2025-10-01', '2025-12-31', v), q('2026-01-01', '2026-03-31', v), q('2026-04-01', '2026-06-30', v), q('2026-07-01', '2026-09-30', v)];
  const f = (async (u: any) => {
    const s = String(u);
    if (s.endsWith('company_tickers.json')) return json({ 0: { cik_str: 1, ticker: 'AAA', title: 'A Co' } });
    if (s.includes('/submissions/')) return json({ filings: { recent: { form: ['10-K'] } } });
    return json({ facts: { dei: { EntityCommonStockSharesOutstanding: { units: { shares: [{ end: '2026-10-20', val: 100, accn: 'a', filed: 'x' }] } } }, 'us-gaap': {
      Revenues: { units: { USD: four(25) } }, NetCashProvidedByUsedInOperatingActivities: { units: { USD: four(1) } }, PaymentsToAcquirePropertyPlantAndEquipment: { units: { USD: four(3) } },
      CashAndCashEquivalentsAtCarryingValue: { units: { USD: [{ end: '2026-09-30', val: 50, filed: 'x' }] } }, LongTermDebtNoncurrent: { units: { USD: [{ end: '2026-09-30', val: 10, filed: 'x' }] } } } } });
  }) as typeof fetch;
  const ctx = ctxWith(() => ({ quotes: [{ symbol: 'AAA', price: 10, currency: 'USD' }] }));
  const out = JSON.parse((await new ToolRegistry().add(...createResearchTools(f)).execute('dcf_valuation', { ticker: 'AAA' }, ctx)).content);
  assert.equal(out.status, 'refused'); assert.deepEqual(out.refusedFor, ['fcf_not_positive']);
});

test('SEC requests are paced to stay under 10 per second', async () => {
  const { secSlot } = await import('../src/tools/web.ts');
  await secSlot(); const t0 = Date.now();
  await Promise.all([secSlot(), secSlot(), secSlot()]);
  assert.ok(Date.now() - t0 >= 300, `three queued slots took ${Date.now() - t0} ms`);
});

test('review nits: unpriced insider rows are counted, not valued at zero; short history fails; equal discount and terminal is a typed refusal', async () => {
  const unpriced = parseForm4(FORM4('S', 100, 0), 'd', 'u').map((t) => ({ ...t, price: null }));
  const s = summariseInsiders([...unpriced, ...parseForm4(FORM4('S', 10, 5), 'd', 'u')]);
  assert.equal(s.openMarketSells.unpricedTransactions, 1); assert.equal(s.byInsider[0]!.netValueUsd, -50); assert.equal(s.byInsider[0]!.unpricedTransactions, 1);
  const ctx = ctxWith(() => ({ points: Array.from({ length: 10 }, (_, i) => ({ t: i * 864e5, c: 1 + i })) }));
  const short = await new ToolRegistry().add(...createResearchTools()).execute('technical_indicators', { symbol: 'SYN' }, ctx);
  assert.equal(short.ok, false); assert.match(short.content, /INSUFFICIENT_HISTORY/);
  const q = (st: string, e: string, val: number) => ({ start: st, end: e, val, form: '10-Q', fp: 'Q', filed: e });
  const four = (v: number) => [q('2025-10-01', '2025-12-31', v), q('2026-01-01', '2026-03-31', v), q('2026-04-01', '2026-06-30', v), q('2026-07-01', '2026-09-30', v)];
  const f = (async (u: any) => {
    const x = String(u);
    if (x.endsWith('company_tickers.json')) return json({ 0: { cik_str: 1, ticker: 'AAA', title: 'A Co' } });
    if (x.includes('/submissions/')) return json({ filings: { recent: { form: ['10-K'] } } });
    return json({ facts: { dei: { EntityCommonStockSharesOutstanding: { units: { shares: [{ end: '2026-10-20', val: 100, accn: 'a', filed: 'x' }] } } }, 'us-gaap': {
      Revenues: { units: { USD: four(25) } }, NetCashProvidedByUsedInOperatingActivities: { units: { USD: four(6) } }, PaymentsToAcquirePropertyPlantAndEquipment: { units: { USD: four(1) } },
      CashAndCashEquivalentsAtCarryingValue: { units: { USD: [{ end: '2026-09-30', val: 50, filed: 'x' }] } }, LongTermDebtNoncurrent: { units: { USD: [{ end: '2026-09-30', val: 10, filed: 'x' }] } } } } });
  }) as typeof fetch;
  const ctx2 = ctxWith(() => ({ quotes: [{ symbol: 'AAA', price: 10, currency: 'USD' }] }));
  const out = JSON.parse((await new ToolRegistry().add(...createResearchTools(f)).execute('dcf_valuation', { ticker: 'AAA', discountRatePct: 4, terminalGrowthPct: 4 }, ctx2)).content);
  assert.equal(out.status, 'refused'); assert.deepEqual(out.refusedFor, ['discount_not_above_terminal']);
});
