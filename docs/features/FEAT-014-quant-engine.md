# FEAT-014: Quant Engine and portfolio backtesting

- **ID:** FEAT-014
- **Execution task:** `QUANT-001`
- **Status:** Milestones 1 to 3 implemented, not merged · selected by the user 2026-11-10
- **Agent spec:** FR-4.16 to FR-4.20

## Intent

Kestrel asks whether an investment makes sense. The Quant Engine measures what the historical evidence shows and how it holds up in a portfolio. It computes, Kestrel interprets, and FinSight's existing gate still authorises any paper order. A favourable backtest never places or approves an order.

## Architecture decision (user, 2026-11-10)

Python is the runtime for quantitative work. TypeScript keeps FinSight, Kestrel, accounting, risk enforcement and paper execution. The worker is `agent/quant/`, with its own locked environment (`uv sync --project agent/quant`), and gets one JSON request on stdin and returns one JSON response on stdout. The child does not inherit environment credentials, and a Python audit hook (`finsight_quant/guard.py`) denies it sockets and child processes, so it has no route to a broker. This covers Python and the standard library. It is not OS-level isolation: native code could bypass it, which is why only this package and numpy may run in the worker.

The long-term direction is a Python quant core, with new strategies written in Python. The five existing strategies stay in `public/strategies.js` for now. The chart runs them in the browser, FR-4.3 requires one shared engine, and they are the reference a port must match. The candidate-trade contract below is language neutral, so ported strategies plug in without redesigning the replay.

### Migration gate for the existing strategies

Port a strategy only when a portfolio backtest shows it is worth keeping. A port must reproduce the JavaScript trades on identical bars within stated tolerances. Before Kestrel switches to a port, either the chart must also consume it or the user must amend FR-4.3 to accept a tested parity guarantee. Private plugins are JavaScript under the Node permission model, and Python has no equivalent sandbox, so user-supplied strategy code must not run in the Python worker.

## Milestone 1 (implemented)

Scope: daily bars, long-only US equities in USD, one strategy, many symbols, one cash account, one benchmark.

1. **One dataset.** `agent/src/quant/data.ts` removes invalid and in-progress bars and flags large jumps and gaps. The engines and the replay consume the same bars. FinSight history now carries an additive `adj` field, the dividend-adjusted close.
2. **Candidate trades.** Sandbox op `trades` returns each simulated trade with entry fill, stop and exit legs. Engines keep ownership of signals and fills, including stop entries and partial exits.
3. **Portfolio replay.** `finsight_quant/portfolio.py` accepts, sizes or rejects candidates under cash and position limits. Daily order: dividends, exits at the open, entries most-liquid-first, intraday exits. The ledger is rebuilt independently at the end, and the run fails if it does not reconcile.
4. **Metrics.** `finsight_quant/metrics.py` reports total return, CAGR, volatility, Sharpe, Sortino, max drawdown, time under water, turnover, costs, exposure, concentration and closed-trade statistics. Annualisation is 252 days and the risk-free rate is an explicit input.
5. **Kestrel tool.** `backtest_portfolio` compares against a total-return benchmark and returns warnings, assumptions and provenance hashes.

### Verification

`npm run quant:verify` checks the worker against sources its author did not write. Add `-- --mutate` to measure the checks by injecting bugs.

| Technique | What it establishes |
|---|---|
| Exact reference model (`verify/reference.py`) | An independent specification in rational arithmetic agrees with the replay |
| Exhaustive small scope | Every combination of up to two trades across five days, two symbols and 48 settings |
| Generated scenarios | Larger portfolios, missing bars, and these relations: no look-ahead, independence from input order, conservation of money |
| vectorbt accounting | A third-party engine rebuilds cash and value from the replay's fills. This checks arithmetic, not which trades were chosen |
| vectorbt selection | Given only the raw candidates, the same engine decides affordability and share counts under its own cash limit and must choose the same fills. Covers cash limits, sizing, liquidity order and same-day settlement. It cannot express position-slot limits, partial exits or same-bar round trips, which rest on the reference model |
| empyrical and brute force | Sharpe, Sortino, volatility and drawdown match published implementations |
| JavaScript engine P&L | With dividends removed, the replay's per-trade return equals the engines' own, and sandbox trades survive truncation of later bars |
| Yahoo declared dividends | Amounts derived from the adjusted close match declared dividends, including non-payers (live mode) |
| Mutation testing | Generated faults are caught, including in ledger reconciliation. The command fails if the unmodified code fails, a mutant times out, or a survivor has no recorded reason |

TLA+ was considered and not used: the replay is a single-threaded loop, and a TLA+ model would verify a hand-written copy rather than the running code. Exhaustive enumeration applies the same small-scope idea to the implementation itself.

### Known limits

- A candidate the portfolio rejects still blocks later signals on that symbol, because the engine simulates each symbol alone.
- The portfolio starts flat, so an engine trade already open on the first day of the window is not taken.
- Survivorship and selection bias remain. Yahoo has no point-in-time index membership or delisted tickers. Fixing this needs a paid source. Every result carries the warning.
- Closed and open trade P&L, win rate and expectancy include dividends received while the position was held.
- Dividends are gross, with no withholding tax. For a non-US holder this overstates income, for the strategy and the benchmark alike.
- The engines' 5 bps entry slippage is fixed. `extraSlippageBps` only adds to it.

## Milestone 2 (implemented)

Every `backtest_portfolio` run is saved in `agent.db` with the exact bars it used and returns a `runId`. Bars are gzipped and shared between runs by content hash. Only the newest 100 runs are kept, and bars no kept run references are deleted with them. A worst case of 100 runs on 50 symbols with no shared bars is roughly 400 MB.

`get_quant_run` lists recent runs, reads one, or with `reproduce: true` recomputes it from the stored bars with the current engine and worker. FinSight need not be running. Reading refuses a run whose bars no longer match their stored hashes. The answer reports whether candidates and results match, and whether the engine or worker code has changed since the run.

| Check | What it establishes |
|---|---|
| Restart with FinSight down | A run reads back unchanged from a reopened database and reproduces with no market-data access |
| Altered stored inputs | Changed settings or hashes produce `reproduced: false`, so reproduction recomputes rather than echoing |
| Altered bars | Changed or unreadable bars are refused, including when the attacker also rewrites the bars' own hash |
| Retention | Only unreferenced bars are removed, and the newest runs stay |
| Injected faults | All 15 faults added by hand to the saved-run code were caught by the tests. This was a one-off measurement, not part of `quant:verify` |
| Real FinSight server | One 5-year, 6-symbol run on live data through `/api/history/batch` in an isolated data folder, reproduced after the server stopped. A separate Python reader confirmed the stored bars and dataset hash |

Private plugin engines have no content hash, so `engineChanged` cannot detect a change to one. `candidatesMatch` still does when the change affects trades.

## Milestone 3 (implemented)

`validate_quant_run` stresses a saved run with its frozen rules. It recomputes the engine trades from the stored bars, refuses if they no longer match the run, and stores the study with the run. `get_quant_run` returns the verdicts by default and the full study with `detail: 'robustness'`, so a large run fits in one tool result. `finsight_quant/validation.py` holds every threshold, so a run cannot choose the test it passes.

| Check | Pass condition | Minimum evidence |
|---|---|---|
| `time_holdout` | The last 30% of the window beats the benchmark | 126 days, 30 trades |
| `time_consistency` | At least 3 of 4 equal periods beat the benchmark | 126 days per period |
| `universe_halves` | Both hash-split halves beat the benchmark | 4 symbols, 30 trades per half |
| `single_name_dependence` | Still beats the benchmark with any one symbol removed | 3 symbols, 30 trades |
| `cost_stress` | Still beats the benchmark with 25 bps extra per side | 30 trades |
| `bootstrap_excess` | The 95% interval for excess CAGR is above zero | 126 days, 30 trades |

Each check returns pass, fail or insufficient. None of them changes a strategy's status or authorises an order. These are robustness checks on history, not out-of-sample proof: the rules and symbols were chosen by people who could already see the data.

Time windows are slices of the one continuous run. An earlier version replayed each window from flat, and a live run showed why that is wrong: long-held trades already open were dropped, so periods did not add up to the whole. Universe tests scale position size so a smaller universe can deploy as much capital as the full one.

The bootstrap is a stationary block bootstrap of paired daily strategy and benchmark returns, with 2,000 resamples, a 21-day expected block and a fixed seed. It covers sampling noise only. It does not correct for survivorship, for choosing this strategy among others, or for regime change.

| Verification | What it establishes |
|---|---|
| Exact reference model | Every window, universe and cost study matches a recomputation from the written rules |
| Compounding relation | Periods multiply back to the whole run |
| `arch` library | Interval endpoints agree with a third-party stationary bootstrap |
| Coverage experiment | Intervals contain a known true growth rate about 95% of the time on autocorrelated series |
| Boundary table | Every pass, fail and insufficient threshold is tested on both sides |
| Mutation testing | `validation.py` is included in `quant:verify -- --mutate` |

## Later milestones (not selected)

| Order | Work | Note |
|---|---|---|
| Later | Walk-forward testing | Nothing to re-fit until engines take parameters (FR-4.4 version bumps) |
| 4 | Quant Lab React island | After validation, so charts do not lend authority to untested numbers |
| 5 | Portfolio risk and Council citation | FEAT-013 currently says backtests are not used as evidence for its scorecard; reconcile first |
| 6 | Risk-based sizing, factor models, optimisation | Python libraries are added when a task needs them |

Forward paper evaluation belongs to FEAT-013.
