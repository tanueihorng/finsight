// Quant Lab routes for the fake agent: synthetic saved runs with the agent's
// wire shape. Symbols steer the job: SLOW takes 8 s (so a spec can cancel it),
// NOCHECK saves the run but fails its checks, REFUSE fails the backtest.
const MONTHS = 24;
const monthly = (end, benchEnd) => Array.from({ length: MONTHS }, (_, i) => {
  const d = new Date(Date.UTC(2024, i + 1, 0)).toISOString().slice(0, 10);
  return { date: d, strategy: Math.round(100000 + (end - 100000) * i / (MONTHS - 1)), benchmark: Math.round(100000 + (benchEnd - 100000) * i / (MONTHS - 1)) };
});
const row = (cagr, bench, trades = 40) => ({ start: '2024-01-02', end: '2025-12-31', tradingDays: 500, cagrPct: cagr, benchmarkCagrPct: bench, excessCagrPct: Math.round((cagr - bench) * 1e4) / 1e4, sharpe: 1, benchmarkSharpe: .8, maxDrawdownPct: -12, trades });

const PROFILES = {
  matrend: { name: 'MA trend', cagr: 18.19, statuses: ['fail', 'fail', 'fail', 'fail', 'pass', 'fail'], interval: [-5.9, 19.9] },
  breakout: { name: 'Breakout', cagr: 3.15, statuses: ['insufficient', 'fail', 'fail', 'fail', 'fail', 'fail'], interval: [-22, 4.6] },
  rsi2: { name: 'RSI-2', cagr: 2.28, statuses: ['fail', 'fail', 'fail', 'fail', 'fail', 'fail'], interval: [-23.2, 3.5] },
};
const IDS = ['time_holdout', 'time_consistency', 'universe_halves', 'single_name_dependence', 'cost_stress', 'bootstrap_excess'];
const BENCH = 11.48;

function robustness(key) {
  const p = PROFILES[key], excess = p.cagr - BENCH, summary = { pass: 0, fail: 0, insufficient: 0 };
  p.statuses.forEach((s) => summary[s]++);
  return {
    validatedAt: '2026-01-02T00:00:00.000Z', strategy: `${key}@1.0.0`, status: 'backtested', label: 'Robustness checks on historical data with frozen rules. This is not out-of-sample proof.', summary,
    base: row(p.cagr, BENCH), checks: IDS.map((id, i) => ({ id, status: p.statuses[i], detail: `Rule for ${id}.` })),
    time: { development: row(p.cagr + 4, 8), holdout: { ...row(p.cagr - 9, 20, 36), start: '2025-05-12' }, periods: [row(p.cagr + 11, BENCH), row(p.cagr + 2, BENCH), row(BENCH - 3, BENCH), row(BENCH - 8, BENCH)] },
    universe: { halves: [{ ...row(BENCH + 5, BENCH, 59), symbols: ['AAA'], positionPct: 10 }, { ...row(BENCH - 2, BENCH, 42), symbols: ['BBB'], positionPct: 10 }], removals: ['AAA', 'BBB', 'CCC'].map((removed, i) => ({ ...row(BENCH + [5, 3, -1.6][i], BENCH), removed, positionPct: 10 })) },
    cost: { grid: [0, 5, 10, 25, 50, 100].map((extraBpsPerSide, i) => ({ ...row(p.cagr - i, BENCH), extraBpsPerSide })), survivesExtraBpsPerSide: excess > 5 ? 100 : null },
    bootstrap: { method: 'stationary', resamples: 2000, expectedBlockDays: 21, seed: 1, confidencePct: 95, intervals: { cagrPct: [1, 30], excessCagrPct: p.interval, sharpe: [0, 2], maxDrawdownPct: [-30, -10], shareOfResamplesAboveBenchmarkPct: 84.75 } },
    design: { holdoutPercent: 30, periods: 4, periodsToPass: 3, minDays: 126, minTrades: 30, costStressBps: 25 },
    baseMatchesRun: true, warnings: [], limits: ['No check changes a strategy\'s status or authorises a paper order.'], provenance: { datasetSha256: 'a'.repeat(64) },
  };
}

let runs = [], seq = 0;
const settings = (b) => ({ years: b.years ?? 5, initialCash: b.initialCash ?? 100000, positionPct: b.positionPct ?? 10, maxPositions: b.maxPositions ?? 10, costBps: b.costBps ?? 10, extraSlippageBps: b.extraSlippageBps ?? 0, riskFreePct: b.riskFreePct ?? 0, currency: 'USD' });
function makeRun(b) {
  const key = b.strategy, p = PROFILES[key], s = settings(b);
  return {
    runId: `qr_fake${String(++seq).padStart(6, '0')}`, savedAt: new Date().toISOString(), asOf: new Date().toISOString(), source: 'fake', strategy: `${key}@1.0.0`, status: 'backtested',
    label: 'Research, not an instruction: this strategy is not accepted in the user\'s policy.', validation: 'In-sample only: no out-of-sample test has been run.', universe: b.symbols, benchmark: b.benchmark ?? 'SPY',
    window: { start: '2024-01-02', end: '2025-12-31', tradingDays: 500 }, settings: s,
    performance: { strategy: { totalReturnPct: 130, cagrPct: p.cagr, volatilityPct: 15, sharpe: 1.19, sortino: 1.7, maxDrawdownPct: -15.7 }, benchmark: { totalReturnPct: 72, cagrPct: BENCH, volatilityPct: 17, sharpe: .72, sortino: 1, maxDrawdownPct: -24.5 }, excess: { totalReturnPct: 58, cagrPct: Math.round((p.cagr - BENCH) * 100) / 100 } },
    trading: { closedTrades: 79, openTrades: 1, winRatePct: 34.2, expectancyPct: 12, profitFactor: 3.4, averageHoldCalendarDays: 129 },
    activity: { annualTurnover: 1.5, totalCosts: 2487, dividendsReceived: 5225, averageExposurePct: 69.7, averagePositions: 6.4, largestPositionWeightPct: 35 },
    rejected: { max_positions: 5, no_cash: 10, already_held: 0 }, reducedEntries: 20,
    openPositions: [{ symbol: 'AAA', entryDate: '2025-09-10', shares: 191, entryPx: 111.2156, markPx: 164.73, unrealizedPnl: 10986.93 }],
    monthlyEquity: monthly(230566, 172184), recentFills: [{ date: '2025-11-05', symbol: 'AAA', side: 'buy', shares: 85, px: 271.57, fee: 23.08, why: 'entry' }], reconciled: true,
    warnings: ['Survivorship and selection bias apply: the universe is today\'s chosen tickers.'], assumptions: ['Daily bars, long-only.'], provenance: { datasetSha256: 'b'.repeat(64), candidateTrades: 205 }, robustness: null,
  };
}
const brief = (r) => ({ runId: r.runId, savedAt: r.savedAt, strategy: r.strategy, universe: r.universe, benchmarkSymbol: r.benchmark, window: r.window, settings: r.settings, cagrPct: r.performance.strategy.cagrPct, sharpe: 1.19, maxDrawdownPct: -15.7, benchmarkCagrPct: BENCH, closedTrades: 79, validation: r.validation, robustnessChecks: r.robustness?.summary ?? null });
const wait = (req, ms) => new Promise((resolve) => { const t = setTimeout(() => resolve(true), ms); req.socket.once('close', () => { clearTimeout(t); resolve(false); }); });

export async function quantRoute(req, res, p, u, json, readBody) {
  if (p === '/__test/quant-reset') { runs = []; return json(res, 200, { ok: true }); }
  if (p === '/strategies') return json(res, 200, { strategies: [...Object.entries(PROFILES).map(([key, x]) => ({ id: `${key}@1.0.0`, key, name: x.name, mechanical: true, kind: 'trade', status: 'backtested' })), { id: 'notes@1.0.0', key: 'notes', name: 'Discretionary notes', mechanical: false, kind: 'trade', status: 'idea' }] });
  if (p === '/quant/runs' && req.method === 'GET') return json(res, 200, { validation: 'In-sample only: no out-of-sample test has been run.', survivorship: 'Survivorship applies.', maxSaved: 100, runs: runs.map(brief) });
  if (p === '/quant/runs' && req.method === 'POST') {
    const b = await readBody(req);
    if (b.symbols.includes('REFUSE')) return json(res, 400, { error: { code: 'NO_DATA', message: 'None of the symbols have enough usable history.' } });
    if (b.symbols.includes('SLOW') && !await wait(req, 8000)) return;
    const run = makeRun(b); runs.unshift(run);
    return json(res, 201, { runId: run.runId });
  }
  const m = p.match(/^\/quant\/runs\/(qr_\w+)(?:\/(validate|reproduce))?$/), run = runs.find((r) => r.runId === m?.[1]);
  if (!run) return json(res, 404, { error: { code: 'NOT_FOUND', message: 'No saved quant run' } });
  if (!m[2]) return json(res, 200, run);
  await readBody(req);
  if (m[2] === 'reproduce') return json(res, 200, { reproduced: true, candidatesMatch: true, resultMatch: true, changedSections: [], engineChanged: false, workerChanged: false });
  if (run.universe.includes('NOCHECK')) return json(res, 500, { error: { code: 'QUANT_WORKER', message: 'worker stopped' } });
  run.robustness = robustness(run.strategy.split('@')[0]);
  return json(res, 200, { runId: run.runId, summary: run.robustness.summary });
}
