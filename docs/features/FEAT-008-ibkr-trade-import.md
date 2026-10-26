# FEAT-008: Import IBKR trades without duplicating holdings

- Execution task: `IBKRTRADES-001`
- Status: Verified by the existing feature session; uncommitted/unmerged, integration pending.
- Active checkout in the investment workspace: `finsight-wt/open-features` (`feature/open-features`).
- This contract does not claim merge, deployment or confirmed execution.

## Objective

Logged by user 2026-10-26. Re-importing an IBKR activity statement today either adds positions again (no Replace) or wipes history (Replace). Parse the statement's Trades section and add only fills not already recorded (match on symbol, date, quantity, price), with a preview of what will be added before confirming. Builds on the trade sheet, merged into FinSight main e0da6ee on 2026-10-26.

## Acceptance

- [ ] Trades section parsed into buys and sells with dates and prices; positions-only statements still import as today
- [ ] Preview lists new vs already-recorded fills; confirming adds only new ones; re-importing the same statement adds nothing
- [ ] Unit tests on sample statements (no real account data committed); e2e for preview and confirm

## Stop condition

Verified isolated implementation and handoff; never import the user's real statement or touch the live data folder without asking.
