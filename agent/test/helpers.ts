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

export type Fake = { url: string; dataDir: string; calls: { method: string; path: string; auth: string | undefined }[]; close: () => Promise<void>; down: boolean };

export async function fakeFinsight(options: { scopedAccounts?: boolean; naturalHistory?: boolean } = {}): Promise<Fake> {
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
    switch (u.pathname) {
      case '/api/portfolio': {
        const account = u.searchParams.get('account');
        if (!options.scopedAccounts || !account || account === 'ALL') return j(200, PORTFOLIO);
        const positions = account === 'a1' ? PORTFOLIO.positions.slice(0, 2) : account === 'a2' ? PORTFOLIO.positions.slice(2) : [];
        const cash = account === 'a1' ? PORTFOLIO.cash.filter((c) => c.ccy === 'USD') : account === 'a2' ? PORTFOLIO.cash.filter((c) => c.ccy === 'SGD') : [];
        const totalValue = positions.reduce((n, p) => n + p.marketValue, 0), cashBase = cash.reduce((n, c) => n + c.base, 0);
        return j(200, { ...PORTFOLIO, account, positions, cash, summary: { totalValue, cashBase, netWorth: totalValue + cashBase, totalCost: positions.reduce((n, p) => n + p.cost, 0), totalUnrealized: positions.reduce((n, p) => n + p.unrealized, 0), realizedPnl: account === 'a1' ? 100 : account === 'a2' ? 20 : 0 } });
      }
      case '/api/accounts': return j(200, { accounts: [{ id: 'a1', name: 'IBKR', type: 'Brokerage', count: 2 }, { id: 'a2', name: 'DBS', type: 'Bank', count: 1 }], activeId: 'a1' });
      case '/api/categories': return j(200, { NVDA: { category: 'Technology' }, VOO: { category: 'ETF' }, 'D05.SI': { category: 'Financial Services' } });
      case '/api/events': return j(200, { events: [{ symbol: 'NVDA', type: 'Earnings', time: Date.now() + 5 * 864e5 }] });
      case '/api/search': {
        const instruments = [{symbol:'AMD',name:'Advanced Micro Devices, Inc.'},{symbol:'NVDA',name:'NVIDIA Corporation'},{symbol:'TSM',name:'Taiwan Semiconductor Manufacturing Company Limited'},{symbol:'VOO',name:'Vanguard S&P 500 ETF'}];
        const q = (u.searchParams.get('q') || '').toLowerCase();
        return j(200, instruments.filter(x=>x.symbol.toLowerCase()===q || x.name.toLowerCase().includes(q)).map(x=>({...x,exchange:'NASDAQ',type:'EQUITY'})));
      }
      case '/api/quote': return j(200, { quotes: (u.searchParams.get('symbols') || '').split(',').map((symbol) => {
        const p = PORTFOLIO.positions.find((p) => p.symbol === symbol);
        return { symbol, name: p?.name || symbol, price: p?.last ?? 10, currency: p?.currency || 'USD', change: 1, changePct: 1 };
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
        for (const s of (u.searchParams.get('symbols') || '').split(',')) results[s.toUpperCase()] = { points: bars(500, 50 + s.length * 10) };
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
