import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answers, bar, checkEvidence, checkForm, comparable, compareOrder, emptyForm, equityChart, isTab, nearestIndex, nextTab, parseSymbols, pct, pts, savedLabel, scaleFor, signed, verdictLine, worstRemoval, type EquityPoint, type Robustness, type Run, type RunSummary, type StudyRow } from './quant.ts';

const row = (excess: number | null, extra: Partial<StudyRow> = {}): StudyRow => ({ start: '2024-01-02', end: '2024-06-28', tradingDays: 200, cagrPct: 10, benchmarkCagrPct: 8, excessCagrPct: excess, sharpe: 1, benchmarkSharpe: 1, maxDrawdownPct: -10, trades: 40, ...extra });
const study = (statuses: Partial<Record<string, 'pass' | 'fail' | 'insufficient'>> = {}): Robustness => {
  const ids = ['time_holdout', 'time_consistency', 'universe_halves', 'single_name_dependence', 'cost_stress', 'bootstrap_excess'] as const;
  const checks = ids.map((id) => ({ id, status: statuses[id] ?? 'fail' as const, detail: `Rule ${id}` }));
  const summary = { pass: 0, fail: 0, insufficient: 0 };
  checks.forEach((c) => summary[c.status]++);
  return {
    validatedAt: '', label: 'label', summary, base: row(1), checks,
    time: { development: row(14), holdout: row(-10.8), periods: [row(11), row(29.9), row(-3.1), row(-8)] },
    universe: { halves: [{ ...row(5.2), symbols: ['A'], positionPct: 10 }, { ...row(-2.4), symbols: ['B'], positionPct: 10 }], removals: [{ ...row(5), removed: 'AAPL', positionPct: 10 }, { ...row(-1.6), removed: 'NVDA', positionPct: 10 }] },
    cost: { grid: [{ ...row(6.7), extraBpsPerSide: 0 }, { ...row(5.8), extraBpsPerSide: 25 }], survivesExtraBpsPerSide: 25 },
    bootstrap: { confidencePct: 95, resamples: 2000, expectedBlockDays: 21, intervals: { cagrPct: [1, 2], excessCagrPct: [-5.9, 19.9], sharpe: [0, 1], maxDrawdownPct: [-30, -10], shareOfResamplesAboveBenchmarkPct: 84.75 } },
    design: { holdoutPercent: 30, periods: 4, periodsToPass: 3, minDays: 126, minTrades: 30, costStressBps: 25 },
    baseMatchesRun: true, warnings: [], limits: [], provenance: {},
  };
};
const run = (r: Robustness | null, strategy = 'matrend@1.0.0', excess = 6.7) => ({ runId: strategy, strategy, benchmark: 'SPY', performance: { strategy: { cagrPct: 18.19, maxDrawdownPct: -15.7 }, benchmark: { cagrPct: 11.48, maxDrawdownPct: -24.5 }, excess: { cagrPct: excess } }, robustness: r } as unknown as Run);
const summary = (id: string, strategy: string, extra: Partial<RunSummary> = {}) => ({ runId: id, strategy, universe: ['B', 'A'], benchmarkSymbol: 'SPY', window: { start: 'a', end: 'b', tradingDays: 2 }, settings: { years: 5 }, ...extra } as unknown as RunSummary);

test('numbers keep their sign, use a real minus and show gaps as a dash', () => {
  assert.equal(pct(-1.676), '−1.68%');
  assert.equal(pct(18.1868), '18.19%');
  assert.equal(pts(6.7047, 2), '+6.70 pts');
  assert.equal(pts(-10.82), '−10.8 pts');
  assert.equal(signed(0), '0.0');
  for (const f of [pct, pts, signed]) assert.equal(f(null), '—');
});

test('each check reads its evidence from its own study', () => {
  const cards = checkEvidence(study({ cost_stress: 'pass' }), 'SPY');
  const by = Object.fromEntries(cards.map((c) => [c.id, c]));
  assert.equal(cards.length, 6);
  assert.equal(by.time_holdout!.value, '−10.8 pts');
  assert.equal(by.time_consistency!.value, '2 of 4');
  assert.equal(by.universe_halves!.value, '+5.2 / −2.4 pts');
  assert.equal(by.single_name_dependence!.value, 'NVDA: −1.6 pts');
  assert.match(by.single_name_dependence!.detail, /^1 of 2 removals falls behind SPY/);
  assert.equal(by.cost_stress!.value, '+5.8 pts');
  assert.equal(by.cost_stress!.status, 'pass');
  assert.equal(by.bootstrap_excess!.value, '−5.9 to +19.9');
});

test('the worst removal treats a missing result as the worst', () => {
  const r = study();
  r.universe.removals.push({ ...row(null), removed: 'X', positionPct: 10 });
  assert.equal(worstRemoval(r)!.removed, 'X');
});

test('the verdict lists what was not met, never why', () => {
  const failing = verdictLine(study({ cost_stress: 'pass', bootstrap_excess: 'insufficient' }));
  assert.match(failing, /^Not met: recent period/);
  assert.match(failing, /1 had too little data/);
  assert.doesNotMatch(failing, /because|due to|caused/i);
  const all = Object.fromEntries(['time_holdout', 'time_consistency', 'universe_halves', 'single_name_dependence', 'cost_stress', 'bootstrap_excess'].map((id) => [id, 'pass' as const]));
  assert.match(verdictLine(study(all)), /not a forecast/);
});

test('plain-English answers follow the check statuses, including mixed and thin evidence', () => {
  const a = answers(run(study({ cost_stress: 'pass' })), study({ cost_stress: 'pass' }));
  assert.deepEqual(a.map((x) => x.answer), ['Yes', 'No', 'Yes', 'No', 'Cannot rule it out']);
  assert.deepEqual(a.map((x) => x.tone), ['good', 'bad', 'bad', 'good', 'bad']);
  assert.match(a[4]!.text, /includes zero/);
  const thin = study({ time_holdout: 'insufficient', time_consistency: 'pass' });
  assert.equal(answers(run(thin), thin)[1]!.answer, 'Too little data');
  const oneFails = study({ time_holdout: 'insufficient', time_consistency: 'fail' });
  assert.equal(answers(run(oneFails), oneFails)[1]!.answer, 'No', 'a failure outranks missing data');
  const behind = study();
  assert.equal(answers(run(behind, 'x@1', -3), behind)[0]!.answer, 'No');
  const clear = study({ bootstrap_excess: 'pass' }); clear.bootstrap.intervals.excessCagrPct = [1, 5];
  assert.doesNotMatch(answers(run(clear), clear)[4]!.text, /includes zero/);
});

test('a strategy already behind is not told that costs or luck took its lead', () => {
  const r = study();
  r.cost.survivesExtraBpsPerSide = null;
  const a = answers(run(r, 'x@1', -8), r);
  assert.deepEqual(a.map((x) => x.answer), ['No', 'No', 'No lead to test', 'No lead to test', 'No lead to test']);
  assert.match(a[3]!.text, /behind SPY before any extra cost/);
  assert.match(checkEvidence(r, 'SPY').find((c) => c.id === 'cost_stress')!.detail, /before any extra cost/);
  assert.equal(answers(run(r, 'x@1', null as unknown as number), r)[0]!.answer, 'Too little data', 'a missing lead is not a loss');
  const short = study(); short.time.holdout = null;
  assert.match(answers(run(short), short)[1]!.text, /too short to split/);
});

test('chart geometry maps values into the plot and marks the holdout at its first month', () => {
  const points: EquityPoint[] = [{ date: '2024-01-31', strategy: 100000, benchmark: 100000 }, { date: '2024-02-29', strategy: 120000, benchmark: 90000 }, { date: '2024-03-29', strategy: 150000, benchmark: 110000 }];
  const c = equityChart(points, 600, 200, '2024-02-15');
  assert.equal(c.x[0], c.plot.left);
  assert.equal(c.x[2], c.plot.right);
  assert.equal(c.holdoutX, c.x[1]);
  assert.ok(c.y(150000) < c.y(90000), 'higher values sit higher');
  for (const v of [90000, 150000]) assert.ok(c.y(v) >= c.plot.top && c.y(v) <= c.plot.bottom);
  assert.equal(equityChart(points, 600, 200).holdoutX, null);
  assert.equal(equityChart(points, 600, 200, '2030-01-01').holdoutX, null);
  assert.ok(equityChart(points, 600, 200).xTicks.every((t) => t.at < 592 - 24 + 1), 'the last label is not cut off');
  assert.equal(nearestIndex(c.x, c.x[1]! + 1), 1);
});

test('a flat series still draws finite coordinates', () => {
  const c = equityChart([{ date: '2024-01-31', strategy: 100, benchmark: 100 }, { date: '2024-02-29', strategy: 100, benchmark: 100 }], 300, 100);
  assert.doesNotMatch(c.strategy, /NaN|Infinity/);
});

test('bars start at zero and stay inside the track', () => {
  const scale = scaleFor([-10, 30]);
  const down = bar(-10, scale), up = bar(30, scale);
  assert.ok(down.left + down.width <= down.zero + 1e-9);
  assert.ok(Math.abs(up.left - up.zero) < 1e-9);
  assert.ok(up.left + up.width <= 100);
  assert.deepEqual(bar(null, scale).width, 0);
  assert.deepEqual(scaleFor([]), [0, 0]);
  assert.equal(bar(1e9, scale).left + bar(1e9, scale).width, 100, 'an outlier is clamped');
});

test('compare keeps the newest run of each strategy for one identical test', () => {
  const runs = [summary('3', 'a@1'), summary('2', 'a@1'), summary('1', 'b@1', { universe: ['A', 'B'] }), summary('0', 'c@1', { settings: { years: 3 } as RunSummary['settings'] })];
  const out = comparable(runs, runs[0]!);
  assert.deepEqual(out.rows.map((r) => r.runId), ['3', '1']);
  assert.equal(out.hidden, 2);
  assert.deepEqual(comparable(runs, runs[1]!).rows.map((r) => r.runId), ['2', '1'], 'the selected run stands for its strategy');
  assert.deepEqual(comparable(runs, null), { rows: [], hidden: 0 });
});

test('compare order is by checks passed, then name, whatever the returns', () => {
  const a = run(study(), 'zeta@1', 50), b = run(study({ cost_stress: 'pass' }), 'alpha@1', -5), c = run(null, 'beta@1', 90), d = run(study(), 'beta@2', 1);
  assert.deepEqual(compareOrder([a, c, d, b]).map((r) => r.strategy), ['alpha@1', 'beta@2', 'zeta@1', 'beta@1']);
});

test('symbols are parsed forgivingly and bad ones are named', () => {
  assert.deepEqual(parseSymbols(' aapl, MSFT;brk-b\nAAPL  '), { symbols: ['AAPL', 'MSFT', 'BRK-B'], bad: [] });
  assert.deepEqual(parseSymbols('AA$PL').bad, ['AA$PL']);
});

test('the form matches the tool limits and names each problem', () => {
  const ok = { ...emptyForm('matrend'), symbols: 'aapl msft' };
  const good = checkForm(ok);
  assert.ok('body' in good);
  assert.deepEqual(good.body.symbols, ['AAPL', 'MSFT']);
  assert.equal(good.body.benchmark, 'SPY');
  const err = (patch: object) => { const out = checkForm({ ...ok, ...patch }); assert.ok('errors' in out, JSON.stringify(patch)); return out.errors; };
  assert.match(err({ strategy: '' }).strategy!, /Choose/);
  assert.match(err({ symbols: '' }).symbols!, /at least one/);
  assert.match(err({ symbols: Array.from({ length: 51 }, (_, i) => `S${i}`).join(' ') }).symbols!, /50 tickers or fewer/);
  assert.match(err({ years: '0' }).years!, /whole number/);
  assert.match(err({ years: '2.5' }).years!, /whole number/);
  assert.match(err({ years: '10' }).years!, /1 to 9/);
  assert.ok(err({ positionPct: '0' }).positionPct);
  assert.ok(err({ positionPct: '100.5' }).positionPct);
  assert.ok(err({ costBps: '' }).costBps);
  assert.ok(err({ initialCash: '999' }).initialCash);
  assert.ok(err({ riskFreePct: '16' }).riskFreePct);
  assert.ok(err({ benchmark: 'S P Y' }).benchmark);
  assert.ok('body' in checkForm({ ...ok, positionPct: '100', costBps: '0', initialCash: '1,000' }));
});

test('tabs wrap with the arrow keys and saved-time labels shorten', () => {
  assert.equal(nextTab('overview', 'ArrowLeft'), 'details');
  assert.equal(nextTab('details', 'ArrowRight'), 'overview');
  assert.equal(nextTab('compare', 'Home'), 'overview');
  assert.equal(nextTab('compare', 'End'), 'details');
  assert.equal(nextTab('compare', 'a'), null);
  assert.equal(isTab('evidence'), true);
  assert.equal(isTab('nope'), false);
  const now = Date.parse('2026-11-10T12:00:00Z');
  assert.equal(savedLabel('2026-11-10T11:59:50Z', now), 'now');
  assert.equal(savedLabel('2026-11-10T11:30:00Z', now), '30m ago');
  assert.equal(savedLabel('2026-11-10T07:00:00Z', now), '5h ago');
  assert.equal(savedLabel('2026-10-02T07:00:00Z', now), '2 Oct 2026');
});
