// Portfolio backtest (FEAT-014). The strategy engines produce candidate trades in
// the sandbox, the Python worker replays them through one cash-limited portfolio,
// and every figure in the answer comes from that code.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { ToolCtx, ToolDef } from './registry.ts';
import type { DB } from '../store/db.ts';
import { listAll, roots } from './strategies.ts';
import { runSandbox } from '../sandbox/host.ts';
import { runQuantWorker, workerHash } from '../quant/host.ts';
import { MAX_SAVED_RUNS, digest, listRuns, loadRun, saveRobustness, saveRun } from '../quant/runs.ts';
import type { SavedRun } from '../quant/runs.ts';
import { benchmarkWindowWarning, buildCalendar, cleanSeries, fingerprint, warmupWarning } from '../quant/data.ts';
import type { Bar } from '../quant/data.ts';
import { AgentError } from '../types.ts';

const MIN_BARS = 260;
const MAX_WARNINGS = 40;
const HISTORY_RANGE = '10y'; // the longest test plus the engines' warm-up
const SYMBOL = /^[A-Za-z0-9.-]{1,12}$/;
const VALIDATION = 'In-sample only: no out-of-sample test has been run.';
const ROBUSTNESS_MS = 120_000;
const ROBUSTNESS_LABEL = 'Robustness checks on historical data with frozen rules. This is not out-of-sample proof: the rules and the symbols were chosen by people who could already see this history.';
const ROBUSTNESS_LIMITS = [
  'Holdouts replay the same frozen rules on part of the history or universe. Nothing is re-fitted, so a pass shows stability, not a fresh test.',
  'Time windows are slices of the one continuous run, so positions carry in and the periods compound to the whole. Adjacent periods share one boundary day.',
  'Universe halves are split by symbol hash. Both halves still share the same period and market, so they are not independent evidence.',
  'Universe tests scale position size so a smaller universe can deploy as much capital as the full one. They still hold fewer names.',
  'Cost stress adds slippage per side on top of the run\'s costs. The same engine trades are used, and more cost can change share counts and skipped trades.',
  'Bootstrap intervals assume the sampled days represent the future and cover only sampling noise. They do not correct for survivorship, for choosing this strategy among others, or for regime change.',
  'The share of resamples above the benchmark is descriptive and is not a p-value.',
  'No check changes a strategy\'s status or authorises a paper order.',
];
const ENGINE_FILES = ['strategies.js', 'strategy.js', 'indicators.js'];

const ASSUMPTIONS = [
  'Daily bars, long-only, cash account, US dollars, one position per symbol.',
  'Entries, exits and fill prices come from the strategy engine, including its 5 bps entry slippage.',
  'Each entry targets the position percentage of the prior close equity, in whole shares at split-adjusted prices. Weights can drift after entry.',
  'The portfolio starts flat: an engine trade already open on the first day of the window is not taken.',
  'Same-day entries are funded most-liquid-first (20-day average dollar volume through the prior bar).',
  'Proceeds of exits at the open fund same-day entries. Proceeds of intraday exits are available the next day.',
  'Prices are split-adjusted. Dividends are credited gross on the ex-date, with no withholding tax. The benchmark is a total-return buy-and-hold.',
  'Trade P&L, win rate and expectancy include dividends received while the position was held.',
];
const SURVIVORSHIP = 'Survivorship and selection bias apply: the universe is today\'s chosen tickers, and delisted names and past index membership are not available in this data.';

const round = (value: unknown): unknown => {
  if (typeof value === 'number') return Math.round(value * 1e4) / 1e4;
  if (Array.isArray(value)) return value.map(round);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, round(v)]));
  return value;
};

const capped = (warnings: string[]) => warnings.length > MAX_WARNINGS ? [...warnings.slice(0, MAX_WARNINGS), `${warnings.length - MAX_WARNINGS} more data warnings not shown.`] : warnings;

function engineHash(ctx: ToolCtx, origin: string): string {
  if (origin !== 'builtin') return 'private-plugin';
  const hash = crypto.createHash('sha256');
  for (const f of ENGINE_FILES) hash.update(fs.readFileSync(path.join(ctx.cfg.finsightRepo, 'public', f)));
  return hash.digest('hex');
}

type Settings = { years: number; initialCash: number; positionPct: number; maxPositions: number; costBps: number; extraSlippageBps: number; riskFreePct: number; currency: string };
type Strategy = Awaited<ReturnType<typeof listAll>>['strategies'][number];

async function engineCandidates(ctx: ToolCtx, strategy: Strategy, bars: Record<string, Bar[]>) {
  const jobs = Object.keys(bars).map((symbol) => ({ id: strategy.key, symbol, bars: bars[symbol]!.map(({ adj: _adj, ...bar }) => bar) }));
  const engine = await runSandbox<{ results: any[] }>(roots(ctx), { op: 'trades', jobs }, Math.min(110_000, 10_000 + jobs.length * 500), 512);
  const candidates: any[] = [];
  const engineWarnings: string[] = [];
  for (const r of engine.results) {
    if (r.error) { engineWarnings.push(`${r.symbol}: engine error, no trades used (${r.error}).`); continue; }
    for (const t of r.trades) candidates.push({ symbol: r.symbol, ...t });
  }
  return { candidates, engineWarnings };
}

const workerConfig = (s: Settings) => ({ initialCash: s.initialCash, positionPct: s.positionPct, maxPositions: s.maxPositions, costBps: s.costBps, extraSlippageBps: s.extraSlippageBps, riskFreePct: s.riskFreePct });

/** Engines on the bars, then the Python replay. A saved run comes back through here unchanged. */
async function simulate(ctx: ToolCtx, strategy: Strategy, bars: Record<string, Bar[]>, benchmark: { symbol: string; bars: Bar[] }, calendar: string[], s: Settings) {
  const { candidates, engineWarnings } = await engineCandidates(ctx, strategy, bars);
  const replay = await runQuantWorker<Record<string, any>>({ version: 1, calendar, bars, candidates, benchmark, config: workerConfig(s) }, ctx.signal);
  const { ok: _ok, warnings: replayWarnings, strategy: strategyMetrics, benchmark: benchmarkMetrics, excess, ...measured } = replay;
  return {
    figures: { performance: round({ strategy: strategyMetrics, benchmark: benchmarkMetrics, excess }), ...(round(measured) as object) } as Record<string, unknown>,
    replayWarnings: replayWarnings as string[], engineWarnings, candidateTrades: candidates.length,
    hashes: { engineSha256: engineHash(ctx, strategy.origin), workerSha256: workerHash(), candidatesSha256: digest(candidates), resultSha256: digest(replay) },
  };
}

/** The strategy and inputs of a saved run, exactly as they were stored. */
async function rebuild(ctx: ToolCtx, run: SavedRun) {
  const strategy = (await listAll(ctx)).strategies.find((s) => s.key === run.strategyKey);
  if (!strategy) throw new AgentError('NOT_FOUND', `Strategy ${run.strategyKey} no longer exists, so this run cannot be recomputed.`);
  const stored = run.result;
  const benchmark = { symbol: stored.benchmark as string, bars: run.series[`benchmark:${stored.benchmark}`]! };
  const bars = Object.fromEntries(stored.universe.map((symbol: string) => [symbol, run.series[symbol]!])) as Record<string, Bar[]>;
  return { strategy, stored, benchmark, bars, calendar: buildCalendar(stored.settings.years, benchmark.bars, Object.values(bars)) };
}

function runSummary(id: string, createdAt: number, result: Record<string, any>, robustness: Record<string, any> | null) {
  return {
    runId: id, savedAt: new Date(createdAt).toISOString(), strategy: result.strategy, universe: result.universe, benchmarkSymbol: result.benchmark, window: result.window, settings: result.settings,
    cagrPct: result.performance.strategy.cagrPct, sharpe: result.performance.strategy.sharpe, maxDrawdownPct: result.performance.strategy.maxDrawdownPct,
    benchmarkCagrPct: result.performance.benchmark.cagrPct, closedTrades: result.trading.closedTrades, validation: result.validation,
    robustnessChecks: robustness ? robustness.summary : null,
  };
}

/** Verdicts and limits without the per-study tables, so a saved run fits in one tool result. */
function robustnessBrief(robustness: Record<string, any> | null) {
  if (!robustness) return null;
  const { base: _base, time: _time, universe: _universe, cost: _cost, bootstrap: _bootstrap, design: _design, ...brief } = robustness;
  return { ...brief, fullStudy: "Call get_quant_run with detail: 'robustness' for the per-study tables." };
}

/** Saved runs for the Quant Lab. Read from the store, so the tool-result size cap does not apply. */
export function listQuantRuns(db: DB, limit: number) {
  return { validation: VALIDATION, survivorship: SURVIVORSHIP, maxSaved: MAX_SAVED_RUNS, runs: listRuns(db, limit).map((r) => runSummary(r.id, r.createdAt, r.result, r.robustness)) };
}

/** One saved run with its full robustness study, without the stored price series. */
export function readQuantRun(db: DB, id: string) {
  const run = loadRun(db, id);
  return { runId: run.id, savedAt: new Date(run.createdAt).toISOString(), ...run.result, robustness: run.robustness };
}

export const quantTools: ToolDef[] = [
  {
    name: 'backtest_portfolio',
    description: 'Replay one mechanical strategy across several US stocks in a single cash-limited portfolio and compare it with a benchmark on a total-return basis. Returns CAGR, volatility, Sharpe, Sortino, max drawdown, turnover, costs, trade statistics, warnings and provenance. Results are in-sample research on a survivorship-biased universe: always report the warnings, and never present them as a forecast.',
    input: z.object({
      strategy: z.string().min(2).max(60).describe('Strategy id, e.g. matrend. Must be a mechanical strategy that produces trades.'),
      symbols: z.array(z.string().regex(SYMBOL)).min(1).max(50).describe('US-listed tickers, priced in USD.'),
      years: z.number().int().min(1).max(9).default(5).describe('Test window in years, always ending at the last completed bar. A chosen past range such as 2007 to 2009 is not available.'),
      initialCash: z.number().min(1000).max(1e9).default(100_000),
      positionPct: z.number().positive().max(100).default(10).describe('Target size of each new position, as % of equity.'),
      maxPositions: z.number().int().min(1).max(50).default(10),
      costBps: z.number().min(0).max(100).default(10).describe('Commission per side, in basis points.'),
      extraSlippageBps: z.number().min(0).max(100).default(0).describe('Slippage per fill, on top of the engine\'s 5 bps entry slippage.'),
      benchmark: z.string().regex(SYMBOL).default('SPY'),
      riskFreePct: z.number().min(0).max(15).default(0).describe('Annual risk-free rate used in Sharpe and Sortino.'),
    }),
    timeoutMs: 170_000,
    async handler(q, ctx) {
      const strategy = (await listAll(ctx)).strategies.find((s) => s.key === q.strategy.split('@')[0]!.toLowerCase());
      if (!strategy) throw new AgentError('NOT_FOUND', `No strategy ${q.strategy}`);
      if (!strategy.mechanical || strategy.kind !== 'trade') throw new AgentError('BAD_INPUT', `${strategy.key} does not produce trades, so it cannot be replayed.`);

      const now = Date.now();
      const benchmarkSymbol: string = q.benchmark.toUpperCase();
      const symbols = [...new Set<string>(q.symbols.map((s: string) => s.toUpperCase()))];
      const history = await ctx.finsight.get('/api/history/batch', { symbols: [...new Set([...symbols, benchmarkSymbol])].join(','), range: HISTORY_RANGE, interval: '1d' }, ctx.signal);
      const results: Record<string, any> = history.results || {};

      const warnings: string[] = [];
      const bench = cleanSeries(benchmarkSymbol, results[benchmarkSymbol]?.points || [], now);
      if (bench.bars.length < MIN_BARS) throw new AgentError('NO_DATA', `Not enough history for benchmark ${benchmarkSymbol}.`);
      const windowWarning = benchmarkWindowWarning(q.years, bench.bars);
      if (windowWarning) warnings.push(windowWarning);
      warnings.push(...bench.warnings);

      const bars: Record<string, Bar[]> = {};
      for (const symbol of symbols) {
        const row = results[symbol];
        const currency = row?.meta?.currency;
        if (currency && currency !== 'USD') { warnings.push(`${symbol}: excluded, priced in ${currency} and this version is USD only.`); continue; }
        const cleaned = cleanSeries(symbol, row?.points || [], now);
        if (cleaned.bars.length < MIN_BARS) { warnings.push(`${symbol}: excluded, only ${cleaned.bars.length} usable bars.`); continue; }
        warnings.push(...cleaned.warnings);
        bars[symbol] = cleaned.bars;
      }
      const included = Object.keys(bars);
      if (!included.length) throw new AgentError('NO_DATA', 'None of the symbols have enough usable history.');

      const calendar = buildCalendar(q.years, bench.bars, Object.values(bars));
      for (const symbol of included) { const w = warmupWarning(symbol, bars[symbol]!, calendar[0]!); if (w) warnings.push(w); }

      const settings: Settings = { years: q.years, initialCash: q.initialCash, positionPct: q.positionPct, maxPositions: q.maxPositions, costBps: q.costBps, extraSlippageBps: q.extraSlippageBps, riskFreePct: q.riskFreePct, currency: 'USD' };
      const benchmark = { symbol: benchmarkSymbol, bars: bench.bars };
      const { figures, replayWarnings, engineWarnings, candidateTrades, hashes } = await simulate(ctx, strategy, bars, benchmark, calendar, settings);
      const series = { ...bars, [`benchmark:${benchmarkSymbol}`]: bench.bars };
      const result = {
        asOf: new Date(now).toISOString(), source: 'FinSight /api/history/batch + strategy engine + Python replay',
        strategy: strategy.id, status: strategy.status, label: strategy.label, validation: VALIDATION,
        universe: included, benchmark: benchmarkSymbol, window: { start: calendar[0], end: calendar[calendar.length - 1], tradingDays: calendar.length },
        settings,
        ...figures,
        warnings: capped([SURVIVORSHIP, ...replayWarnings, ...warnings, ...engineWarnings]),
        assumptions: ASSUMPTIONS,
        provenance: { datasetSha256: fingerprint(series), ...hashes, candidateTrades },
      };
      return { runId: saveRun(ctx.db, { strategyKey: strategy.key, series, result }), ...result };
    },
  },
  {
    name: 'get_quant_run',
    description: `Read a saved backtest_portfolio run, or list recent runs when runId is omitted. Set reproduce to recompute a run from its stored bars and report whether it still matches. Only the newest ${MAX_SAVED_RUNS} runs are kept. Saved runs are in-sample research: report their warnings, and never present them as a forecast.`,
    input: z.object({
      runId: z.string().min(3).max(40).optional().describe('Run id returned by backtest_portfolio. Omit to list recent runs.'),
      reproduce: z.boolean().default(false).describe('Recompute from the stored bars with the current engine and worker.'),
      detail: z.enum(['run', 'robustness']).default('run').describe('run returns the backtest with the robustness verdicts; robustness returns the full robustness study.'),
      limit: z.number().int().min(1).max(50).default(20).describe('How many runs to list.'),
    }),
    timeoutMs: 170_000,
    async handler(q, ctx) {
      if (!q.runId) {
        if (q.reproduce) throw new AgentError('BAD_INPUT', 'reproduce needs a runId.');
        return { validation: VALIDATION, survivorship: SURVIVORSHIP, runs: listRuns(ctx.db, q.limit).map((r) => runSummary(r.id, r.createdAt, r.result, r.robustness)) };
      }
      const run = loadRun(ctx.db, q.runId);
      const savedAt = new Date(run.createdAt).toISOString();
      if (!q.reproduce && q.detail === 'robustness') return { runId: run.id, savedAt, robustness: run.robustness };
      if (!q.reproduce) return { runId: run.id, savedAt, ...run.result, robustness: robustnessBrief(run.robustness) };

      const { strategy, stored, benchmark, bars, calendar } = await rebuild(ctx, run);
      const current = await simulate(ctx, strategy, bars, benchmark, calendar, stored.settings);
      const was = stored.provenance;
      const changedSections = Object.keys(current.figures).filter((key) => JSON.stringify(current.figures[key]) !== JSON.stringify(stored[key]));
      const candidatesMatch = current.hashes.candidatesSha256 === was.candidatesSha256;
      const resultMatch = current.hashes.resultSha256 === was.resultSha256;
      return {
        runId: run.id, savedAt, strategy: stored.strategy, validation: stored.validation, datasetVerified: true,
        reproduced: candidatesMatch && resultMatch, candidatesMatch, resultMatch, changedSections,
        engineChanged: current.hashes.engineSha256 !== was.engineSha256, workerChanged: current.hashes.workerSha256 !== was.workerSha256,
        stored: { engineSha256: was.engineSha256, workerSha256: was.workerSha256, candidatesSha256: was.candidatesSha256, resultSha256: was.resultSha256 }, current: current.hashes,
      };
    },
  },
  {
    name: 'validate_quant_run',
    description: 'Stress a saved backtest_portfolio run with frozen rules: last-30% and four-period time holdouts, universe halves, removing each symbol, extra costs, and bootstrap intervals. Returns pass, fail or insufficient for six fixed checks. These are robustness checks on history, not out-of-sample proof: always report the limits, never present a pass as approval or a forecast, and never state why a check failed: these checks do not identify causes, and an interval that includes zero is consistent with sampling noise.',
    input: z.object({ runId: z.string().min(3).max(40).describe('Run id returned by backtest_portfolio.') }),
    timeoutMs: 170_000,
    async handler(q, ctx) {
      const run = loadRun(ctx.db, q.runId);
      const { strategy, stored, benchmark, bars, calendar } = await rebuild(ctx, run);
      const { candidates } = await engineCandidates(ctx, strategy, bars);
      if (digest(candidates) !== stored.provenance.candidatesSha256) throw new AgentError('QUANT_ENGINE_CHANGED', 'The strategy engine no longer produces this run\'s trades. Run a new backtest and validate that.');
      const { ok: _ok, ...study } = await runQuantWorker<Record<string, any>>({ version: 1, op: 'validate', calendar, bars, candidates, benchmark, config: workerConfig(stored.settings) }, ctx.signal, ROBUSTNESS_MS);
      const figures = round(study) as Record<string, any>;
      const summary = { pass: 0, fail: 0, insufficient: 0 } as Record<string, number>;
      for (const check of figures.checks) summary[check.status]!++;
      const baseMatchesRun = figures.base.cagrPct === stored.performance.strategy.cagrPct && figures.base.benchmarkCagrPct === stored.performance.benchmark.cagrPct;
      const robustness = {
        validatedAt: new Date().toISOString(), strategy: stored.strategy, status: stored.status, label: ROBUSTNESS_LABEL, summary, ...figures, baseMatchesRun,
        warnings: [SURVIVORSHIP], limits: ROBUSTNESS_LIMITS,
        provenance: { datasetSha256: stored.provenance.datasetSha256, engineSha256: engineHash(ctx, strategy.origin), workerSha256: workerHash(), candidatesSha256: digest(candidates), studySha256: digest(study) },
      };
      saveRobustness(ctx.db, run.id, robustness);
      return { runId: run.id, ...robustness };
    },
  },
];
