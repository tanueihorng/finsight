// Quant Lab (FEAT-014): wire types and the logic behind the views. Every figure
// shown comes from the Python worker through the saved run. This file only
// formats, orders and places those figures; it derives no new performance number.

export type CheckStatus = 'pass' | 'fail' | 'insufficient';
export type CheckId = 'time_holdout' | 'time_consistency' | 'universe_halves' | 'single_name_dependence' | 'cost_stress' | 'bootstrap_excess';
export interface Settings { years: number; initialCash: number; positionPct: number; maxPositions: number; costBps: number; extraSlippageBps: number; riskFreePct: number; currency: string }
export interface Window { start: string; end: string; tradingDays: number }
export interface Summary { pass: number; fail: number; insufficient: number }
export interface RunSummary {
  runId: string; savedAt: string; strategy: string; universe: string[]; benchmarkSymbol: string; window: Window; settings: Settings;
  cagrPct: number | null; sharpe: number | null; maxDrawdownPct: number | null; benchmarkCagrPct: number | null; closedTrades: number; validation: string; robustnessChecks: Summary | null;
}
export interface RunList { validation: string; survivorship: string; maxSaved: number; runs: RunSummary[] }
export interface StudyRow { start: string; end: string; tradingDays: number; cagrPct: number | null; benchmarkCagrPct: number | null; excessCagrPct: number | null; sharpe: number | null; benchmarkSharpe: number | null; maxDrawdownPct: number | null; trades: number }
export type HalfRow = StudyRow & { symbols: string[]; positionPct: number };
export type RemovalRow = StudyRow & { removed: string; positionPct: number };
export type CostRow = StudyRow & { extraBpsPerSide: number };
export type Interval = [number, number] | null;
export interface Robustness {
  validatedAt: string; label: string; summary: Summary; base: StudyRow; checks: { id: CheckId; status: CheckStatus; detail: string }[];
  time: { development: StudyRow | null; holdout: StudyRow | null; periods: (StudyRow | null)[] };
  universe: { halves: HalfRow[]; removals: RemovalRow[] };
  cost: { grid: CostRow[]; survivesExtraBpsPerSide: number | null };
  bootstrap: { confidencePct: number; resamples: number; expectedBlockDays: number; intervals: { cagrPct: Interval; excessCagrPct: Interval; sharpe: Interval; maxDrawdownPct: Interval; shareOfResamplesAboveBenchmarkPct: number } };
  design: { holdoutPercent: number; periods: number; periodsToPass: number; minDays: number; minTrades: number; costStressBps: number };
  baseMatchesRun: boolean; warnings: string[]; limits: string[]; provenance: Record<string, string>;
}
export interface Perf { totalReturnPct: number | null; cagrPct: number | null; volatilityPct: number | null; sharpe: number | null; sortino: number | null; maxDrawdownPct: number | null; maxDrawdownPeak?: string | null; maxDrawdownTrough?: string | null; longestUnderwaterDays?: number | null }
export interface EquityPoint { date: string; strategy: number; benchmark: number }
export interface Position { symbol: string; entryDate: string; shares: number; entryPx: number; markPx: number; unrealizedPnl: number }
export interface Fill { date: string; symbol: string; side: 'buy' | 'sell'; shares: number; px: number; fee: number; why: string }
export interface Run {
  runId: string; savedAt: string; asOf: string; source: string; strategy: string; status: string; label: string; validation: string; universe: string[]; benchmark: string; window: Window; settings: Settings;
  performance: { strategy: Perf; benchmark: Perf; excess: { totalReturnPct: number | null; cagrPct: number | null } };
  trading: { closedTrades: number; openTrades: number; winRatePct: number | null; expectancyPct: number | null; profitFactor: number | null; averageHoldCalendarDays: number | null };
  activity: { annualTurnover: number | null; totalCosts: number; dividendsReceived: number; averageExposurePct: number | null; averagePositions: number | null; largestPositionWeightPct: number | null };
  rejected: Record<string, number>; reducedEntries: number; openPositions: Position[]; monthlyEquity: EquityPoint[]; recentFills: Fill[]; reconciled: boolean; warnings: string[]; assumptions: string[]; provenance: Record<string, string | number>;
  robustness: Robustness | null;
}
export interface Strategy { id: string; key: string; name: string; mechanical: boolean; kind: string; status: string }
export interface Reproduced { reproduced: boolean; candidatesMatch: boolean; resultMatch: boolean; changedSections: string[]; engineChanged: boolean; workerChanged: boolean }

// ---- formatting ----------------------------------------------------------------------
const MINUS = '−';
const num = (v: number, d: number) => Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
export const pct = (v: number | null | undefined, d = 2) => v == null ? '—' : `${v < 0 ? MINUS : ''}${num(v, d)}%`;
export const signed = (v: number | null | undefined, d = 1) => v == null ? '—' : `${v > 0 ? '+' : v < 0 ? MINUS : ''}${num(v, d)}`;
export const pts = (v: number | null | undefined, d = 1) => v == null ? '—' : `${signed(v, d)} pts`;
export const dollars = (v: number | null | undefined) => v == null ? '—' : `${v < 0 ? MINUS : ''}$${num(v, 0)}`;
export const plain = (v: number | null | undefined, d = 2) => v == null ? '—' : `${v < 0 ? MINUS : ''}${num(v, d)}`;
export const tone = (v: number | null | undefined): 'up' | 'down' | '' => v == null || v === 0 ? '' : v > 0 ? 'up' : 'down';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const monthYear = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
export const shortDate = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
export function savedLabel(iso: string, now = Date.now()) {
  const mins = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return shortDate(iso.slice(0, 10));
}
export const strategyLabel = (id: string, names: Record<string, string> = {}) => names[id.split('@')[0]!] ?? id.split('@')[0]!;
export const universeLabel = (u: string[]) => `${u.length} ${u.length === 1 ? 'stock' : 'stocks'}`;
export const windowYears = (s: Settings) => `${s.years}y`;
export function checksLabel(s: Summary | null) {
  if (!s) return 'Not checked';
  return `${s.pass}/${s.pass + s.fail + s.insufficient} passed`;
}

// ---- the six checks ------------------------------------------------------------------
export const CHECK_ORDER: CheckId[] = ['time_holdout', 'time_consistency', 'universe_halves', 'single_name_dependence', 'cost_stress', 'bootstrap_excess'];
export const CHECK_NAME: Record<CheckId, string> = {
  time_holdout: 'Recent period beat the benchmark', time_consistency: 'Beat it across periods', universe_halves: 'Both halves of the stocks beat it',
  single_name_dependence: 'No single stock carries it', cost_stress: 'Survives higher costs', bootstrap_excess: 'Lead is clear of zero',
};
export const CHECK_SHORT: Record<CheckId, string> = { time_holdout: 'Recent', time_consistency: 'Periods', universe_halves: 'Halves', single_name_dependence: 'One stock', cost_stress: 'Cost', bootstrap_excess: 'Interval' };
export const STATUS_LABEL: Record<CheckStatus, string> = { pass: 'PASS', fail: 'FAIL', insufficient: 'TOO LITTLE DATA' };
export const STATUS_SHORT: Record<CheckStatus, string> = { pass: 'PASS', fail: 'FAIL', insufficient: 'TOO FEW' };
export const statusOf = (r: Robustness, id: CheckId): CheckStatus => r.checks.find((c) => c.id === id)?.status ?? 'insufficient';

export interface CheckEvidence { id: CheckId; name: string; status: CheckStatus; value: string; detail: string; rule: string }
export function checkEvidence(r: Robustness, benchmark: string): CheckEvidence[] {
  const { holdout, periods } = r.time, { halves, removals } = r.universe;
  const stress = r.cost.grid.find((row) => row.extraBpsPerSide === r.design.costStressBps);
  const interval = r.bootstrap.intervals.excessCagrPct;
  const beat = periods.filter((p) => p != null && p.excessCagrPct != null && p.excessCagrPct > 0).length;
  const worst = worstRemoval(r);
  const behind = removals.filter((row) => row.excessCagrPct == null || row.excessCagrPct <= 0).length;
  const facts: Record<CheckId, { value: string; detail: string }> = {
    time_holdout: { value: pts(holdout?.excessCagrPct), detail: holdout ? `${pct(holdout.cagrPct, 1)} a year vs ${benchmark} ${pct(holdout.benchmarkCagrPct, 1)}. ${holdout.tradingDays} days, ${holdout.trades} trades.` : 'Window too short to split.' },
    time_consistency: { value: `${beat} of ${periods.length}`, detail: `${periods.map((p) => signed(p?.excessCagrPct)).join(', ')} pts by period, oldest first.` },
    universe_halves: { value: halves.map((h) => signed(h.excessCagrPct)).join(' / ') + ' pts', detail: `${halves.map((h) => h.trades).join(' and ')} trades in the two halves.` },
    single_name_dependence: { value: worst ? `${worst.removed}: ${signed(worst.excessCagrPct)} pts` : '—', detail: worst ? (behind ? `${behind} of ${removals.length} removals ${behind === 1 ? 'falls' : 'fall'} behind ${benchmark}. Worst shown.` : `Ahead of ${benchmark} with any one stock removed. Worst shown.`) : 'Too few stocks to test.' },
    cost_stress: { value: pts(stress?.excessCagrPct), detail: r.cost.survivesExtraBpsPerSide == null ? `Behind ${benchmark} before any extra cost.` : `Ahead of ${benchmark} up to +${r.cost.survivesExtraBpsPerSide} bps per side.` },
    bootstrap_excess: { value: interval ? `${signed(interval[0])} to ${signed(interval[1])}` : '—', detail: `${r.bootstrap.confidencePct}% interval for the yearly lead over ${benchmark}, in points.` },
  };
  return CHECK_ORDER.map((id) => ({ id, name: CHECK_NAME[id], status: statusOf(r, id), rule: r.checks.find((c) => c.id === id)?.detail ?? '', ...facts[id] }));
}
export function worstRemoval(r: Robustness): RemovalRow | null {
  let out: RemovalRow | null = null;
  for (const row of r.universe.removals) if (!out || (row.excessCagrPct ?? -Infinity) < (out.excessCagrPct ?? -Infinity)) out = row;
  return out;
}
// Says what happened and never why: the checks do not identify causes.
export function verdictLine(r: Robustness) {
  const failed = r.checks.filter((c) => c.status === 'fail').map((c) => CHECK_NAME[c.id].toLowerCase());
  const { fail, insufficient } = r.summary, parts: string[] = [];
  if (fail) parts.push(`Not met: ${failed.join('; ')}.`);
  if (insufficient) parts.push(`${insufficient} had too little data to judge.`);
  return parts.join(' ') || 'Every check was met. That shows stability on this history, not a forecast.';
}

// ---- plain-English view --------------------------------------------------------------
export type AnswerTone = 'good' | 'bad' | 'unclear';
export interface Answer { checks: CheckId[]; question: string; answer: string; tone: AnswerTone; text: string }
const combine = (statuses: CheckStatus[]): 'pass' | 'fail' | 'unclear' => statuses.includes('fail') ? 'fail' : statuses.every((s) => s === 'pass') ? 'pass' : 'unclear';

export function answers(run: Run, r: Robustness): Answer[] {
  const b = run.benchmark, perf = run.performance, holdout = r.time.holdout, worst = worstRemoval(r);
  const interval = r.bootstrap.intervals.excessCagrPct;
  const lead = perf.excess.cagrPct, ahead = lead != null && lead > 0;
  // A strategy already behind has no lead for these questions to test.
  const reply = (status: 'pass' | 'fail' | 'unclear' | CheckStatus, pass: string, fail: string): Pick<Answer, 'answer' | 'tone'> =>
    status === 'pass' ? { answer: pass, tone: 'good' } : status !== 'fail' ? { answer: 'Too little data', tone: 'unclear' } : lead != null && lead <= 0 ? { answer: 'No lead to test', tone: 'unclear' } : { answer: fail, tone: 'bad' };
  const later = combine([statusOf(r, 'time_holdout'), statusOf(r, 'time_consistency')]);
  const narrow = combine([statusOf(r, 'universe_halves'), statusOf(r, 'single_name_dependence')]);
  const cost = statusOf(r, 'cost_stress'), luck = statusOf(r, 'bootstrap_excess');
  const beat = r.time.periods.filter((p) => p != null && p.excessCagrPct != null && p.excessCagrPct > 0).length;
  const survives = r.cost.survivesExtraBpsPerSide;
  return [
    { checks: [], question: `Did it beat ${b} over the whole window?`, answer: lead == null ? 'Too little data' : ahead ? 'Yes' : 'No', tone: lead == null ? 'unclear' : ahead ? 'good' : 'bad',
      text: `${pct(perf.strategy.cagrPct)} a year against ${pct(perf.benchmark.cagrPct)}, with a worst drop of ${pct(perf.strategy.maxDrawdownPct, 1)} against ${pct(perf.benchmark.maxDrawdownPct, 1)}.` },
    { checks: ['time_holdout', 'time_consistency'], question: `Did it keep beating ${b} later on?`, answer: later === 'pass' ? 'Yes' : later === 'fail' ? 'No' : 'Too little data', tone: later === 'pass' ? 'good' : later === 'fail' ? 'bad' : 'unclear',
      text: `${holdout ? `The last ${r.design.holdoutPercent}% of the window made ${pct(holdout.cagrPct, 1)} a year against ${pct(holdout.benchmarkCagrPct, 1)}.` : 'The window was too short to split.'} ${beat} of ${r.time.periods.length} equal periods beat ${b}.` },
    { checks: ['universe_halves', 'single_name_dependence'], question: 'Does it depend on a few stocks?', ...reply(narrow, 'No', 'Yes'),
      text: `${worst ? `The weakest result is without ${worst.removed}: ${pts(worst.excessCagrPct)} a year against ${b}. ` : ''}The two halves of the stocks came in at ${r.universe.halves.map((h) => pts(h.excessCagrPct)).join(' and ')}.` },
    { checks: ['cost_stress'], question: 'Would higher trading costs wipe it out?', ...reply(cost, 'No', 'Yes'),
      text: survives == null ? `It is behind ${b} before any extra cost.` : `It stays ahead of ${b} with up to ${survives} basis points of extra cost per side.` },
    { checks: ['bootstrap_excess'], question: 'Could the result be chance?', ...reply(luck, 'Less likely', 'Cannot rule it out'),
      text: `The ${r.bootstrap.confidencePct}% interval for the yearly lead over ${b} runs from ${signed(interval?.[0])} to ${signed(interval?.[1])} points${interval && interval[0] <= 0 && interval[1] >= 0 ? ', which includes zero' : ''}. ${pct(r.bootstrap.intervals.shareOfResamplesAboveBenchmarkPct, 1)} of resamples ended ahead, which is descriptive and not a p-value.` },
  ];
}

// ---- chart and bar geometry ----------------------------------------------------------
export interface Tick { label: string; at: number }
export interface Chart { strategy: string; benchmark: string; x: number[]; y: (v: number) => number; yTicks: Tick[]; xTicks: Tick[]; holdoutX: number | null; plot: { left: number; right: number; top: number; bottom: number } }
const STEPS = [1, 2, 2.5, 5, 10];
export function niceStep(span: number, ticks = 4) {
  const raw = span / ticks, mag = 10 ** Math.floor(Math.log10(raw || 1));
  return (STEPS.find((s) => s * mag >= raw) ?? 10) * mag;
}
export const moneyTick = (v: number) => v >= 1e6 ? `$${(v / 1e6).toFixed(v % 1e6 ? 1 : 0)}M` : `$${Math.round(v / 1000)}k`;

export function equityChart(points: EquityPoint[], width: number, height: number, holdoutStart: string | null = null): Chart {
  const plot = { left: 46, right: width - 8, top: 8, bottom: height - 20 };
  const values = points.flatMap((p) => [p.strategy, p.benchmark]);
  const lo = Math.min(...values), hi = Math.max(...values), step = niceStep(hi - lo || 1);
  const min = Math.floor(lo / step) * step, max = Math.ceil(hi / step) * step || 1;
  const n = points.length, inner = plot.right - plot.left;
  const x = points.map((_, i) => plot.left + (n > 1 ? i / (n - 1) * inner : inner / 2));
  const y = (v: number) => plot.bottom - (v - min) / ((max - min) || 1) * (plot.bottom - plot.top);
  const line = (key: 'strategy' | 'benchmark') => points.map((p, i) => `${i ? 'L' : 'M'}${x[i]!.toFixed(1)} ${y(p[key]).toFixed(1)}`).join('');
  const yTicks: Tick[] = [];
  for (let v = min; v <= max + step / 2; v += step) yTicks.push({ label: moneyTick(v), at: y(v) });
  const every = Math.max(1, Math.round(n / Math.max(2, Math.floor(inner / 90))));
  const xTicks: Tick[] = [];
  for (let i = 0; i < n; i += every) if (x[i]! < plot.right - 24) xTicks.push({ label: monthYear(points[i]!.date), at: x[i]! });
  const split = holdoutStart == null ? -1 : points.findIndex((p) => p.date >= holdoutStart);
  return { strategy: line('strategy'), benchmark: line('benchmark'), x, y, yTicks, xTicks, plot, holdoutX: split < 0 ? null : x[split]! };
}
export function nearestIndex(xs: number[], px: number) {
  let best = 0;
  xs.forEach((x, i) => { if (Math.abs(x - px) < Math.abs(xs[best]! - px)) best = i; });
  return best;
}
export interface Bar { left: number; width: number; zero: number }
export function scaleFor(values: (number | null | undefined)[]): [number, number] {
  const known = values.filter((v): v is number => v != null && Number.isFinite(v));
  const lo = Math.min(0, ...known), hi = Math.max(0, ...known), pad = (hi - lo || 1) * .06;
  return [lo < 0 ? lo - pad : 0, hi > 0 ? hi + pad : 0];
}
export const clampPct = (v: number) => Math.min(100, Math.max(0, v));
export const place = (v: number, [lo, hi]: [number, number]) => clampPct((v - lo) / ((hi - lo) || 1) * 100);
export function bar(v: number | null | undefined, scale: [number, number]): Bar {
  const zero = place(0, scale);
  if (v == null || !Number.isFinite(v)) return { left: zero, width: 0, zero };
  const end = place(v, scale);
  return { left: Math.min(zero, end), width: Math.abs(end - zero), zero };
}

// ---- comparing runs ------------------------------------------------------------------
export const COMPARE_MAX = 8;
const studyKey = (r: RunSummary) => JSON.stringify([[...r.universe].sort(), r.benchmarkSymbol, r.window.start, r.window.end, r.settings]);
// Only runs of the same test belong side by side: the same stocks, window and
// settings. The newest run of each strategy stands for it.
export function comparable(runs: RunSummary[], selected: RunSummary | null): { rows: RunSummary[]; hidden: number } {
  if (!selected) return { rows: [], hidden: 0 };
  const key = studyKey(selected), seen = new Set<string>(), rows: RunSummary[] = [];
  const same = runs.filter((r) => studyKey(r) === key);
  for (const r of same) {
    if (seen.has(r.strategy) && r.runId !== selected.runId) continue;
    if (seen.has(r.strategy)) { const at = rows.findIndex((x) => x.strategy === r.strategy); rows[at] = r; continue; }
    seen.add(r.strategy); rows.push(r);
  }
  return { rows: rows.slice(0, COMPARE_MAX), hidden: runs.length - Math.min(rows.length, COMPARE_MAX) };
}
export const passedCount = (r: Run | undefined) => r?.robustness?.summary.pass ?? -1;
// Sorted by evidence, never by return, so the table does not reward the luckiest number.
export const compareOrder = (runs: Run[], names: Record<string, string> = {}) =>
  [...runs].sort((a, b) => passedCount(b) - passedCount(a) || strategyLabel(a.strategy, names).localeCompare(strategyLabel(b.strategy, names)));

// ---- new-run form --------------------------------------------------------------------
export interface Form { strategy: string; symbols: string; years: string; positionPct: string; maxPositions: string; costBps: string; extraSlippageBps: string; initialCash: string; benchmark: string; riskFreePct: string }
export const EXAMPLE_SYMBOLS = 'AAPL, MSFT, NVDA, GOOGL, AMZN, META, JPM, XOM, UNH, HD, KO, BRK-B, TSLA';
export const emptyForm = (strategy = ''): Form => ({ strategy, symbols: '', years: '5', positionPct: '10', maxPositions: '10', costBps: '10', extraSlippageBps: '0', initialCash: '100000', benchmark: 'SPY', riskFreePct: '0' });
const SYMBOL = /^[A-Z0-9.-]{1,12}$/;
export function parseSymbols(text: string) {
  const all = [...new Set(text.toUpperCase().split(/[\s,;]+/).filter(Boolean))];
  return { symbols: all.filter((s) => SYMBOL.test(s)), bad: all.filter((s) => !SYMBOL.test(s)) };
}
export type FormErrors = Partial<Record<keyof Form, string>>;
export interface BacktestBody { strategy: string; symbols: string[]; years: number; positionPct: number; maxPositions: number; costBps: number; extraSlippageBps: number; initialCash: number; benchmark: string; riskFreePct: number }
export function checkForm(f: Form): { body: BacktestBody } | { errors: FormErrors } {
  const errors: FormErrors = {};
  const { symbols, bad } = parseSymbols(f.symbols);
  if (!f.strategy) errors.strategy = 'Choose a strategy.';
  if (bad.length) errors.symbols = `Not a ticker: ${bad.slice(0, 3).join(', ')}.`;
  else if (!symbols.length) errors.symbols = 'Add at least one ticker.';
  else if (symbols.length > 50) errors.symbols = `Use 50 tickers or fewer (you have ${symbols.length}).`;
  const read = (key: keyof Form, label: string, lo: number, hi: number, opts: { whole?: boolean; above?: boolean } = {}) => {
    const v = Number(f[key].replace(/,/g, ''));
    const range = opts.above ? `above ${lo} and up to ${hi}` : `from ${lo.toLocaleString('en-US')} to ${hi.toLocaleString('en-US')}`;
    if (f[key].trim() === '' || !Number.isFinite(v) || v > hi || (opts.above ? v <= lo : v < lo) || (opts.whole && !Number.isInteger(v))) errors[key] = `${label}: enter ${opts.whole ? 'a whole number ' : 'a number '}${range}.`;
    return v;
  };
  const years = read('years', 'Years', 1, 9, { whole: true });
  const positionPct = read('positionPct', 'Position size', 0, 100, { above: true });
  const maxPositions = read('maxPositions', 'Max positions', 1, 50, { whole: true });
  const costBps = read('costBps', 'Commission', 0, 100);
  const extraSlippageBps = read('extraSlippageBps', 'Extra slippage', 0, 100);
  const initialCash = read('initialCash', 'Starting cash', 1000, 1e9);
  const riskFreePct = read('riskFreePct', 'Risk-free rate', 0, 15);
  const benchmark = f.benchmark.trim().toUpperCase();
  if (!SYMBOL.test(benchmark)) errors.benchmark = 'Enter one ticker, such as SPY.';
  if (Object.keys(errors).length) return { errors };
  return { body: { strategy: f.strategy, symbols, years, positionPct, maxPositions, costBps, extraSlippageBps, initialCash, benchmark, riskFreePct } };
}

export const TABS = [['overview', 'Overview'], ['evidence', 'Evidence'], ['compare', 'Compare'], ['explain', 'Plain English'], ['details', 'Details']] as const;
export type Tab = (typeof TABS)[number][0];
export const isTab = (v: unknown): v is Tab => TABS.some(([id]) => id === v);
export function nextTab(current: Tab, key: string): Tab | null {
  const ids = TABS.map(([id]) => id), at = ids.indexOf(current);
  if (key === 'ArrowRight') return ids[(at + 1) % ids.length]!;
  if (key === 'ArrowLeft') return ids[(at - 1 + ids.length) % ids.length]!;
  if (key === 'Home') return ids[0]!;
  if (key === 'End') return ids[ids.length - 1]!;
  return null;
}

export const GLOSSARY: [string, string][] = [
  ['CAGR', 'The steady yearly growth rate that would turn the starting value into the ending value.'],
  ['Pts', 'Percentage points of yearly return above or below the benchmark.'],
  ['Sharpe', 'Return per unit of day-to-day volatility. Higher is steadier.'],
  ['Max drawdown', 'The largest fall from a peak to a later low.'],
  ['Holdout', 'The last part of the window, reported on its own. The rules are the same; nothing is re-fitted.'],
  ['Bps', 'Basis points. 100 bps is 1%.'],
  ['Interval', 'The range of results from resampling days of this run. It covers sampling noise only.'],
  ['Survivorship bias', "Testing today's tickers leaves out companies that failed or were delisted, which flatters results."],
];
export const equityCsv = (run: Run) => [['Date', run.strategy, run.benchmark], ...run.monthlyEquity.map((p) => [p.date, p.strategy, p.benchmark])];
