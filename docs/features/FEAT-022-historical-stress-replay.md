# FEAT-022 · Historical Stress Replay

Deferred proposal, 2026-11-11 SGT. No execution task assigned.

## Outcome

Apply a historical price window to today's portfolio or a valid Sandbox draft. Compare the worst drawdown, ending change, and positions that drove the drop. Quant Lab replays trading strategies. This feature starts with a fixed allocation and applies the same market window to both portfolios.

## First release

- Start with one USD account, one user-selected date window, long-only US stocks and ETFs, and optional USD cash held flat. Pin the opening values and use dated daily closing prices on the same trading calendar. Label the result as price-only and disclose its assumptions and data source.
- Normalize each instrument to its price at the start of the window. Hold the resulting units constant. Show an equity curve, peak-to-trough drawdown, end-of-window change and each covered position's contribution between the peak and trough.
- Compare the current and draft portfolios over identical dates, using the same frozen price series for shared symbols. Disclose the uncovered value in each portfolio and withhold the headline comparison if required series are missing. A historical replay carries no order authority or forecast.

## Acceptance

- Hand-calculated fixtures verify the equity curve, drawdown and contribution sum on a path whose worst drawdown and ending loss differ.
- Tests cover cash, a missing or late-starting series, different holdings across drafts, and a benchmark or calendar mismatch. All compared dates and inputs are inspectable.
- Replay runs on synthetic prices before connecting a historical data source. Results leave holdings and drafts unchanged.
