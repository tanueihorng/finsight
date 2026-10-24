# Frontend baseline — 2026-10-25 SGT

Measured at `31437a0` plus P0-5 test instrumentation, before F2–F6. Node 24.11.1, Playwright 1.64.0 Chromium, macOS arm64; fake market, nine demo holdings, SGD, authenticated session, service workers blocked, no CPU/network throttling. These local measurements describe the fixture workflow, not real provider latency.

Three observations per cell; medians below. Cold = browser cache cleared through CDP immediately before reload. Warm = next reload in the same browser context. Server caches are warm after seeding in both cases. First paint is Chromium's Paint Timing entry; first position is a MutationObserver mark at the first `#positions-body tr[data-sym]`, both measured from navigation start. Transfer counts all Script/Stylesheet requests through network idle using CDP `Network.loadingFinished.encodedDataLength` (includes HTTP headers/304 revalidations; cached bodies transfer zero). It excludes documents, JSON, fonts and source maps. Resource Timing's cached decoded-size fields returned zero and are not used as a byte estimate.

| Viewport | Browser cache | First paint (ms) | First position (ms) | JS + CSS transferred (bytes) |
|---|---|---:|---:|---:|
| 1600×1000 | cold | 36.0 | 36.1 | 529,973 |
| 1600×1000 | warm | 36.0 | 43.2 | 3,412 |
| 390×844 | cold | 20.0 | 33.7 | 529,973 |
| 390×844 | warm | 24.0 | 41.1 | 3,412 |

Reproduce: `npx playwright test perf.spec.ts visual.spec.ts --project=chromium --repeat-each=3`. Each performance test attaches raw metrics and per-asset transfer bytes; results are in `test-results/**/metrics.json` until the next test run. Timing is observational; no unstable speed threshold is imposed. The functional assertions require first paint, a recorded first row, loaded assets and nonzero cold transfer.

Eight committed visual snapshots cover summary, positions, markets and detail at both viewport sizes. Date fixed to 2026-10-25 04:00 UTC; live clock, market state, market update time and relative ages masked. Animations disabled for capture; maximum differing pixel ratio 0.002. Desktop summary and narrow detail manually inspected. Three consecutive comparisons passed with no snapshot update. These are platform-specific Chromium/darwin baselines; deliberate visual changes require review before updating snapshots.
