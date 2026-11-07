# FEAT-015: Process tools (after-cost returns, valuation column, cost-basis review, event radar, weekly digest, backtester and paper promotion)

Status: implemented on branch `feat/process-tools` (worktree `finsight-wt/process-tools`, stacked on `feat/policy-guardrails` / FEAT-014), not merged, pushed or deployed · 2026-11-07
Execution task: `PROCESSTOOLS-001` (selected by the user 2026-11-07, items 4–10 of a ten-item build list).

## Intent

Make the owner's process visible from FinSight's own records: what the book really earned after costs it
can see, how prices compare with the owner's own fair-value ranges, which recorded costs need checking,
what to prepare before the next events, a one-page weekly summary, and evidence-based research on the
built-in strategies. None of it places, drafts or approves an order.

## Boundaries

- Figures are computed in code. Anything FinSight's records cannot show is labelled unknown, never estimated
  (broker fees) or converted (a fair-value range in another currency).
- Personal state lives only in `FINSIGHT_DATA_DIR`, written atomically with mode 0600:
  `cost-review.json`, `strategy-status.json`, `digests/<date>.md`.
- No scheduling or delivery: the digest exists only when the owner presses GENERATE.
- "Paper" is an owner-recorded research status with forward-only tracking. FinSight never records
  "accepted"; acceptance happens in the owner's investment policy.
- Kestrel (`agent/`) is unchanged in this feature. A concurrent session was editing the agent, so making
  Kestrel read the new records is a follow-up.

## 1. Returns after costs (`/api/costs`, panel RETURNS AFTER COSTS)

- Splits the gain into: unrealized price, unrealized FX, realized price, realized FX, older realized sales
  with no price/FX split, gross dividends, withholding tax and net. Account-scoped like Dividends.
- Broker fees: **unknown**, because the ledger has no fee field. If imported average costs include
  commissions, those commissions are already inside the price P&L.
- Fund expense ratios (Yahoo fund profile, ETFs and funds only) are shown as an estimated yearly cost.
  They are not subtracted again, because they are already inside fund prices. Funds without a ratio are
  named.
- TWR and MWR come from Performance and count dividends before withholding.

## 2. Valuation column (Positions, `VS FAIR`)

- Price against the low/high range written in the holding's thesis (FEAT-014 §2). It shows BELOW n%,
  IN RANGE or ABOVE n%. A range in a different currency from the price shows `ccy?` and is not converted.
- The column appears only when at least one thesis has a range, so the table is unchanged until then.

## 3. Cost-basis review (`/api/costbasis`, panel COST BASIS REVIEW)

- Flags, each with a reason:
  - all lots dated on a day when three or more holdings in the account were bought (a likely import date)
  - zero cost
  - no quote (the value is the stored price)
  - owner-marked placeholder
  - a confirmation that no longer matches the current cost
  - on request (CHECK PRICES): a lot price outside that week's high–low range, ±2%
- Marks: confirmed, placeholder or clear, per account and symbol. A current confirmation hides the
  heuristic flags.
- SET COST rewrites one holding's average cost:
  - Every open lot's price, and its BUY's price, is scaled by new/old. Quantities, dates and FX anchors
    are kept.
  - It is one undo step, and the new cost is recorded as confirmed.
  - It is refused for transferred lots, and for several lots at zero cost; those go through the ledger.
  - It is blocked in PAPER mode (`PAPER_READONLY`).

## 4. Event radar (`/api/radar`, panel EVENT RADAR)

- Next 30 days, whole book: earnings and ex-dividend dates (holdings and watchlist), plus FOMC decisions.
- For each held company it gives:
  - weight
  - prompts from the owner's records: no thesis before a report, a review overdue or due around the
    report, the last check weakened or broken, urgent invalidation conditions, above the intended max
    weight, a guardrail breach or near reading (with its proposed/accepted label)
- Discloses projected dates, fetch failure, and the end of the curated FOMC list (currently 2026-12-09).

## 5. Weekly digest (`/api/digest`, `POST /api/digest/save`, panel WEEKLY DIGEST)

- Markdown sections:
  - Week: change after new money in or out, from Performance points, with dividends before withholding
  - Guardrails
  - Theses
  - Next 14 days
  - Decision log
  - Cost basis
- Each section says plainly when there is nothing or no data.
- On demand only. SAVE writes `DATA_DIR/digests/<date>.md` (0600) and returns the file name only. COPY
  puts it on the clipboard. Nothing is scheduled or sent.

## 6. Backtester and paper promotion (`/api/backtest/*`, panel BACKTESTER)

- Runs the built-in trade engines (`public/strategies.js`: pullback, breakout, MA trend, RSI-2; the DCA
  zones are not trades) over up to 40 symbols. It uses 2, 5 or 10 years of daily bars, and the default
  universe is quoted holdings plus the watchlist.
- Costs are the engines' own: 10 bps a side plus 5 bps entry slippage.
- Results:
  - all, in-sample and out-of-sample statistics (out of sample = trades entered in the last 30% of history
    after warm-up)
  - compounded return against buy-and-hold on each symbol
  - time in the market
- Disclosures: survivorship and selection bias, daily proxies of intraday methods, and no tax, FX or
  dividends.
- RECORD AS PAPER:
  - The server re-runs the backtest itself, so the recorded evidence is its own, not the browser's.
  - The minimum-evidence floor is ≥ 30 closed trades and ≥ 10 out of sample. These are FinSight
    defaults, not policy.
  - It records the status, the date, the universe and headline evidence.
- Paper tracking shows only signals entered on or after that date, plus current setups (a simulated trade
  opened before the date is excluded).
- END PAPER returns the status to backtested; CLEAR removes it; "accepted" is refused.
- Private strategies (sandboxed for Kestrel) are not run here.

## 7. Paper-trading and repository clean-up (report only)

The audit is in the workspace run record (`harness/runs/…PROCESSTOOLS-001…/CLEANUP.md`):

- the Alpaca paper-host lock and the 0600 key files are confirmed
- the live keys check was not repeated, because it needs the owner's go-ahead
- local `main` is 60 commits ahead of `origin/main`
- merged branches and clean worktrees are listed as candidates to prune

Nothing was pruned, pushed or reconnected.

## Verification

- Unit tests:
  - `test/costs.test.ts` (3)
  - `test/valuation.test.ts` (1)
  - `test/costbasis.test.ts` (5): flags, marks, range check, SET COST with undo and 0600 file
  - `test/radar.test.ts` (2)
  - `test/digest.test.ts` (3)
  - `test/backtest.test.ts` (6): statistics, split, gate, promotion, forward-only tracking, input validation
- Full suites on 2026-11-07: typecheck, 298 unit, 227 agent plus secret scan, and check:web passed.
- Browser check on an isolated scratch data folder with fictional holdings (port 8014):
  - every panel rendered
  - VS FAIR showed ABOVE 27% for the only holding with a range
  - RSI-2 run: 194 trades, 70 out of sample; recorded as paper; no `/api/paper` request was made
  - SET COST applied, then UNDO restored the cost and flagged the stale confirmation
  - CHECK PRICES flagged the fictional lot prices outside their weeks' ranges
  - the digest was generated and saved with mode 0600
  - no console errors
- The full browser suite result is recorded in the run record.
