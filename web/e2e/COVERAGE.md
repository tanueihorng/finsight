# E2E coverage matrix

The behaviour contract for the migration. Every row has a passing spec on `main` against fake market data (P0-2). **Known bug** rows record today's behaviour without endorsing it. They use `test.fail()`, so they keep running, and the run reports them as "unexpectedly passed" once fixed; then flip them to `test()`.

Card = the migration card(s) that must keep the row green (`docs/frontend-migration/PLAN.md`). Projects: `chromium` (agent off), `agent` (fake agent), `sw` (service workers on a temp copy of the app).

| Area | Behaviour | Spec › test | Card(s) | Status |
|---|---|---|---|---|
| Startup | page loads and unlocks | `smoke` › loads / and unlocks | all | pass |
| Startup | island bundle loads, no page errors | `smoke` › the island bundle loads without errors | F1, F6 | pass |
| Startup | bootstrap.js runs before every legacy script | `smoke` › bootstrap.js runs before every legacy script | F1, F4, X1 | pass |
| Lock | wrong PIN error; right PIN unlocks | `baseline/lock` | F9 | pass |
| Lock | expired session locks, stops polling (no API calls for 16 s), keeps the typed PIN, unlock resumes | `baseline/session` | F3, F4, F9 | pass |
| Summary | net worth, day P/L, FX exposure values; UNPEEK blurs | `baseline/summary` | C1 | pass |
| Summary (PILOT-2) | React cards keep legacy values, sign colours and the cash-editor click | `PILOT-2` | C1 | pass |
| Fan-out (PILOT-2) | ADD, SELL, CASH, import, UNDO each update React summary + FX EXPOSURE, legacy positions, dividends and FX risk without reload | `PILOT-2` | C1, D1–D4, B3, C2 | pass |
| Fan-out (PILOT-2) | the open ledger refreshes after its own undo, with summary and positions | `PILOT-2` | D3, D4 | pass |
| Fan-out (PILOT-2) | account/base switch re-keys the summary; a held old-account response never shows (React and legacy) | `PILOT-2` | F3, F4, F8 | pass |
| Card editor (PILOT-2) | toggle, reorder, reset update the React summary and persist across reload | `PILOT-2` | C1 | pass (intended fix: a reordered NET WORTH no longer jumps back first after the first reload) |
| Positions | row count, sort by MKT VAL, search, group by currency | `baseline/positions` | D1 | pass |
| Positions (D1) | legacy cells, filter chips with %, sort marker, auto-selected first row, row click selects, selection elsewhere clears the highlight | `D1` › renders like legacy | D1, E1 | pass |
| Positions (D1) | filter scope line, no-match row, search/filter/sort/group/collapse persist across reload, sector groups from categories | `D1` › filter shows the scope line… | D1 | pass |
| Positions (D1) | All Accounts: "· 2 accts" label; group by account splits a symbol per account | `D1` › All Accounts… | D1 | pass |
| Positions (D1) | a new price flashes the row and records `lastPrices`; an unchanged refetch clears it | `D1` › a new price flashes… | D1 | pass |
| Positions (D1) | dragged to the right column it survives reload; a write made while locked shows after unlock | `D1` › dragged to the right column… | D1, F9, F10 | pass |
| Trades | ADD via command bar, UNDO restores | `baseline/add-sell` | F7, D3 | pass |
| Trades | SELL with a price (realized P/L), SELL at market | `baseline/trades` | F7, D1 | pass |
| Trades | row S button prompts for quantity and price | `baseline/trades` | D1 | pass |
| Trades | DEL command; row ✕ asks for confirmation (dismiss keeps, accept removes) | `baseline/trades` | F7, D1 | pass |
| Cash | CASH command sets/clears, net worth follows | `baseline/cash` | F7, D3, C1 | pass |
| Cash | cash editor auto-saves, net worth follows | `baseline/cash` | D3, C1 | pass |
| Ledger | lists buys, filter, edit price (avg cost follows), delete with confirm | `baseline/ledger` | D4, D1 | pass |
| Import | merge by default | `baseline/import-export` | D4 | pass |
| Import | replace; a symbol with no quote is still imported | `baseline/import-export` | D4 | pass |
| Export | download `portfolio.csv`, header and values | `baseline/import-export` | D4 | pass |
| Export | `csvCell` neutralises `= + - @` and quotes `, "` | `baseline/import-export` | D4 | pass |
| Accounts | add, switch (empty account), All Accounts, rename, delete | `baseline/accounts` | F8, D1 | pass |
| Accounts | slow response for the previous account must not overwrite the new one | `baseline/accounts` › a slow response… | F3, PILOT-2 | pass |
| Base currency | switch converts every value; persists after reload | `baseline/accounts` › switching base currency… | F8, C1, D1 | pass |
| Detail | clicking a position sets the detail title; chart canvas exists | `baseline/detail` | E1, E2 | pass |
| Chart | range buttons refetch history and move the active state | `baseline/chart` | E1 | pass |
| Chart | indicators: add RSI, hide it (`detailChart.cfg`) | `baseline/chart` | E2 | pass |
| Panels | markets, news (follows selection), calendar, dividends render | `baseline/panels` | A1, A2, A3, B3 | pass |
| Watchlist | add and remove | `baseline/panels` | B1 | pass |
| Alerts | add (status line, armed), remove | `baseline/panels` | B2 | pass |
| Layout | hide a panel in ⚙ Layout, persists after reload | `baseline/layout` | F8, F10 | pass |
| Layout | drag a panel to the other column, order persists, no duplicate panel | `baseline/layout-drag` | F10, PILOT-1 | pass |
| Themes | theme switch sets `data-theme`, persists | `baseline/themes` | F8 | pass |
| Failure | empty portfolio after CLEAR ALL: empty table, S$0.00, no errors | `baseline/failures` | C1, D1, D4 | pass |
| Failure | failing market feed: markets empty, rest of the page works | `baseline/failures` | A1 | pass |
| Markets (PILOT-1) | island renders groups, 4-decimal small prices, `upd` time, LIVE pill; row click selects | `PILOT-1` | A1 | pass |
| Markets (PILOT-1) | `MKT` refetches; drag to other column keeps the root, survives reload, one host, exactly 2 polls in 31 s | `PILOT-1` | A1, F10 | pass |
| Markets (PILOT-1) | hide/reload/unhide keeps content | `PILOT-1` | A1, F10 | pass |
| Markets (PILOT-1) | lock: no markets request for 16 s; unlock resumes | `PILOT-1` | A1, F3, F9 | pass |
| Markets (PILOT-1) | host removed → island unmounted, no further requests | `PILOT-1` | F6 | pass |
| Islands | protected API calls are refused while locked, even from an island mounting during the lock | `web/src/api/client.test.ts`, `baseline/session` | F3 | pass |
| Failure | holding with no quote: LAST falls back to the avg price | `baseline/failures` | D1 | pass |
| Narrow | 390 px wide: summary, positions, command bar, no horizontal scroll, no errors | `baseline/narrow` | all | pass |
| Kestrel | offline panel explains why (agent off) | `baseline/kestrel` | G1 | pass |
| Kestrel | send, stream, finish | `baseline/kestrel-stream.agent` | G1, G2 | pass |
| Kestrel | stop interrupts a running turn | `baseline/kestrel-stream.agent` | G1, G2 | pass |
| Kestrel | agent closes the stream: reconnects, no duplicated text | `baseline/kestrel-stream.agent` | G1 | pass |
| Kestrel | agent connection cut mid-stream: reconnects | `baseline/kestrel-stream.agent` | G1 (+ `lib/agentlink.js`) | pass |
| Kestrel | attachment uploaded and sent | `baseline/kestrel-stream.agent` | G2 | pass |
| Kestrel | dock ↔ side switch keeps the conversation | `baseline/kestrel-stream.agent` | G3 | pass |
| Service worker | precaches shell + manifest files, network-first update, offline shell | `baseline/upgrade.sw` | F1, H4, X1 | pass |

Not yet covered here, owned elsewhere: performance and visual comparisons (P0-5); chart replay, strategies, journal and drawings (add with E2); multi-chart grid (E2); Kestrel slash commands and model picker (G2); desktop notifications and alert beeps (B2).

## A2 · News migration

| Area | Behaviour | Spec › test | Card(s) | Status |
|---|---|---|---|---|
| News | selection, escaped headline text, publisher/age and safe external-link attributes | `A2` › headlines follow selection… | A2 | pass (legacy and React) |
| News | NEWS market override keeps detail selection; same-symbol NEWS/Q refresh | `A2` › NEWS without a symbol… | A2, E1, F7 | pass (legacy and React) |
| News | loading, empty, HTTP error; empty portfolio starts with market news | `A2` › loading…; an empty portfolio… | A2 | pass (legacy and React) |
| News | delayed previous-symbol response never overwrites current headlines | `A2` › intended fix (A2)… | A2 | pass (intended fix: account-independent symbol-keyed query + abort) |
| News | drag/reload, hide/reload, one host and one request per selection | `A2` › drag/reload… | A2, F10 | pass |
| News | no protected request while locked, unlock refreshes, unmount removes command subscriptions | `A2` › lock stops news requests… | A2, F3, F6 | pass |

| Macro (A3) | calendar anchors/company selection; WB/FRED controls and errors; manual partial-failure inflation; 15m poll; lock/unmount | `A3` | A3 | pass |

| Watchlist (B1) | search/pick/add/remove/command, error/empty rows, chart adapter and unmount | `B1` | B1, E2 | pass |

| Alerts (B2) | form/command/remove, chart overlay event, seed/dedup toast/beep/desktop mock, 30s poll and unmount | `B2`, `triggers.test` | B2, E2 | pass |

| Income/activity (B3) | forward/received/WHT, ADD/UNDO transactions, error/empty, account race, single 120s poll and unmount | `B3` | B3 | pass (intended stale-account fix) |

| FX risk (C2) | rates/history, multi/empty/error, shock/target/conversion, persistence/focus, one shared 120s poll/unmount | `C2`, `fxrisk.test` | C2 | pass |
