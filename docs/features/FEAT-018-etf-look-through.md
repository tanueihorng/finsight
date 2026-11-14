# FEAT-018 · ETF look-through and portfolio stress

First slice implemented in the `feat/etf-look-through` worktree, 2026-11-11 SGT. Extends IDEA-002. The worktree records it as LOOKTHROUGH-001. See the implementation status below.

## User outcome

See the portfolio's combined exposure to an issuer across direct positions and funds, and see which positions contributed to that exposure. FinSight already has account-scoped portfolio weights and an individual fund profile. The fund profile's aggregator can return undated top holdings, so those rows cannot establish complete dated portfolio coverage.

## First release

- Start with a local import of dated constituent snapshots for a small set of US equity ETFs. Each snapshot records fund and constituent identifiers, weights, holdings date, retrieval date and source. Verify an issuer's actual schema, availability and terms before adding a fetcher.
- Add an exposure view in Analytics. For each issuer, show direct, indirect and combined exposure in base currency and as a share of the selected portfolio basis. Open a row to see the contributing funds and their holdings dates. Keep account and book scope visible.
- Report mapped and unmapped exposure, with stale and unsupported coverage visible. An unresolvable issuer stays unmapped. Fund residuals and unsupported assets retain their original portfolio value. Preserve existing exposure views and their denominators.
- Once totals reconcile, let a user enter a hypothetical shock to one issuer and see the estimated portfolio impact. Compute the shock on combined mapped exposure once and state the coverage and static-weight assumption. A read-only Kestrel tool can reuse the same calculation after the UI is verified.

## Acceptance

- A synthetic account with one direct holding and two overlapping ETFs aggregates all three contributions to a single issuer. Independently check the aggregate, shock result and mapped-plus-unmapped reconciliation with the original scope.
- A partial or stale file, issuer ambiguity, a fund held inside another fund and an unsupported position each leave visible residual exposure. V1 expands one level.
- Snapshots are reproducible and tagged with their actual holdings date. Changing the selected account or book recomputes the scope and cannot show rows from the previous scope.
- The workflow is read-only with respect to positions, policy, and orders. It works with synthetic holdings and imported fixture files before a live source is qualified.

## Implementation status

The worktree implements local dated JSON snapshots, `GET /api/exposure`, the Analytics issuer exposure panel, and the single-issuer shock slider. The panel shows each contributing fund and its holdings date, plus coverage and reconciliation. The targeted engine, API and view-model tests pass on synthetic fixtures. Live issuer data and Kestrel integration are future work. The implementation was uncommitted on top of `117e89c` when checked.
