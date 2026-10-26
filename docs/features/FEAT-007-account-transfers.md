# FEAT-007: Transfer holdings between accounts

- Execution task: `TRADEXFER-001`
- Status: Implemented and verified; committed in `22b0436`, integration selected 2026-10-27.
- Active checkout in the investment workspace: `finsight-wt/open-features` (`feature/open-features`).
- This contract does not claim merge, deployment or confirmed execution.

## Objective

Logged by user 2026-10-26. Move some or all shares of a symbol from one account to another, keeping each lot's purchase date and FX (no SELL/BUY, no realized P&L). Needs a new atomic, undoable backend op that splits lots proportionally, a TRANSFER ledger entry, and performance.ts must treat it as an internal move, not new money. UI: Transfer action in the trade sheet. Builds on the trade sheet, merged into FinSight main e0da6ee on 2026-10-26.

## Acceptance

- [x] Transfer keeps lot dates, prices and FX snapshots; source/target quantities and average cost reconcile; one UNDO reverts both sides
- [x] No realized P&L, and portfolio performance across All Accounts is unchanged by a transfer
- [x] Ledger shows the transfer; unit tests for partial/full transfers and invalid input; e2e for the sheet flow

## Stop condition

Isolated implementation verified. User selected commit, review, merge and push on 2026-10-27; deployment remains separate.


## Implementation and verification

- [x] Transfer action in the trade sheet moves a partial or full holding between different existing accounts.
- [x] One atomic save and one undo cover both sides; every lot retains date, price, purchase FX and provenance.
- [x] Paired TRANSFER ledger rows show direction and counterparty account. No realized gain or loss.
- [x] All Accounts performance is unchanged. Individual account flows use market value on transfer day.
- [x] Original BUY edits/deletes are blocked after a lot transfer to prevent history corruption.

Synthetic verification: `test/open-features.test.ts`, `web/e2e/D2.spec.ts`, `web/e2e/OPENFEATURES.spec.ts`. No broker execution.
