# FEAT-008: Import IBKR trades without duplicating holdings

- Execution task: `IBKRTRADES-001`
- Status: Implemented and verified; committed in `22b0436`, integration selected 2026-10-27.
- Active checkout in the investment workspace: `finsight-wt/open-features` (`feature/open-features`).
- This contract does not claim merge, deployment or confirmed execution.

## Objective

Logged by user 2026-10-26. Re-importing an IBKR activity statement today either adds positions again (no Replace) or wipes history (Replace). Parse the statement's Trades section and add only fills not already recorded (match on symbol, date, quantity, price), with a preview of what will be added before confirming. Builds on the trade sheet, merged into FinSight main e0da6ee on 2026-10-26.

## Acceptance

- [x] Trades section parsed into buys and sells with dates and prices; positions-only statements still import as today
- [x] Preview lists new vs already-recorded fills; confirming adds only new ones; re-importing the same statement adds nothing
- [x] Unit tests on sample statements (no real account data committed); e2e for preview and confirm

## Stop condition

Isolated implementation verified. User selected commit, review, merge and push on 2026-10-27. No real statement import or live-data mutation is authorized by integration.


## Implementation and verification

- [x] Header-driven Trades parsing handles dated stock/ETF buys and sells and listing suffixes.
- [x] Preview new versus recorded fills; confirmation carries a portfolio snapshot token checked under lock.
- [x] Match account, symbol, side, displayed trade day, quantity, price and currency with multiplicity for identical fills.
- [x] Apply new fills chronologically in memory; one save and undo. Repeat import makes no changes.
- [x] Preserve positions-only imports. Trade import rejects Replace, malformed/unsupported instruments, insufficient shares and unsafe backfills.

Synthetic verification: `test/open-features.test.ts`, `web/e2e/D2.spec.ts`, `web/e2e/OPENFEATURES.spec.ts`. No broker execution.

Matching follows the statement’s displayed trade day (stored at UTC midnight), not an inferred exchange timezone. Identical same-day fills are counted with multiplicity within the statement. Disjoint partial exports of indistinguishable same-day fills cannot be uniquely reconciled without broker execution IDs; review the preview. Commissions/fees are not added by this feature, matching the existing manual trade ledger. Existing positions snapshots cannot be retroactively reconstructed into historical fills automatically; unsafe backfills fail instead of duplicating holdings.
