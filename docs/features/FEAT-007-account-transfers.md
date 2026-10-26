# FEAT-007: Transfer holdings between accounts

- Execution task: `TRADEXFER-001`
- Status: Selected; implementation and verification owned by the existing feature session.
- Active checkout in the investment workspace: `finsight-wt/open-features` (`feature/open-features`).
- This contract does not claim merge, deployment or confirmed execution.

## Objective

Logged by user 2026-10-26. Move some or all shares of a symbol from one account to another, keeping each lot's purchase date and FX (no SELL/BUY, no realized P&L). Needs a new atomic, undoable backend op that splits lots proportionally, a TRANSFER ledger entry, and performance.ts must treat it as an internal move, not new money. UI: Transfer action in the trade sheet. Builds on the trade sheet, merged into FinSight main e0da6ee on 2026-10-26.

## Acceptance

- [ ] Transfer keeps lot dates, prices and FX snapshots; source/target quantities and average cost reconcile; one UNDO reverts both sides
- [ ] No realized P&L, and portfolio performance across All Accounts is unchanged by a transfer
- [ ] Ledger shows the transfer; unit tests for partial/full transfers and invalid input; e2e for the sheet flow

## Stop condition

Verified isolated implementation and handoff; no merge/push without the user's say.
