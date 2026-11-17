# FEAT-018 · ETF look-through and portfolio stress

First slice (LOOKTHROUGH-001) implemented on `feat/etf-look-through`, 2026-11-11 SGT. Extends IDEA-002. See the implementation status below.

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

## First slice — 2026-11-11 SGT (`LOOKTHROUGH-001`, branch `feat/etf-look-through`)

Selected by the user. Implemented and committed (`31e10ad`, rebased onto `main` on 2026-11-17); not merged or deployed:

- `shared/lookthrough.ts`: the calculation (issuer aggregation, share-class merge, one-level expansion, residuals, staleness at 45 days, rounding within 100.5% scaled to 100%) and `shockImpact`.
- `lib/holdings.ts` and `GET /api/exposure`: reads `<data dir>/etf-holdings/*.json` without writing; scoped to the request's account and book.
- Analytics panel LOOK-THROUGH · ISSUER EXPOSURE (layout B, stacked source bars, chosen by the user): scope line, mapped/unmapped reconciliation, fund legend with holdings dates, per-issuer detail with weights and dates, INVESTED / NET WORTH basis, what-if slider enabled only when totals reconcile.
- Synthetic fixtures in `test/fixtures/etf-holdings/` (made-up weights, labelled as such). No provider, fetcher or Kestrel tool yet.
