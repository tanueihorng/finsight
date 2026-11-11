// Test harness: a fake FinSight on a random loopback port with a synthetic
// portfolio (never real data), plus an isolated agent home and records dir.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { loadConfig } from '../src/config.ts';
import type { Config } from '../src/config.ts';
import { openDb } from '../src/store/db.ts';
import type { DB } from '../src/store/db.ts';
import { finsightClient } from '../src/tools/finsight.ts';
import type { ToolCtx } from '../src/tools/registry.ts';
import { setLogSink } from '../src/log.ts';

export const logs: string[] = [];
setLogSink((l) => logs.push(l));
process.env.AGENT_NO_KEYCHAIN = '1';

// SEC EDGAR is never reached from tests: sec.gov requests get synthetic data
// (AMD is the only registrant) and every other host goes to the real fetch,
// which tests point only at loopback fakes.
export const SEC_CALLS: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  // FINRA short interest is never reached from tests either: one synthetic row.
  if (url.hostname === 'api.finra.org') { SEC_CALLS.push('finra:' + url.pathname); return new Response(JSON.stringify([{ settlementDate: '2026-10-15', currentShortPositionQuantity: 1000, changePercent: 1, averageDailyVolumeQuantity: 500, daysToCoverQuantity: 2, issueName: 'Synthetic' }]), { status: 200, headers: { 'content-type': 'application/json' } }); }
  if (!/(^|\.)sec\.gov$/.test(url.hostname)) return realFetch(input, init);
  SEC_CALLS.push(url.pathname);
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  if (url.pathname === '/files/company_tickers.json') return json(200, { 0: { cik_str: 2488, ticker: 'AMD', title: 'Synthetic Micro Devices' }, 1: { cik_str: 9001, ticker: 'TSM', title: 'Synthetic Foundry Co (ADR)' }, 2: { cik_str: 9002, ticker: 'FPX', title: 'Synthetic Foreign Issuer' } });
  // Foreign private issuers: 6-K current reports and a 20-F, no 8-K. Only one
  // 6-K is a results release; the newest is a monthly revenue report.
  if (url.pathname === '/submissions/CIK0000009001.json') return json(200, { filings: { recent: { form: ['6-K', '6-K', '6-K', '20-F'], accessionNumber: ['0000009001-26-000004', '0000009001-26-000003', '0000009001-26-000002', '0000009001-26-000001'], filingDate: ['2026-10-08', '2026-10-15', '2026-08-11', '2026-04-16'], reportDate: ['2026-09-30', '2026-09-30', '2026-06-30', '2025-12-31'], primaryDocument: ['rev.htm', 'cover.htm', 'board.htm', 'annual.htm'], primaryDocDescription: ['6-K', '6-K', '6-K', '20-F'], items: ['', '', '', ''] } } });
  if (url.pathname === '/submissions/CIK0000009002.json') return json(200, { filings: { recent: { form: ['6-K', '20-F'], accessionNumber: ['0000009002-26-000002', '0000009002-26-000001'], filingDate: ['2026-09-01', '2026-03-01'], reportDate: ['', '2025-12-31'], primaryDocument: ['notice.htm', 'annual.htm'], primaryDocDescription: ['6-K', '20-F'], items: ['', ''] } } });
  if (url.pathname === '/api/xbrl/companyfacts/CIK0000009001.json') return json(200, { facts: {
    dei: { EntityCommonStockSharesOutstanding: { units: { shares: [{ end: '2025-12-31', val: 5000, form: '20-F', filed: '2026-04-16' }] } } },
    'ifrs-full': {
      Revenue: { label: 'Revenue', units: { XTW: [{ form: '20-F', fp: 'FY', fy: 2025, start: '2025-01-01', end: '2025-12-31', val: 64000, filed: '2026-04-16' }], USD: [{ form: '20-F', fp: 'FY', fy: 2025, start: '2025-01-01', end: '2025-12-31', val: 2000, filed: '2026-04-16' }] } },
      DilutedEarningsLossPerShare: { label: 'Diluted EPS', units: { 'XTW/shares': [{ form: '20-F', fp: 'FY', fy: 2025, start: '2025-01-01', end: '2025-12-31', val: 3.2, filed: '2026-04-16' }], 'USD/shares': [{ form: '20-F', fp: 'FY', fy: 2025, start: '2025-01-01', end: '2025-12-31', val: 0.1, filed: '2026-04-16' }] } },
    } } });
  if (url.pathname === '/api/xbrl/companyfacts/CIK0000009002.json') return json(200, { facts: {
    dei: { EntityCommonStockSharesOutstanding: { units: { shares: [{ end: '2025-12-31', val: 2000, filed: '2026-03-01' }] } } },
    'us-gaap': { EarningsPerShareDiluted: { label: 'EPS', units: { 'USD/shares': [{ form: '20-F', fp: 'FY', fy: 2025, start: '2025-01-01', end: '2025-12-31', val: 1, filed: '2026-03-01' }] } } } } });
  const fpi = '/Archives/edgar/data/9001/';
  if (url.pathname === fpi + '000000900126000004/rev.htm') return new Response('<html><body><p>Synthetic Foundry September 2026 Revenue Report: revenue for September was approximately 500.</p></body></html>', { status: 200 });
  if (url.pathname === fpi + '000000900126000003/cover.htm') return new Response('<html><body><p>FORM 6-K REPORT OF FOREIGN PRIVATE ISSUER. Exhibits: 99.1 Press release issued on October 15, 2026. 99.2 2026 Third Quarter Earnings Conference Presentation Material.</p></body></html>', { status: 200 });
  if (url.pathname === fpi + '000000900126000003/index.json') return json(200, { directory: { item: [{ name: 'cover.htm', size: 900 }, { name: 'q3presentation.htm', size: 9000 }, { name: 'q3release.htm', size: 3000 }] } });
  if (url.pathname === fpi + '000000900126000003/q3release.htm') return new Response('<html><body><p>Synthetic Foundry reports third quarter EPS of 1.20 per ADR unit. Management expects fourth quarter revenue between 60 and 62.</p></body></html>', { status: 200 });
  if (url.pathname === fpi + '000000900126000002/board.htm') return new Response('<html><body><p>Board of Directors Meeting Resolutions: approved the 2026 second quarter Business Report and Financial Statements.</p></body></html>', { status: 200 });
  if (url.pathname === '/submissions/CIK0000002488.json') return json(200, { filings: { recent: { form: ['8-K', '10-Q', '8-K'], accessionNumber: ['0000002488-26-000003', '0000002488-26-000001', '0000002488-26-000002'], filingDate: ['2026-09-28', '2026-08-01', '2026-08-04'], reportDate: ['', '2026-06-30', ''], primaryDocument: ['k3.htm', 'q2.htm', 'k2.htm'], primaryDocDescription: ['8-K', '10-Q', '8-K'], items: ['8.01', '', '2.02,9.01'] } } });
  if (url.pathname === '/api/xbrl/companyfacts/CIK0000002488.json') return json(200, { facts: {
    dei: { EntityCommonStockSharesOutstanding: { units: { shares: [{ end: '2026-07-25', val: 1000, filed: '2026-08-01' }] } } },
    'us-gaap': {
      // Like AMD: an abandoned concept listed first must not shadow the current one.
      Revenues: { label: 'Revenues', units: { USD: [{ form: '10-K', fp: 'FY', fy: 2017, start: '2017-01-01', end: '2017-12-31', val: 999999, filed: '2018-02-01' }] } },
      RevenueFromContractWithCustomerExcludingAssessedTax: { label: 'Revenue', units: { USD: [{ form: '10-K', fp: 'FY', fy: 2024, start: '2024-01-01', end: '2024-12-31', val: 744, filed: '2025-02-01' }, { form: '10-K', fp: 'FY', fy: 2025, start: '2025-01-01', end: '2025-12-31', val: 1000, filed: '2026-02-01' }] } },
      // Four discrete quarters: TTM diluted EPS 0.5 + 0.5 + 0.25 + 0.25 = 1.5.
      EarningsPerShareDiluted: { label: 'EPS', units: { 'USD/shares': [['2025-07-01', '2025-09-30', 0.5], ['2025-10-01', '2025-12-31', 0.5], ['2026-01-01', '2026-03-31', 0.25], ['2026-04-01', '2026-06-30', 0.25]].map(([start, end, val]) => ({ form: '10-Q', start, end, val, filed: '2026-08-01' })) } },
    } } });
  if (url.pathname === '/Archives/edgar/data/2488/000000248826000003/index.json') return json(200, { directory: { item: [{ name: 'k3.htm' }] } });
  if (url.pathname === '/Archives/edgar/data/2488/000000248826000002/index.json') return json(200, { directory: { item: [{ name: 'k2.htm' }, { name: 'ex99-1.htm' }] } });
  if (url.pathname === '/Archives/edgar/data/2488/000000248826000003/k3.htm') return new Response('<html><body><p>Synthetic Micro Devices entered into a definitive merger agreement to acquire Synthetic Labs for stock. The transaction is expected to close by year end, subject to customary closing conditions.</p></body></html>', { status: 200 });
  if (url.pathname === '/Archives/edgar/data/2488/000000248826000002/ex99-1.htm') return new Response('<html><body><p>Synthetic quarterly results: revenue rose.</p></body></html>', { status: 200 });
  return json(404, {});
}) as typeof fetch;

export const TOKEN = 'test-token-0123456789abcdef0123456789abcdef';
export const PROXY_SECRET = 'test-proxy-secret-0123456789abcdef01234567';

export const PORTFOLIO = {
  base: 'SGD', fx: { USD: 1.35, SGD: 1 }, fxMissing: [], account: 'ALL',
  positions: [
    { symbol: 'NVDA', name: 'NVIDIA', currency: 'USD', quantity: 10, avgCost: 100, last: 200, marketValue: 2700, cost: 1350, unrealized: 1350, unrealizedPct: 100, fxPnl: 0, dayChange: 27, weight: 45, quoted: true },
    { symbol: 'VOO', name: 'Vanguard S&P 500', currency: 'USD', quantity: 4, avgCost: 400, last: 500, marketValue: 2700, cost: 2160, unrealized: 540, unrealizedPct: 25, fxPnl: 0, dayChange: -10, weight: 45, quoted: true },
    { symbol: 'D05.SI', name: 'DBS', currency: 'SGD', quantity: 15, avgCost: 30, last: 40, marketValue: 600, cost: 450, unrealized: 150, unrealizedPct: 33.33, fxPnl: 0, dayChange: 3, weight: 10, quoted: true },
  ],
  cash: [{ ccy: 'SGD', amount: 3000, base: 3000 }, { ccy: 'USD', amount: 1000, base: 1350 }],
  summary: { totalValue: 6000, totalCost: 3960, cashBase: 4350, netWorth: 10350, totalUnrealized: 2040, realizedPnl: 120 },
};

function bars(n: number, start = 100, drift = 0.002) {
  const out = []; let p = start;
  for (let i = 0; i < n; i++) { p *= 1 + Math.sin(i / 9) * 0.01 + drift; out.push({ t: Date.UTC(2024, 0, 1) + i * 864e5, o: p * 0.995, h: p * 1.01, l: p * 0.99, c: p, v: 5e6 }); }
  return out;
}

export type Fake = { url: string; dataDir: string; calls: { method: string; path: string; auth: string | undefined }[]; close: () => Promise<void>; down: boolean; book?: 'real' | 'paper' };

export async function fakeFinsight(options: { scopedAccounts?: boolean; naturalHistory?: boolean; fx?: Record<string, number>; currency?: Record<string, string | null> } = {}): Promise<Fake> {
  // FX pairs the fake quote path knows; any other =X symbol has no price.
  const fx = options.fx ?? { 'XTWUSD=X': 0.032 };
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-fs-'));
  fs.writeFileSync(path.join(dataDir, 'agent-link.json'), JSON.stringify({ token: TOKEN, proxySecret: PROXY_SECRET }), { mode: 0o600 });
  const calls: Fake['calls'] = [];
  const fake: Fake = { url: '', dataDir, calls, down: false, close: async () => {} };
  const server = http.createServer((req, res) => {
    const u = new URL(req.url || '/', 'http://x');
    calls.push({ method: req.method || '', path: u.pathname, auth: req.headers.authorization });
    const j = (s: number, b: unknown) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(b)); };
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return j(401, { error: 'Locked' });
    if (req.method !== 'GET') return j(403, { error: 'no' });
    if (fake.book) res.setHeader('X-FinSight-Book', fake.book); // set by tests of book identity
    switch (u.pathname) {
      case '/api/book': return fake.book ? j(200, { book: fake.book }) : j(404, { error: 'Unknown endpoint' });
      case '/api/portfolio': {
        const account = u.searchParams.get('account');
        if (!options.scopedAccounts || !account || account === 'ALL') return j(200, PORTFOLIO);
        const positions = account === 'a1' ? PORTFOLIO.positions.slice(0, 2) : account === 'a2' ? PORTFOLIO.positions.slice(2) : [];
        const cash = account === 'a1' ? PORTFOLIO.cash.filter((c) => c.ccy === 'USD') : account === 'a2' ? PORTFOLIO.cash.filter((c) => c.ccy === 'SGD') : [];
        const totalValue = positions.reduce((n, p) => n + p.marketValue, 0), cashBase = cash.reduce((n, c) => n + c.base, 0);
        return j(200, { ...PORTFOLIO, account, positions, cash, summary: { totalValue, cashBase, netWorth: totalValue + cashBase, totalCost: positions.reduce((n, p) => n + p.cost, 0), totalUnrealized: positions.reduce((n, p) => n + p.unrealized, 0), realizedPnl: account === 'a1' ? 100 : account === 'a2' ? 20 : 0 } });
      }
      case '/api/accounts': return j(200, { accounts: [{ id: 'a1', name: 'IBKR', type: 'Brokerage', count: 2 }, { id: 'a2', name: 'DBS', type: 'Bank', count: 1 }], activeId: 'a1' });
      case '/api/categories': return j(200, { NVDA: { symbol: 'NVDA', sector: 'Technology', type: 'EQUITY', category: 'Technology' }, VOO: { symbol: 'VOO', sector: null, type: 'ETF', category: 'ETF / Fund' }, 'D05.SI': { symbol: 'D05.SI', category: 'Other' } });
      case '/api/events': return j(200, { events: [{ symbol: 'NVDA', type: 'Earnings', time: Date.now() + 5 * 864e5 }] });
      case '/api/fund': return u.searchParams.get('symbol') === 'VOO'
        ? j(200, { symbol: 'VOO', family: 'Synthetic Funds', category: 'Large Blend', legalType: 'Exchange Traded Fund', expenseRatioPct: 0.03, totalAssets: 1e11, currency: 'USD', assetMix: { stocksPct: 99.5, bondsPct: 0, cashPct: 0.5, otherPct: 0 }, topHoldings: [{ symbol: 'NVDA', name: 'NVIDIA', weightPct: 7.5 }, { symbol: 'SYNB', name: 'Synthetic B', weightPct: 6 }], topHoldingsPct: 13.5, sectorWeights: [{ sector: 'technology', weightPct: 33 }] })
        : j(404, { error: 'No fund profile' });
      case '/api/fred': return j(200, { series: u.searchParams.get('series'), transform: 'lin', points: Array.from({ length: 30 }, (_, i) => ({ date: new Date(Date.UTC(2026, 0, 1) + i * 7 * 864e5).toISOString().slice(0, 10), value: 4 + (i % 7) / 10 })) });
      case '/api/search': {
        const instruments = [{symbol:'AMD',name:'Advanced Micro Devices, Inc.'},{symbol:'NVDA',name:'NVIDIA Corporation'},{symbol:'TSM',name:'Taiwan Semiconductor Manufacturing Company Limited'},{symbol:'VOO',name:'Vanguard S&P 500 ETF'}];
        const q = (u.searchParams.get('q') || '').toLowerCase();
        return j(200, instruments.filter(x=>x.symbol.toLowerCase()===q || x.name.toLowerCase().includes(q)).map(x=>({...x,exchange:'NASDAQ',type:'EQUITY'})));
      }
      case '/api/quote-details': return j(200, { details: Object.fromEntries((u.searchParams.get('symbols') || '').split(',').map((symbol) => [symbol.toUpperCase(), { earningsStart: Date.UTC(2026, 10, 3, 21), earningsEnd: null, earningsEstimated: false }])) });
      case '/api/quote': return j(200, { quotes: (u.searchParams.get('symbols') || '').split(',').map((symbol) => {
        if (symbol.endsWith('=X')) return { symbol, name: symbol, type: 'CURRENCY', price: fx[symbol], currency: 'USD' };
        const p = PORTFOLIO.positions.find((p) => p.symbol === symbol);
        return { symbol, name: p?.name || symbol, type: symbol === 'VOO' ? 'ETF' : 'EQUITY', price: p?.last ?? 10, currency: p?.currency || 'USD', change: 1, changePct: 1 };
      }) });
      case '/api/history': {
        if (options.naturalHistory) {
          const now = Math.floor(Date.now() / 864e5) * 864e5;
          const symbol = u.searchParams.get('symbol');
          const position = PORTFOLIO.positions.find((p) => p.symbol === symbol);
          const latest = position?.last ?? 10;
          const points = Array.from({ length: 90 }, (_, i) => { const c = latest * (0.775 + i * 0.225 / 89); return { t: now - (89 - i) * 864e5, o: c, h: c, l: c, c, v: 1e6 }; });
          return j(200, { symbol, meta: { currency: position?.currency ?? 'USD' }, points });
        }
        return j(200, { symbol: u.searchParams.get('symbol'), meta: { currency: 'USD' }, points: bars(500) });
      }
      case '/api/history/batch': {
        const results: Record<string, unknown> = {};
        for (const s of (u.searchParams.get('symbols') || '').split(',')) {
          const currency = options.currency && s.toUpperCase() in options.currency ? options.currency[s.toUpperCase()] : 'USD';
          results[s.toUpperCase()] = { meta: currency ? { currency, currencyReported: true } : { currency: 'USD', currencyReported: false }, points: bars(500, 50 + s.length * 10) };
        }
        return j(200, { results });
      }
      case '/api/watchlist': return j(200, { watchlist: [{ symbol: 'AMD' }] });
      default: return j(404, { error: 'Unknown endpoint' });
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  fake.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  fake.close = () => new Promise((r) => { server.closeAllConnections(); server.close(() => r()); });
  return fake;
}

export function testConfig(fake: Fake, overrides: Partial<Config> = {}): Config {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-home-'));
  const records = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-rec-'));
  fs.writeFileSync(path.join(records, 'INVESTMENT_POLICY.md'), '# Policy v0.1\nLimits are proposals until accepted.\n');
  fs.writeFileSync(path.join(records, 'INVESTOR_PROFILE.md'), '# Profile\nSynthetic test profile.\n');
  fs.writeFileSync(path.join(records, 'DECISION_LOG.md'), '# Log\n## D-1\nProposal: review semis concentration.\n');
  fs.mkdirSync(path.join(records, 'reviews')); fs.writeFileSync(path.join(records, 'reviews', 'semis.md'), 'Semiconductor concentration note: HBM supply is tight.');
  const cfg = loadConfig({ FINSIGHT_DATA_DIR: fake.dataDir, AGENT_HOME: home, FINSIGHT_URL: fake.url, RECORDS_DIR: records, AGENT_PORT: '0' } as NodeJS.ProcessEnv);
  return { ...cfg, ...overrides };
}

export function testCtx(cfg: Config, db?: DB): ToolCtx {
  return { cfg, db: db ?? openDb(':memory:'), finsight: finsightClient(cfg.finsightUrl, cfg.finsightDataDir), signal: AbortSignal.timeout(30_000),
    budget: { searches: 10, fetches: 15 }, citations: [] };
}
