# Review checklist

What a reviewer (human, `/code-review`, or Claude Code Review) checks on a FinSight change. Run only the items
whose trigger matches the diff; most changes match three to six. Every item comes from a real defect or a
standing rule, named in its source column.

Tag each finding **Important** (wrong numbers, data loss, leaked data, a broken flow), **Nit**, or
**Pre-existing** (present before this change; don't blame the author).

## Items

| # | Trigger in the diff | Check | Source |
|---|---|---|---|
| 1 | A parser for broker or CSV input (`lib/csv.ts`, any import) | Numeric cells go through `parseNumberCell`. Grouped thousands, scientific notation and currency marks parse to the same value; malformed cells are rejected, never salvaged into other digits. | SWEEP-002 `csv.ts:74`, `:141` |
| 2 | Code that saves the store in more than one step (import, replace, reset, bulk edit) | Everything is validated before the first write. A refused change leaves the account byte-identical. | SWEEP-002 `portfolio.ts:623` |
| 3 | Sales, lots or cost basis | A dated operation only draws on lots held by its date. Realized P&L is costed from exactly the lots drawn. | SWEEP-002 `portfolio.ts:108` |
| 4 | A read or write that takes an account ID | An unknown or removed ID is an error (404), never a fallback to another account. | SWEEP-002 `store.ts:157` |
| 5 | Currency conversion, valuation or weights | A missing FX rate reaches every report as an explicit flag (portfolio, exposure, guardrails, Kestrel tools). Weights are not computed from a partial total. | SWEEP-002 `portfolio.ts:264` |
| 6 | A data file read from disk or a provider (ETF holdings, snapshots, records) | Types and calendar dates are validated at the boundary. A malformed entry is reported (for example as unmapped), not a crash of the whole request. | SWEEP-002 `lookthrough.ts:181`, `:93` |
| 7 | Ticker normalisation or aliases | Distinct listings are never merged; aliases apply only to identified instruments. | SWEEP-002 `lookthrough.ts:89` |
| 8 | A rule evaluated across holdings (guardrails, radar, alerts) | Every holding that meets the rule is reported, not only the largest. | SWEEP-002 `radar.ts:29` |
| 9 | A number shown to the user or returned by a Kestrel tool | It comes from deterministic code, never model arithmetic, and carries `asOf` or `retrievedAt`. | AGENTS.md §2.2, §4 |
| 10 | Files, fixtures, examples, logs | No personal holdings, keys, tokens or records. `agent:test` runs the secret scan. | AGENTS.md §2.1 |
| 11 | `web/src` | `public/app` is rebuilt (`check:web`). Panel order or layout changes re-check the 390px baselines. A change to a file in the `FILES` list of `public/sw.js` (such as `index.html` or `styles.css`) bumps `SHELL`; hashed `public/app` chunks don't need it. | HANDOFF, CHANGELOG |
| 12 | `agent/quant` | `quant:test` and `quant:verify` pass; engine logic changes also run `quant:verify -- --mutate`. | AGENTS.md §3 |
| 13 | Tests | No sleeps, no retry-until-pass, no assertion weakened to make a test pass. A retry may wrap only a harness action whose failure cause is measured, and never the assertion itself. Browser tests drive app timers with `page.clock` (`advanceClock`), not real waits. | `fix/e2e-drag-retry`, CI speed work |
| 14 | A behaviour-preserving refactor or migration | `npm run verify:diff` passes, or its allow file lists each intended difference. | Differential check |

## Keeping this list useful

- Change this file in its own pull request, never together with the code it judges.
- Add an item only for a miss that a reviewer could have seen in the diff: a reverted change, an audit finding,
  or the same review comment on two pull requests. Name the source.
- Remove an item when a type, lint rule or test now enforces it, or when it has stopped matching real changes.
