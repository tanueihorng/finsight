// Backtester and paper promotion (FEAT-015 §6). Runs the built-in strategy
// engines (public/strategies.js, the same code the chart uses) over a list of
// symbols, with the engines' own costs (10 bps a side + 5 bps slippage), an
// in-sample / out-of-sample split by date, and a buy-and-hold comparison.
// "Paper" is a status the owner records after a run clears a minimum-evidence
// floor; it means forward tracking of signals from that date. It never places,
// drafts or approves an order, and FinSight never marks a strategy "accepted".
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { DATA_DIR } from './config.ts';
import { getHistory } from './market.ts';
import type { BacktestRun, OwnerStatus, PaperGate, PaperRecord, PaperTrack, PaperTrade, StrategyRow, SymbolResult, TradeStats } from '../shared/backtest.ts';
export type { BacktestRun, StrategyRow, PaperTrack };

const require = createRequire(import.meta.url);
type Bar = { t: number; o: number; h: number; l: number; c: number; v?: number };
type EngineTrade = { entryIdx: number; exitIdx: number; entry: number; retPct: number; Rmult?: number };
type Engine = { list(): { id: string; name: string; kind: string; summary: string }[]; run(id: string, bars: Bar[]): { kind: string; trades?: EngineTrade[]; open?: { entryIdx: number } | null; measure?: string; stage?: { code: string; label: string } } };
let lib: Engine | null = null;
const engine = (): Engine => (lib ??= require('../public/strategies.js') as Engine);

/** Minimum evidence before a strategy may be recorded as "paper". FinSight defaults, not accepted policy. */
export const GATE = { minTrades: 30, minOutOfSample: 10 };
export const MAX_SYMBOLS = 40;
const SYM_RE = /^[A-Z0-9.^=\-]{1,20}$/;
const DAY = 864e5;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const FILE = () => path.join(DATA_DIR, 'strategy-status.json');
const LIB_EVIDENCE = () => path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'agent', 'plugins', 'strategy-evidence.json');

export function tradeStrategies() { return engine().list().filter((s) => s.kind === 'trade'); }

/** Pure: summary statistics of a list of closed trades. retPct is a fraction (0.05 = 5%). */
export function statsOf(trades: { retPct: number; Rmult?: number }[], measure: 'R' | 'pct'): TradeStats {
  if (!trades.length) return { n: 0, winRate: null, avgRetPct: null, expectancyR: null, compoundedPct: null };
  const r = trades.map((t) => t.retPct);
  return {
    n: r.length, winRate: r.filter((x) => x > 0).length / r.length * 100,
    avgRetPct: r.reduce((s, x) => s + x, 0) / r.length * 100,
    expectancyR: measure === 'R' ? trades.reduce((s, t) => s + (t.Rmult ?? 0), 0) / trades.length : null,
    compoundedPct: (r.reduce((p, x) => p * (1 + x), 1) - 1) * 100,
  };
}

/** Pure: one symbol's run, split at splitT (trades are assigned by entry date). */
export function symbolResult(symbol: string, bars: Bar[], trades: EngineTrade[], measure: 'R' | 'pct', splitT: number, warmup: number): SymbolResult {
  const closed = trades.filter((t) => t.exitIdx != null);
  const ins = closed.filter((t) => bars[t.entryIdx]!.t < splitT), oos = closed.filter((t) => bars[t.entryIdx]!.t >= splitT);
  const inMarket = closed.reduce((s, t) => s + (t.exitIdx - t.entryIdx), 0);
  const first = Math.min(warmup, bars.length - 1);
  const span = bars.length - 1 - first;
  const all = statsOf(closed, measure);
  return {
    symbol, bars: bars.length, from: bars.length ? iso(bars[first]!.t) : null, to: bars.length ? iso(bars[bars.length - 1]!.t) : null,
    all, inSample: statsOf(ins, measure), outOfSample: statsOf(oos, measure),
    timeInMarketPct: span > 0 ? Math.min(100, inMarket / span * 100) : null,
    buyHoldPct: span > 0 ? (bars[bars.length - 1]!.c / bars[first]!.c - 1) * 100 : null,
    strategyPct: all.compoundedPct ?? (span > 0 ? 0 : null),
  };
}

export function gateOf(all: TradeStats, oos: TradeStats): PaperGate {
  const reasons: string[] = [];
  if (all.n < GATE.minTrades) reasons.push(`${all.n} closed trades; at least ${GATE.minTrades} are needed.`);
  if (oos.n < GATE.minOutOfSample) reasons.push(`${oos.n} out-of-sample trades; at least ${GATE.minOutOfSample} are needed.`);
  return { ...GATE, passes: !reasons.length, reasons };
}

export function cleanUniverse(raw: unknown): string[] {
  const list = (Array.isArray(raw) ? raw : String(raw ?? '').split(/[\s,]+/)).map((s) => String(s).trim().toUpperCase()).filter(Boolean);
  const out = [...new Set(list)];
  if (!out.length) throw new Error('Give at least one symbol');
  if (out.length > MAX_SYMBOLS) throw new Error(`At most ${MAX_SYMBOLS} symbols per run`);
  for (const s of out) if (!SYM_RE.test(s)) throw new Error(`Not a symbol: ${s}`);
  return out;
}

/** Warm-up bars before a strategy can signal (engines' own minimums). */
const WARMUP: Record<string, number> = { pullback: 130, breakout: 252, matrend: 200, rsi2: 200 };

/** Pure given bars: the full run. */
export function runOn(id: string, data: Map<string, Bar[]>, opts: { range: string; splitPct?: number; now?: number }): BacktestRun {
  const meta = tradeStrategies().find((s) => s.id === id);
  if (!meta) throw new Error('Unknown or non-trading strategy');
  const splitPct = opts.splitPct ?? 30;
  const symbols: SymbolResult[] = [];
  const allT: EngineTrade[] = [], insT: EngineTrade[] = [], oosT: EngineTrade[] = [];
  let measure: 'R' | 'pct' = 'R';
  for (const [sym, bars] of data) {
    if (bars.length < (WARMUP[id] ?? 130) + 20) { symbols.push({ ...symbolResult(sym, bars, [], measure, 0, 0), error: 'Not enough daily history' }); continue; }
    const r = engine().run(id, bars);
    measure = r.measure === 'pct' ? 'pct' : 'R';
    const warm = WARMUP[id] ?? 130;
    const splitT = bars[warm]!.t + (bars[bars.length - 1]!.t - bars[warm]!.t) * (1 - splitPct / 100);
    const trades = (r.trades ?? []).filter((t) => t.exitIdx != null);
    const res = symbolResult(sym, bars, trades, measure, splitT, warm);
    symbols.push(res);
    for (const t of trades) { allT.push(t); (bars[t.entryIdx]!.t < splitT ? insT : oosT).push(t); }
  }
  const all = statsOf(allT, measure), inSample = statsOf(insT, measure), outOfSample = statsOf(oosT, measure);
  const compared = symbols.filter((s) => !s.error && s.buyHoldPct != null && s.strategyPct != null);
  return {
    strategy: { id, name: meta.name, measure }, range: opts.range, runAt: opts.now ?? Date.now(), universe: [...data.keys()], splitPct,
    symbols, total: { all, inSample, outOfSample, beatBuyHold: compared.filter((s) => s.strategyPct! > s.buyHoldPct!).length, compared: compared.length },
    gate: gateOf(all, outOfSample),
    notes: [
      'Costs: 10 bps a side plus 5 bps entry slippage, as in the chart engines. Taxes, FX and dividends are not modelled.',
      `Out of sample = trades entered in the last ${splitPct}% of each symbol's history after warm-up. The rules are fixed in code and were not tuned to this run.`,
      'Survivorship and selection bias: the universe is the list you chose (often names you already hold or watch), so results are flattering.',
      'Daily-bar proxies: several methods really trigger intraday. Buy-and-hold is from the first tradable bar after warm-up and is fully invested; the strategy is only in the market part of the time.',
      'A backtest is research evidence, not a recommendation.',
    ],
  };
}

async function barsFor(universe: string[], range: string): Promise<Map<string, Bar[]>> {
  const out = new Map<string, Bar[]>();
  await Promise.all(universe.map(async (s) => {
    try { out.set(s, (await getHistory(s, range, '1d')).points.filter((b) => [b.o, b.h, b.l, b.c].every((x) => typeof x === 'number' && Number.isFinite(x))) as Bar[]); }
    catch { out.set(s, []); }
  }));
  return new Map(universe.map((s) => [s, out.get(s) ?? []])); // keep the requested order
}

export async function backtest(id: unknown, universe: unknown, rangeIn: unknown = '5y', splitPct = 30): Promise<BacktestRun> {
  const range = rangeIn === '2y' || rangeIn === '10y' ? rangeIn : '5y';
  const syms = cleanUniverse(universe);
  if (typeof id !== 'string') throw new Error('strategy is required');
  return runOn(id, await barsFor(syms, range), { range, splitPct });
}

// ---- owner status (DATA_DIR/strategy-status.json) ---------------------------
export function loadStatus(): Record<string, PaperRecord> {
  try { const v = JSON.parse(fs.readFileSync(FILE(), 'utf8')); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; }
}
function saveStatus(m: Record<string, PaperRecord>) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = FILE() + '.tmp.' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(m, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, FILE());
}
function libraryStatus(): Record<string, { status?: string }> {
  try { return JSON.parse(fs.readFileSync(LIB_EVIDENCE(), 'utf8')); } catch { return {}; }
}

export function strategies(): StrategyRow[] {
  const own = loadStatus(), libStat = libraryStatus();
  return tradeStrategies().map((s) => ({ id: s.id, name: s.name, summary: s.summary, kind: s.kind, measure: null,
    libraryStatus: libStat[s.id]?.status ?? null, owner: own[s.id] ?? null }));
}

/** Pure: the record for a promotion, from a run that must clear the gate. */
export function promotionRecord(run: BacktestRun, note: unknown, now: number): PaperRecord {
  if (!run.gate.passes) throw new Error('Not enough evidence for paper: ' + run.gate.reasons.join(' '));
  const n = typeof note === 'string' ? note.trim().slice(0, 300) : '';
  return { status: 'paper', since: iso(now), universe: run.universe, range: run.range, updatedAt: now, ...(n ? { note: n } : {}),
    evidence: { runAt: run.runAt, n: run.total.all.n, outOfSampleN: run.total.outOfSample.n, avgRetPct: run.total.all.avgRetPct,
      outOfSampleAvgRetPct: run.total.outOfSample.avgRetPct, expectancyR: run.total.all.expectancyR } };
}

/** Record "paper" for a strategy. The run is redone here, so the evidence is the server's own. */
export async function promote(id: unknown, universe: unknown, range: unknown, note: unknown): Promise<PaperRecord> {
  const run = await backtest(id, universe, range);
  const rec = promotionRecord(run, note, Date.now());
  const m = loadStatus(); m[run.strategy.id] = rec; saveStatus(m);
  return rec;
}
export function setStatus(id: unknown, status: unknown): void {
  if (status === 'accepted') throw new Error('Only you can accept a strategy, in your investment policy; FinSight does not record it.');
  if (typeof id !== 'string' || !tradeStrategies().some((s) => s.id === id)) throw new Error('Unknown strategy');
  const m = loadStatus();
  if (status === 'clear') delete m[id];
  else if (status === 'backtested') { if (!m[id]) throw new Error('Nothing recorded for this strategy'); m[id] = { ...m[id]!, status: 'backtested' as OwnerStatus, updatedAt: Date.now() }; }
  else throw new Error('status must be backtested or clear');
  saveStatus(m);
}

const LIVE = new Set(['setup', 'signal', 'in-trade']);
/** Pure given bars: signals since the promotion date only (forward, out of sample by construction). */
export function trackOn(id: string, since: string, data: Map<string, Bar[]>): PaperTrack {
  const sinceT = Date.parse(since + 'T00:00:00Z');
  const trades: PaperTrade[] = [], closed: EngineTrade[] = [], live: PaperTrack['live'] = [];
  let measure: 'R' | 'pct' = 'R';
  for (const [sym, bars] of data) {
    if (bars.length < (WARMUP[id] ?? 130) + 1) continue;
    const r = engine().run(id, bars);
    measure = r.measure === 'pct' ? 'pct' : 'R';
    for (const t of r.trades ?? []) {
      if (bars[t.entryIdx]!.t < sinceT) continue;
      closed.push(t);
      trades.push({ symbol: sym, entryDate: iso(bars[t.entryIdx]!.t), exitDate: iso(bars[t.exitIdx]!.t), retPct: t.retPct * 100, R: t.Rmult ?? null, open: false });
    }
    if (r.open && bars[r.open.entryIdx]!.t >= sinceT) trades.push({ symbol: sym, entryDate: iso(bars[r.open.entryIdx]!.t), exitDate: null, retPct: null, R: null, open: true });
    // A simulated trade opened before the paper date is not part of the forward record.
    const preDated = r.stage?.code === 'in-trade' && (!r.open || bars[r.open.entryIdx]!.t < sinceT);
    if (r.stage && LIVE.has(r.stage.code) && !preDated) live.push({ symbol: sym, stage: r.stage.label });
  }
  trades.sort((a, b) => b.entryDate.localeCompare(a.entryDate));
  return { id, since, trades, stats: statsOf(closed, measure), live };
}

export async function paperTracks(): Promise<PaperTrack[]> {
  const out: PaperTrack[] = [];
  for (const [id, rec] of Object.entries(loadStatus())) {
    if (rec.status !== 'paper') continue;
    out.push(trackOn(id, rec.since, await barsFor(rec.universe, '2y')));
  }
  return out;
}
export { DAY };
