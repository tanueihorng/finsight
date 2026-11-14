# FEAT-023 · Portfolio Checkpoints

Deferred proposal, 2026-11-11 SGT. No execution task assigned.

## Outcome

Save what an account looked like at a point in time and later see what moved. Compare cash, quantities, position weights and priced value, including new and exited holdings.

## First release

- Capture a checkpoint on demand in the configured private data directory. Store its account, book, currency, timestamp, quantities, cash, market marks and coverage. Show the two source timestamps and require matching scope for a comparison.
- Compare two saved checkpoints or a saved checkpoint and a current view. Show per-position quantity and price changes, total cash movement and exposure drift. A one-currency fixture establishes the arithmetic before expanding the supported scope.
- Preserve a checkpoint's marks and scope on reopen. Missing marks and incomplete coverage remain visible. A value change between checkpoints is not an investment return and does not classify deposits, fees or other cash flows without matching ledger evidence.

## Acceptance

- Fixtures verify additions, exits, unchanged quantities with price moves, cash changes and unpriced positions. A mismatched book or account refuses comparison.
- A save followed by a restart preserves the original timestamp and values. Deleting a checkpoint leaves current holdings and transaction history intact.
