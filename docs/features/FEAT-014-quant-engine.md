# FEAT-014: Quant Engine and portfolio backtesting

- **ID:** FEAT-014
- **Execution task:** `QUANT-001`
- **Status:** Milestones 1 to 4 implemented, not merged · selected by the user 2026-11-10, Quant Lab 2026-11-11
- **Agent spec:** FR-4.16 to FR-4.21

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

## Milestone 4 (implemented)

The Quant Lab is a full-screen workbench. Open it with the **LAB** button in the top bar or the `LAB` command. The user chose four previewed layouts on 2026-11-11: the terminal workbench is the shell, and the other three are views inside it.

| View | Answers |
|---|---|
| Overview | What the run did: growth of the money against the benchmark, key figures, and the check list beside it |
| Evidence | The six robustness checks, each with the number behind it |
| Compare | How strategies tested on identical stocks and settings stand, sorted by checks passed, never by return |
| Plain English | Five questions a non-specialist would ask, answered from the check statuses |
| Details | Settings, trading activity, warnings, assumptions, recompute, CSV export and glossary |

Usability rules:

- A first run needs a strategy and tickers. Presets fill the tickers (13 large US stocks, the watchlist, US holdings). Other settings sit under More settings with working defaults.
- One button runs the backtest and then its checks, shows the step and elapsed time, and can be cancelled. If the checks fail, the saved backtest stays visible as not checked.
- The form validates against the tool limits and names each problem beside its field.
- The workspace is keyboard usable: arrow keys move between tabs and along the chart, Escape closes and returns focus to the LAB button. Every chart has a table view. It fits a phone with no sideways scrolling.

Evidence rules:

- The page computes no performance number. Every figure comes from the saved run or study, and text states which checks were not met, never why.
- "Not out-of-sample proof", survivorship bias and "not accepted" stay on screen. The Lab has no order or approval controls.
- The agent exposes `GET` and `POST /v1/quant/runs`, `GET /v1/quant/runs/:id`, and `POST .../validate` and `.../reproduce`, reached only through FinSight's session-gated proxy. One job runs at a time, and leaving the request stops the worker. These routes read the store or call the tool handler directly because the tool result cap would truncate a whole study.

Verification: `web/src/features/quant/quant.test.ts` covers formatting, form limits, chart geometry, comparison rules and answer wording. `web/e2e/QUANT*.spec.ts` drives the workspace against a synthetic agent, and agent tests cover the routes. A manual browser run used real public prices on isolated data, with four strategies on 13 stocks.

## Review fixes (2026-11-11)

An independent review of `328b26e` found three defects. Each is fixed, with a test that fails if the fix is removed.

| Finding | Fix |
|---|---|
| A robustness study could be saved against a result it did not reproduce (`baseMatchesRun: false`) | `validate_quant_run` first recomputes the run from its stored bars and refuses (`QUANT_RESULT_CHANGED`) unless the result hash and every section match. It then refuses (`QUANT_BASE_MISMATCH`) unless the study's full-window baseline equals the saved run in window, growth, Sharpe, drawdown and trade count. Nothing is saved on refusal, and reads hide any older unmatched study. |
| Compare could show runs on revised prices as one test | Run summaries carry the dataset and replay-code fingerprints. Compare requires both to match, and a run without them stands alone. |
| A non-USD or unreported benchmark currency was accepted | FinSight history now reports whether Yahoo sent a currency (`meta.currencyReported`). The benchmark must be reported USD or the backtest is refused. Stocks not reported as USD are excluded with a warning. History cache keys moved to `hv2:` so no entry without the flag is served. |

A second review, of `6769a12`, found two more:

| Finding | Fix |
|---|---|
| A warm-up bar with no adjusted close, before the test window, switched the whole benchmark to price-only returns | The fallback, and the matching warnings, now look only at bars inside the test window. |
| Studies saved before the strict baseline check carried `baseMatchesRun: true` after comparing only two growth rates | Studies now record `baseCheckVersion: 2`, and reads hide any study without it. Checks saved before this change show as not checked until they are run again. |

The four real saved runs were re-validated with the stricter code: all passed both guards and gave the same studies, byte for byte.

A third review, of `d980bb9`, found no blockers and one wording fault: a stock missing adjusted close on some days still earns dividends between days that have it, yet the warning said its dividends were not counted. The warning now tells the two cases apart. With no adjusted close in the window it says dividends are not counted, and with a gap it says they may be incomplete. Results are unchanged.

## Later milestones (not selected)

| Order | Work | Note |
|---|---|---|
| Later | Walk-forward testing | Nothing to re-fit until engines take parameters (FR-4.4 version bumps) |
| 5 | Portfolio risk and Council citation | FEAT-013 currently says backtests are not used as evidence for its scorecard; reconcile first |
| 6 | Factor research, risk-based sizing, optimisation | Drafted below, not selected. Python libraries are added when a task needs them |

Forward paper evaluation belongs to FEAT-013.

## Milestone 6 draft: cross-sectional factor research

**Status:** Draft, deferred, not selected (2026-11-11). Nothing here authorises code, a data purchase or a change to the agent spec. All numbers are proposals until the user confirms them.

### Why this is a separate track

Milestones 1 to 3 measure single-stock chart rules. Each symbol is simulated alone, nothing is ranked against anything else, the universe is chosen by hand and every position is the same size. This milestone adds what those lack: a rules-defined universe, signals compared across stocks at each date, sizing based on risk, and data that shows only what was known at the time.

The goal is a long-only monthly model that one person can run. It is a research result, and a good result still authorises nothing. Forward paper evaluation stays in FEAT-013.

### Gate

Work starts only when both are true:

1. The user confirms Milestones 1 to 3 are correct and accurate, as decided on 2026-11-11.
2. The user selects this milestone and accepts the spec changes listed below.

No prototype on Yahoo data. It would have the survivorship bias this milestone exists to remove, and early numbers would anchor every later decision.

### Design

| Part | Proposal |
|---|---|
| Universe | At each rebalance, the 1,000 most liquid US common stocks by 63-day median dollar volume, price at least $5, computed only from data up to that date. A liquidity rule needs delisted prices but not past index membership |
| Signals | Fixed before any result is seen. Momentum: 12-month return skipping the latest month. Value: earnings and free-cash-flow yield. Quality: gross profit over assets. Low risk: inverse 252-day volatility |
| Fundamentals timing | A figure is usable only from the session after its filing date, using the value as first filed |
| Combination | Winsorised cross-sectional ranks, equal weight across signals. Nothing is fitted, so there is nothing to overfit in the first version |
| Portfolio | Long-only, top 50 names, rebalanced monthly. Signal at the month-end close, trades at the next open. A held name stays until it falls out of the top 30% of the universe, to limit turnover |
| Costs | The existing 10 bps commission, plus slippage of 5, 15 or 40 bps by liquidity tier. No order above 1% of 20-day average dollar volume |
| Delistings | The last traded price, then a stated assumed loss. Results report 0%, 30% and 100% loss. Using only 0% would bring back a form of survivorship bias |
| Benchmarks | SPY total return and the equal-weight universe. The second shows whether selection added anything beyond holding many smaller stocks |

### Stages

Each stage must pass before the next begins.

| Stage | Work | Exit test |
|---|---|---|
| 6A Data | Bulk download into a local dataset with a content hash. Prices include delisted names. Fundamentals carry filing dates | Named delisted stocks are present and end correctly. A known past restatement shows the first-filed value before the restatement date |
| 6B Signals | Universe and signal code in Python, with no portfolio yet | Decile long-short returns correlate at 0.7 or more per month with the [Ken French](https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/data_library.html) or [AQR](https://www.aqr.com/Insights/Datasets) published series for the same factor. Removing all data after any date leaves earlier signals unchanged |
| 6C Rebalance replay | A new target-weight path through the cash, cost, dividend and ledger rules | The ledger reconciles. An independent reference model and vectorbt agree with it. Mutation testing covers the new module |
| 6D Validation | Trial log, Deflated Sharpe Ratio, locked holdout, factor attribution against published factors | See below. A read-only `factor_backtest` tool for Kestrel comes only after this stage |
| 6E Risk and optimisation | First inverse-volatility weights with position and sector caps, then a shrinkage covariance optimiser with a turnover penalty | Each step must beat the simpler one after costs in the holdout, or it is dropped |

### Validation additions

- **Trial log.** Every signal and setting combination tried is recorded in a table that is never pruned. The 100-run limit on saved runs cannot serve this purpose, because pruning would hide failed attempts.
- **Deflated Sharpe Ratio.** It uses the logged trial count, addressing the gap the bootstrap states: it does not correct for choosing one strategy among others.
- **Locked holdout.** The latest 3 years stay unread until the design is frozen and are read once, with the read recorded. Thirty-six monthly results are weak evidence, and the authors have lived through those years, so this is stricter than Milestone 3 and still not proof.
- **Evidence bar.** Alpha against published factors with a t-statistic of at least 3, over the research period, before any claim of an edge.
- **Existing checks.** The six Milestone 3 checks carry over where they apply.

### Architecture consequences

| Current constraint | Problem | Proposal |
|---|---|---|
| The worker takes one JSON request on stdin, and FEAT-014 caps runs at 50 symbols | A universe drawn from thousands of names over 15 or more years is millions of daily rows, too large for JSON | The agent passes a dataset path and hash. The worker opens a read-only SQLite file with the standard library. No new native dependency, and the guard still denies sockets and child processes |
| Candidate trades come per symbol | They cannot express a cross-stock decision | A separate target-weight contract, `date → {symbol: weight}` |
| FR-4.16 and FR-4.3 tie backtests to the shared chart engines | Factor models are not chart strategies | A new requirement stating factor models are Python-only, are not charted and are not user-supplied |
| FR-4.19 saves every run with its bars | Copying a full dataset per run would use far more than the current 400 MB worst case | Runs for this tool store a reference to an immutable dataset by hash, and reproduction refuses if that dataset is gone or changed |
| The repo is open source and holds no personal data | Licensed vendor data cannot be committed | Datasets live in `~/FinSightData/`, keys in the macOS Keychain. Download happens outside the worker |

### Data options

| Source | For | Against |
|---|---|---|
| Sharadar via Nasdaq Data Link | Point-in-time fundamentals, delisted companies, bulk table downloads, suits a Mac | Paid. Past-membership universes take extra work, which the liquidity rule avoids |
| Norgate | Survivorship-free prices and historical index constituents | Paid. A third-party guide says its Python API needs a Windows app running. Prices only, so fundamentals need another source |
| SEC XBRL company facts, already used by `research.ts` | Free, primary, has filing dates | Starts around 2009, and current ticker maps do not cover delisted firms. Prices would still need a paid source |

Prices, terms, redistribution limits and coverage must be checked directly with each vendor before selection. The comparisons above come from third-party write-ups.

### Non-goals

Intraday trading, live or paper order generation, shorting outside the 6B replication test, alternative data, machine-learning or LLM-generated signals, and user-supplied Python. Research on LLMs found them most useful for reading filings and calls, with thin evidence of lasting alpha and a risk that funds converge on the same positions.

### Decisions for the user

1. Which data source, and what annual budget.
2. Universe size and history length.
3. Portfolio size for the liquidity limit. This is a setting and never stored in the repo.
4. Whether to accept the new requirement and the FR-4.19 exception.
5. Whether the proposed thresholds stand: 0.7 replication, t-statistic of 3, 3-year holdout.

### Research notes (retrieved 2026-11-11)

Most public material on current practice is asset-manager marketing or vendor blogs, and funds do not publish their methods.

- Signals and portfolio construction: [Robeco](https://www.robeco.com/en-us/insights/2026/05/innovation-where-it-matters-generating-alpha-while-maintaining-disciplined-control), [Goldman Sachs Asset Management](https://am.gs.com/en-us/institutions/insights/article/2026/not-all-quants-are-alike-equity-alpha)
- Factor returns and crowding: [Russell Investments Q1 2026](https://russellinvestments.com/content/dam/ri/files/us/en/institutions/articles/Equity-Factor-Investing-Report_2026-Q1.pdf), [AQR, Academic Alpha](https://www.aqr.com/-/media/AQR/Documents/White-Papers/Academic-Alpha-A-Re-Introduction-to-Style-Premia-Investing.pdf?sc_lang=en)
- Overfitting: [Deflated Sharpe Ratio](https://papers.ssrn.com/abstract=2460551), [Probability of Backtest Overfitting](https://papers.ssrn.com/abstract=2326253)
- LLMs: [UT McCombs](https://news.mccombs.utexas.edu/research/keeping-humans-in-the-loop/), [Zerve](https://www.zerve.ai/blog/llms-in-quantitative-research)
- Data: [Sharadar comparison](https://dev.to/pickuma/financial-modeling-prep-vs-sharadar-fundamental-data-apis-for-quant-backtests-la2), [Norgate toolkit](https://concretumgroup.substack.com/p/the-complete-norgate-data-toolkit)
