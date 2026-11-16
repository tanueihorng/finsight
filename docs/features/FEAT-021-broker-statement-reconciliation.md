# FEAT-021 · Broker statement reconciliation

Deferred proposal, 2026-11-11 SGT. No execution task assigned.

## Outcome

Upload an IBKR activity statement and see whether FinSight agrees with it. The existing IBKR import preview identifies new and duplicate fills. Reconciliation compares closing balances and shows differences even when there are no new fills.

## First release

- Reuse the existing local statement parser where possible. Compare one explicitly selected account with an IBKR statement at a matching cutoff. Support closing quantities and cash balances by currency first.
- Show the broker figure, the FinSight figure, the difference and relevant evidence for each row. Label unavailable data, unsupported instruments and mismatched cutoffs. Add fee and dividend explanations once the balance comparison works.
- Show a report without importing or repairing entries. Any future correction workflow should use the existing ledger or import flow.

## Acceptance

- Synthetic fixtures cover a fully matching account, a missing position, a wrong quantity, a cash mismatch and a cutoff that cannot be reconstructed. The last case returns an explicit unavailable status.
- Cash compares by native currency and symbols keep exchange identity. Repeated comparisons are stable and leave the original statement and local ledger untouched.
