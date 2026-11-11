// Exports engine output for check_engine.py: trades through the real sandbox path,
// plus the P&L each engine computes itself, which this project's replay did not write.
// Usage: node verify/export_engine.ts <out.json>
// Optional live data: LIVE_SYMBOLS=AAPL,KO FINSIGHT_DATA_DIR=<isolated dir>
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { runSandbox } from '../../src/sandbox/host.ts';
import { cleanSeries } from '../../src/quant/data.ts';
import type { Bar } from '../../src/quant/data.ts';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
const engines = createRequire(import.meta.url)(path.join(REPO, 'public/strategies.js'));
const STRATEGIES = ['matrend', 'breakout', 'pullback', 'rsi2'];
const CUTS = [0.5, 0.7, 0.9];

function random(seed: number) {
  return () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function syntheticBars(seed: number, count: number): Bar[] {
  const rand = random(seed);
  const rows: Bar[] = [];
  let close = 40 + rand() * 200, drift = 0.001, day = Date.UTC(2019, 0, 2, 14, 30);
  while (rows.length < count) {
    const weekday = new Date(day).getUTCDay();
    if (weekday !== 0 && weekday !== 6) {
      if (rand() < 0.01) drift = (rand() - 0.42) * 0.006;
      const open = close * (1 + (rand() - 0.5) * 0.012);
      close = open * (1 + drift + (rand() - 0.5) * 0.035);
      const high = Math.max(open, close) * (1 + rand() * 0.012), low = Math.min(open, close) * (1 - rand() * 0.012);
      rows.push({ t: day, date: new Date(day).toISOString().slice(0, 10), o: open, h: high, l: low, c: close, v: 5e6 + rand() * 5e6, adj: null });
    }
    day += 864e5;
  }
  return rows;
}

const normalise = (rows: any[], bars: any[]) => rows.map((t) => ({ entryDate: bars[t.entryIdx].date, entry: t.entry, stop: t.stop, exits: t.exits.map((x: any) => ({ date: bars[x.i].date, px: x.px, qty: x.qty, why: x.why })) }));
const engineInput = (bars: Bar[]) => bars.map(({ adj: _adj, ...bar }) => bar);

async function exportDataset(name: string, series: Record<string, Bar[]>, dividends: Record<string, unknown>) {
  const out: any = { name, bars: series, dividends, strategies: [], noLookAheadTrades: 0 };
  const roots = { builtinDir: path.join(REPO, 'public'), privateDir: '' };
  for (const id of STRATEGIES) {
    const jobs = Object.entries(series).map(([symbol, bars]) => ({ id, symbol, bars: engineInput(bars) }));
    const sandbox = await runSandbox<{ results: any[] }>(roots, { op: 'trades', jobs }, 110_000, 512);
    const candidates: any[] = [], engineClosed: any[] = [];
    for (const row of sandbox.results) {
      assert.equal(row.error, undefined, `${id} ${row.symbol}: ${row.error}`);
      const input = engineInput(series[row.symbol]!);
      const direct = engines.run(id, input);
      const closed = normalise(direct.trades, direct.bars);
      const all = direct.open ? [...closed, ...normalise([direct.open], direct.bars)] : closed;
      assert.deepEqual(row.trades, all, `${id} ${row.symbol}: sandbox output differs from the engine`);
      for (const t of row.trades) candidates.push({ symbol: row.symbol, ...t });
      direct.trades.forEach((t: any, i: number) => engineClosed.push({ symbol: row.symbol, entryDate: closed[i]!.entryDate, entry: t.entry, pnl: t.pnl }));
      // No look-ahead: a trade finished before the cut must be identical with later bars removed.
      for (const cut of CUTS) {
        const end = Math.floor(input.length * cut);
        const shorter = engines.run(id, input.slice(0, end));
        const finished = closed.filter((_t, i) => direct.trades[i].exitIdx < end - 1);
        assert.deepEqual(normalise(shorter.trades, shorter.bars).slice(0, finished.length), finished, `${id} ${row.symbol}: look-ahead at cut ${cut}`);
        out.noLookAheadTrades += finished.length;
      }
    }
    out.strategies.push({ id, candidates, engineClosed });
  }
  return out;
}

const datasets: any[] = [];
const synthetic: Record<string, Bar[]> = {};
for (let i = 0; i < 14; i++) synthetic[`S${i}`] = syntheticBars(1000 + i, 1600);
datasets.push(await exportDataset('synthetic', synthetic, {}));

if (process.env.LIVE_SYMBOLS) {
  assert.ok(process.env.FINSIGHT_DATA_DIR, 'FINSIGHT_DATA_DIR must isolate the cache from personal data');
  const { getHistory, getDividendHistory } = await import('../../../lib/market.ts');
  const series: Record<string, Bar[]> = {}, dividends: Record<string, unknown> = {};
  for (const symbol of process.env.LIVE_SYMBOLS.split(',')) {
    series[symbol] = cleanSeries(symbol, (await getHistory(symbol, '10y', '1d')).points, Date.now()).bars;
    dividends[symbol] = (await getDividendHistory(symbol)).map((d: any) => ({ date: new Date(d.t).toISOString().slice(0, 10), amount: d.amount }));
  }
  datasets.push(await exportDataset('live', series, dividends));
}

fs.writeFileSync(process.argv[2]!, JSON.stringify(datasets));
console.log(datasets.map((d) => `${d.name}: ${d.strategies.map((s: any) => `${s.id}=${s.engineClosed.length}`).join(' ')}; look-ahead checked on ${d.noLookAheadTrades} trades`).join('\n'));
