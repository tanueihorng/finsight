# Synthetic ETF holdings fixtures

Made-up constituent weights for FEAT-018 tests, E2E and demos. They are not issuer data
and must not be used as real exposure. Each file is one dated snapshot in the
`shared/lookthrough.ts` `HoldingsSnapshot` shape. FinSight reads user snapshots from
`<data dir>/etf-holdings/*.json`.
