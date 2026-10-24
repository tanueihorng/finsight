# FinSight frontend migration: React + TypeScript

| | |
|---|---|
| Status | Approved direction (2026-10-25). Plan v1. Phase 0 merged to main (2026-10-25); Phase 1 in progress (F1 done) |
| Goal | A sustainable, typed, component-based codebase with **no behaviour change for the user** |
| Stack decided | React 19 + TypeScript (frontend), esbuild (build, output committed), TanStack Query (server data), Zustand (UI state), CSS Modules + existing theme variables, Playwright (E2E), server moved to TypeScript (Node 24 runs `.ts` directly, as `agent/` does) |
| Written for | Implementing agents of any capability. Every task card is self-contained; **read only §0, §1 and your own card** |

---

## 0. Rules for every implementing agent (read first)

1. **Read only:** this §0, §1 (architecture), §2 (conventions) and **your task card**. Each card lists the exact legacy line ranges and files you need. Do not read other cards or unrelated files, to save tokens.
2. **Edit only the files your card owns.** Shared files have narrow, append-only rules (§2.5). If you need a change outside your files, stop and write it under "Blocked / needs" in your report.
3. **Behaviour must not change.** Same data, same labels, same keyboard shortcuts, same localStorage keys, same API calls. When in doubt, copy the legacy behaviour exactly.
4. **Before you finish, all of these must pass:**
   ```bash
   npm run typecheck && npm test && npm run build && npm run e2e
   ```
   Also check `git diff --stat`: only your files and the allowed registry lines may change.
5. **Work in your own git worktree/branch:** `mig/<card-id>` (e.g. `mig/A1-markets`). Never push to `main`. Never commit personal data (`data/`, `*.csv`, `agent-link.json`). The pre-commit guard enforces this.
6. **Commit message:** `mig(<card-id>): <what>`. Commits are authored by the repo owner's git identity. **No AI co-author trailers.**
7. **Report back** with: card id, files changed, tests added, the commands you ran and their results, and anything blocked. Keep it under 15 lines.
8. If a step fails twice, stop and report. Don't improvise architecture changes.

---

## 1. Target architecture

### 1.1 Strategy: "islands", then cutover (strangler pattern)
The page keeps working the whole time. Each legacy panel is replaced by a **React island**: a React root mounted into that panel's container. Its old code is deleted from `public/app.js`, and its old markup from `public/index.html`. When every panel is an island, Phase 4 swaps the whole page to one React app and deletes `app.js`.

**Why:** each step is small, shippable and testable, and different agents can work on different panels **in parallel without touching the same lines**.

### 1.2 Folder layout (after Phase 1)
```
finsight/
├── server.ts, lib/*.ts            # Phase 2: server in TypeScript (ESM)
├── shared/
│   └── types.ts                    # API types shared by server, web and agent
├── web/                            # React source (never served directly)
│   ├── tsconfig.json
│   ├── src/
│   │   ├── main.tsx                # island bootstrapper
│   │   ├── islands.ts              # REGISTRY: island id -> component (append-only)
│   │   ├── api/client.ts           # fetch wrapper (cookies, 401 -> lock, JSON errors)
│   │   ├── api/queries.ts          # TanStack Query hooks, one per endpoint (append-only)
│   │   ├── state/store.ts          # Zustand store bridged to legacy `state`
│   │   ├── ui/                     # shared primitives: Panel, PanelHead, Num, Money, Pct, Spark, Empty, Loading, ErrorLine
│   │   ├── features/<name>/        # one folder per migrated panel (owned by one card)
│   │   │   ├── <Name>Panel.tsx
│   │   │   ├── <Name>Panel.module.css
│   │   │   └── <name>.test.ts      # pure logic tests (node:test)
│   │   └── legacy/                 # typed wrappers for chart.js, indicators.js, strategies.js
│   └── e2e/                        # Playwright specs
├── public/
│   ├── index.html, styles.css      # theme variables stay global
│   ├── app/                        # BUILD OUTPUT (committed): main.js, main.css
│   └── app.js, chart.js, …         # legacy, shrinking each phase
└── scripts/build-web.mjs           # esbuild config
```

### 1.3 Data and state
- **Server data:** TanStack Query, one hook per endpoint in `api/queries.ts`. Polling intervals match today's (`public/app.js` lines 2096–2125):

  | Data | Interval |
  |---|---|
  | portfolio, markets, watchlist | 15 s |
  | alerts, detail | 30 s |
  | World Bank, FRED, calendar | 15 min |

  `refetchIntervalInBackground: false` replaces the "pause when the tab is hidden" logic.
- **UI state:** Zustand store with `selected` symbol, `base` currency, `account`, `peek`, `detailRange` and `theme`. **Bridge:** during the migration, legacy code and islands share it through `window.FinSightStore` (a vanilla Zustand store). Legacy code reads and writes it in place of its own `state` object (Phase 1 task F0).
- **Cross-island events:** for example "portfolio changed after a buy", which must refetch the portfolio. Use `queryClient.invalidateQueries(['portfolio'])`, exposed to legacy code as `window.FinSightBus.invalidate('portfolio')`.

### 1.4 Styling
- Theme variables (`--bg`, `--panel`, `--amber`, …) stay in `public/styles.css`. **Never hard-code colours.**
- Each component has a CSS Module (`*.module.css`). esbuild bundles them into `public/app/main.css`, with class names scoped automatically.
- Copy legacy rules for the panel you migrate into its module, then delete them from `styles.css` **only if no other selector uses them**. If unsure, leave them in place; Phase 5 cleans up.

### 1.5 Build
- `npm run build` runs esbuild: `web/src/main.tsx` → `public/app/main.js` + `main.css` (minified, sourcemap).
- `npm run dev` does the same in watch mode; refresh the browser to see changes.
- **The build output is committed**, so cloning and running `node server.ts` still works with no install. The pre-commit guard rebuilds and fails if `public/app/` differs from the source.
- FinSight's server keeps zero runtime dependencies. Frontend libraries are bundled into `public/app/main.js`.

---

## 2. Conventions

### 2.1 TypeScript
- `strict: true`; no `any` except at the legacy boundary, marked `// legacy-any`.
- API response types live in `shared/types.ts`. Never redefine them in components.
- File names: `PascalCase.tsx` for components, `camelCase.ts` for logic.

### 2.2 Components
- Function components and hooks only.
- One panel = one folder = one top-level `<XPanel/>`.
- Use `ui/Panel` for chrome. It renders the `panel` + `panel-head` markup that FinSight's drag/layout system expects, including `data-pid`.
- Formatting must use `ui/format.ts`, which is ported 1:1 from `app.js` lines 29–58 (money, pct, compact numbers, currency). **Never write new number formatting.**

### 2.3 Tests
- **Pure logic** (sorting, grouping, maths moved out of components): `node:test` files next to the code, run by `npm test`.
- **E2E:** each card adds or extends a Playwright spec, `web/e2e/<card-id>.spec.ts`, that proves its panel works. It runs against fake market data (task P0-2).

### 2.4 Accessibility and behaviour parity
Keep existing `id`s that tests or keyboard shortcuts rely on, and keep focus order and `aria-*` labels. Buttons stay `<button>`.

### 2.5 Shared files: the only allowed edits
| File | Allowed change |
|---|---|
| `web/src/islands.ts` | append one line: `'<island-id>': () => import('./features/<name>/<Name>Panel')` |
| `web/src/api/queries.ts` | append one hook for your endpoint (skip it if one already exists) |
| `shared/types.ts` | append types for your endpoint's response |
| `public/index.html` | replace **your panel's block only** with `<div class="panel" data-island="<island-id>"></div>` |
| `public/app.js` | delete **your section's line range only** (listed in your card), plus its calls in `boot()` and the polling block |
| `public/styles.css` | delete rules that only your panel used |

Merges then only conflict on appended lines, and those are trivial to resolve.

---

## 3. Phases and parallel lanes

```
Phase 0 (1 agent)  ──►  Phase 1 (1 agent)  ──►  Phase 3 lanes A–F in parallel (up to 6 agents)  ──►  Phase 4 (1 agent)  ──►  Phase 5
                                          └──►  Phase 2 server→TS (1 agent, in parallel with Phase 3)
```

| Phase | Cards | Parallel? | Suggested model | Size |
|---|---|---|---|---|
| 0 Safety net | P0-1, P0-2, P0-3 | sequential | strong | M |
| 1 Foundation | F1–F6 | sequential | strong | L |
| 2 Server → TS | S1, S2 | parallel with Phase 3 | medium | M |
| 3 Panels | A1–A3, B1–B3, C1–C3, D1–D4, E1–E2, G1–G3 | **yes, one agent per lane** | small for A/B, medium for C/D/G, strong for E | S–L each |
| 4 Cutover | X1, X2 | sequential, after all lanes | strong | M |
| 5 Hardening | H1–H3 | parallel | small/medium | S |

**Is parallel work feasible and more efficient? Yes, after Phase 1.** Panels are independent once the shared foundation (store, API client, Panel chrome, formatting, E2E fixtures) exists. Each card owns separate files, so 4–6 agents can work at once. Phases 0, 1 and 4 must be single-agent, because everything depends on them.

**Token efficiency:** a card points to exact line ranges, so an agent reads roughly 150–400 lines instead of the whole 2,200-line `app.js`.

**Merge order inside Phase 3:** any order. Rebase on `main` before merging; resolve appended registry lines by keeping both.

---

## 4. Task cards

> Card format. **Owns**: files you may create/edit. **Legacy**: what to read and later delete. **Do**: steps. **Done when**: acceptance criteria. **Tests**: what to add.

### Phase 0: Safety net (run first, single agent)

#### P0-1 · Playwright setup
- **Owns:** `package.json` (devDependencies and scripts), `playwright.config.ts`, `web/e2e/helpers.ts`.
- **Do:**
  1. Install `@playwright/test` (exact version, published at least 2 weeks ago) as a devDependency. Run `npx playwright install chromium`.
  2. In the config, the web server is `FINSIGHT_FAKE_MARKET=1 FINSIGHT_DATA_DIR=<tmp> PORT=8099 AGENT_AUTOSTART=0 node server.js`; baseURL is `http://127.0.0.1:8099`.
  3. `helpers.ts`: `unlock(page)` sets a PIN via `/api/auth/setup` on a fresh data dir, then logs in. `seed(page)` imports a fixture CSV through `/api/portfolio/import` (the same CSV as `scripts/demo.js` `DEMO_CSV`).
  4. Script: `"e2e": "playwright test"`.
- **Done when:** `npm run e2e` runs an empty smoke test that loads `/` and unlocks.

#### P0-2 · Deterministic fake market data
- **Owns:** `lib/fakemarket.js` (new), a minimal hook in `lib/market.js` (`fetchJson`/`yahooFetch` only), `test/fixtures/market/*.json`.
- **Do:** when `process.env.FINSIGHT_FAKE_MARKET === '1'`, the Yahoo, FRED, World Bank and Forex Factory fetches return fixtures from `test/fixtures/market/` (quotes, 2 years of daily bars per demo symbol, news, a calendar). Generate the bars deterministically (seeded sine walk; see `test/helpers.js` `dailyBars`). Unknown symbol → a 404-like response, same as today.
- **Done when:** with the env var set, the demo portfolio shows stable numbers across restarts and no network calls are made (verify with `NODE_DEBUG=` or by mocking global fetch to throw).

#### P0-3 · Baseline E2E specs: today's behaviour, recorded
- **Owns:** `web/e2e/baseline/*.spec.ts`.
- **Do:** one spec per area. Each asserts visible text and values, not pixels.
  1. **lock:** wrong PIN shows the error; the right PIN unlocks.
  2. **summary:** the cards show net worth, day P/L and FX exposure; UNPEEK blurs them.
  3. **positions:** row count, sort by MKT VAL, search filter, group by currency.
  4. **add/sell:** command bar `ADD AAPL 1 100`, then `UNDO` restores it.
  5. **detail:** click a position, the detail title changes, and the chart canvas exists.
  6. **panels:** markets, news, watchlist add/remove, alert add, calendar, dividends render.
  7. **layout:** hiding a panel in ⚙ Layout persists after reload.
  8. **kestrel:** the panel opens offline and shows the "not installed / offline" message (the agent is off in E2E).
  9. **themes:** switching theme changes the `data-theme` attribute.
- **Done when:** all baseline specs pass on current `main`. **These specs are the contract; later cards may not change them except to update selectors, with the reason stated in the commit message.**

### Phase 1: Foundation (single agent, after Phase 0)

#### F1 · Toolchain
- **Owns:** `package.json`, `scripts/build-web.mjs`, `web/tsconfig.json`, root `tsconfig.json` (for `shared/`), `.gitignore`, `.git/hooks/pre-commit` (append the build-drift check).
- **Do:**
  1. Install exact, at-least-2-weeks-old versions as devDependencies: `react`, `react-dom`, `@types/react`, `@types/react-dom`, `@tanstack/react-query`, `zustand`, `esbuild`, `typescript` (reuse the version in `agent/package.json`).
  2. In esbuild: entry `web/src/main.tsx`, `bundle`, `format: 'esm'`, `minify`, `sourcemap`, `loader: { '.module.css': 'local-css' }`, outdir `public/app`.
  3. Scripts: `build`, `dev` (watch), `typecheck` (`tsc -p web && tsc -p .`).
  4. In `index.html`, add `<link rel="stylesheet" href="/app/main.css">` and `<script type="module" src="/app/main.js"></script>` after `app.js`.
  5. In `sw.js`, add `/app/main.js` and `/app/main.css` to `FILES` and bump `SHELL`.
- **Done when:** the build produces both files, the page loads unchanged, and the baseline E2E passes.

#### F2 · Shared types
- **Owns:** `shared/types.ts`.
- **Do:** write types for the main endpoints, taken from real responses (run the server with fake market data and inspect the JSON): `Portfolio` (with `positions: Position[]`, `cash`, `summary`, `fx`, `fxMissing`), `Quote`, `HistoryPoint`, `Account`, `WatchItem`, `Alert`, `EventItem`, `DividendsReport`, `LedgerRow`. Match field names exactly to `lib/portfolio.js` lines 269–310.
- **Done when:** the types compile and are used by F3.

#### F3 · API client and query hooks
- **Owns:** `web/src/api/client.ts`, `web/src/api/queries.ts`, `web/src/main.tsx` (QueryClient provider).
- **Do:**
  1. `api<T>(path, init?)`: same-origin, cookies, JSON. On 401 it dispatches `window.dispatchEvent(new Event('finsight:locked'))`. Other non-2xx responses throw `ApiError {status, message}`.
  2. Hooks: `usePortfolio()`, `useMarkets()`, `useWatchlist()`, `useAlerts()`, with the intervals from §1.3, keyed by `base` and `account` from the store.
  3. `window.FinSightBus = { invalidate(key) }`.
- **Done when:** typed hooks exist, plus a unit test for client error mapping (mock fetch).

#### F4 · Store bridge
- **Owns:** `web/src/state/store.ts`, `public/app.js` lines 51–57 (`let state = {…}`) **only**.
- **Do:** create a vanilla Zustand store with `{selected, detailRange, base, account, peek, lastPrices}`, initialised from the same localStorage keys (`finsight-base`, `finsight-account`). Expose `window.FinSightStore`. In `app.js`, replace `let state = {...}` with a **Proxy** over `FinSightStore.getState()` that writes go through `setState`. That way every existing `state.x = y` keeps working, and islands re-render.
- **Done when:** the baseline E2E passes, and changing the base currency from legacy code updates a test island (see F6).

#### F5 · UI primitives and formatting
- **Owns:** `web/src/ui/*`.
- **Do:** port `app.js` lines 29–58 (formatting) to `ui/format.ts` with tests that compare outputs to the legacy functions for 20 sample values. Then build:
  - `Panel` (props: `pid`, `title`, `right?`, `children`);
  - `Num`, `Money` (base currency from the store, blurred when `peek`);
  - `Pct` (up/down colours);
  - `Spark` (SVG sparkline, ported from the legacy `sparkline()`);
  - `Empty`, `Loading`, `ErrorLine`.

  `Panel` must render `<div class="panel" data-pid>` + `.panel-head` + `.panel-title`, so the legacy drag/layout code (`app.js` 581–651) keeps working.
- **Done when:** format tests pass and `Panel` drags like the other panels in a manual check.

#### F6 · Island runtime + reference island (Clock)
- **Owns:** `web/src/main.tsx`, `web/src/islands.ts`, `web/src/features/clock/*`, the clock markup in `index.html`, `app.js` lines 60–69.
- **Do:** `main.tsx` finds every `[data-island]`, looks up the registry, lazily imports the component and renders it inside `<QueryClientProvider>`. It re-scans when legacy code adds nodes (MutationObserver). Migrate the **clock** (`app.js` 60–69, `#clock` in the topbar) as the worked example: identical text format, 1 s tick. Write `web/src/features/README.md`, a ten-step recipe that any lane follows (copy, port, register, delete legacy, test).
- **Done when:** the clock renders from React, the legacy clock code is deleted, and E2E passes. **This is the template every Phase 3 card follows.**

### Phase 2: Server → TypeScript (one agent, in parallel with Phase 3)

#### S1 · Convert lib/ and server to TypeScript ESM
- **Owns:** `server.js`→`server.ts`, `lib/*.js`→`lib/*.ts`, `package.json` (`"type": "module"`, scripts), `test/*.test.js`→`.ts`, `start.command`, `scripts/demo.js`, `~/FinSightData/start-finsight-personal.command` (**tell the owner**; it is outside the repo).
- **Do:**
  1. Rename files and convert `require`/`module.exports` to `import`/`export`.
  2. Use erasable TypeScript only (no enums, no parameter properties), as in `agent/`.
  3. Type function signatures with `shared/types.ts`.
  4. Keep behaviour byte-identical. Node 24 runs it with `node server.ts`.
- **Done when:** `npm test` (all 105+ tests), `npm run typecheck`, the baseline E2E and `npm run demo` all work.

#### S2 · Agent shares types
- **Owns:** `agent/src/tools/facts.ts` (types only).
- **Do:** import `Portfolio`/`Position` from `../../shared/types.ts` and replace the local `any` shapes. No logic change.
- **Done when:** `npm run agent:test` passes.

### Phase 3: Panels (parallel lanes; each card follows `web/src/features/README.md`)

> Every card: create `web/src/features/<name>/`, port the logic, register the island, replace the HTML block, delete the legacy line range and its `boot()`/polling calls, then add `web/e2e/<card>.spec.ts`. The baseline spec for that panel must still pass.

**Lane A · Read-only market panels** (small model is fine)
| Card | Panel | Legacy `app.js` lines | HTML block | Endpoint | Notes |
|---|---|---|---|---|---|
| A1 | World Markets | 1328–1360 | `#markets`, `#markets-time` | `/api/markets` | groups: indices, FX, crypto, commodities, rates |
| A2 | News | 1609–1630 | `#news`, `#news-sym` | `/api/news?symbol=` | follows `store.selected`; general news when nothing is selected |
| A3 | Econ Calendar + World Bank + FRED + Inflation | 360–422, 1361–1460 | `#calendar`, `#wb-*`, `#fred-*`, `#infl-*` | `/api/calendar`, `/api/worldbank`, `/api/fred` | 15 min polling; the Fed decision and dot-plot rows always show |

**Lane B · Lists and income** (small/medium model)
| Card | Panel | Legacy lines | HTML | Endpoint | Notes |
|---|---|---|---|---|---|
| B1 | Watchlist | 1498–1534 | `#watchlist`, `#watch-*` | `/api/watchlist*` | symbol search suggest; clicking a row sets `store.selected` |
| B2 | Price Alerts | 1535–1608 | `#alerts`, `#alert-*` | `/api/alerts*` | desktop notification and beep behaviour unchanged |
| B3 | Dividends + Recent Activity | 1461–1497 (+ the activity renderer inside 166–218) | `#dividends`, `#div-ttm`, `#activity` | `/api/dividends`, portfolio.transactions | withholding text unchanged |

**Lane C · Portfolio overview** (medium model)
| Card | Panel | Legacy lines | HTML | Endpoint | Notes |
|---|---|---|---|---|---|
| C1 | Summary cards + Peek + card customiser | 423–508 | `#summary`, `#peek-btn`, `#cards-modal` cards part | portfolio | card order/visibility keys unchanged |
| C2 | FX Risk | 219–359 | `#fxrisk`, `#fxr-spot` | `/api/fx-risk` | what-if slider, VaR, convert-now: maths moved to `fxrisk.ts` with unit tests |
| C3 | Analytics: performance, allocation, heatmap, net-worth breakdown | 1694–1969 | `#perf-*`, `#alloc-*`, `#heat*`, `#wealth-*` | `/api/portfolio/performance`, categories | chart maths to `.ts` with tests |

**Lane D · Positions and trading records** (medium model)
| Card | Panel | Legacy lines | HTML | Notes |
|---|---|---|---|---|
| D1 | Positions table | 694–867 | `#positions*`, `#pos-*` | filter/search/sort/group; selection sets `store.selected`; keep row flash animation |
| D2 | Add form + symbol search | 1086–1142 | `#add-*` | after a buy → `invalidate('portfolio')` |
| D3 | Undo + Cash editor | 868–983 | `#undo-btn`, `#cash-btn`, cash modal | |
| D4 | Ledger + CSV import/export | 984–1085, 1631–1693 | ledger modal, `#import-*`, `#export-btn` | keep `csvCell` formula-escaping |

**Lane E · Security detail + chart** (strong model; one agent for both cards)
| Card | Panel | Legacy lines | Notes |
|---|---|---|---|
| E1 | Detail header + ranges | 1143–1247 | `#detail-*`, `#ranges` |
| E2 | Chart host | 1248–1327 + `public/chart.js`, `chartgrid.js`, `journal.js` | **Do not rewrite `chart.js`.** Wrap it in `web/src/legacy/ChartHost.tsx` (create in `useEffect`, destroy on unmount, pass host hooks for trades/watchlist/multi-chart). Add `legacy/chart.d.ts` typings for the API used. Kestrel's page context reads `detailChart.cfg.strategy`: expose `window.detailChart` from the wrapper until G-lane migration |

**Lane F · Shell** (medium/strong model; runs **after** A–E have merged, because it owns the layout)
| Card | Part | Legacy lines | Notes |
|---|---|---|---|
| F7 | Command bar | 70–165 | all commands in README "Commands" table; status line |
| F8 | Topbar: account selector, base currency, profile, setup wizard, theme/font, layout editor | 509–580, 653–693, 1991–2126 | localStorage keys unchanged |
| F9 | PIN lock | 2127–end | brute-force messages unchanged |
| F10 | Layout system in React | 559–651 | panel show/hide + drag between columns, keys `finsight-panels`, `finsight-layout` |

**Lane G · Kestrel panel → React** (medium model; after F10)
| Card | Part | Source | Notes |
|---|---|---|---|
| G1 | Chat core (log, turn view, tool rows, status candles, markdown) | `public/agent-panel.js` (render + stream parts) | keep the XSS-safe markdown renderer as `md.ts` with tests (script/HTML payloads neutralised) |
| G2 | Composer: slash menu, attachments, model picker, page context | same file | |
| G3 | Side drawer + dock modes, width/height, collapse | same file + `agent-panel.css` | uses the F10 layout API; localStorage keys unchanged (`finsight-agent-*`) |

### Phase 4: Cutover (single agent, after all lanes)

#### X1 · One React app
- **Do:** create `web/src/App.tsx`, which renders the whole page (topbar, grid, columns, modals) from components. `index.html` shrinks to `<div id="root">` plus scripts. Delete `public/app.js`, the store bridge Proxy and `window.FinSight*` globals (keep `window.detailChart` only if `chart.js` still needs it). Update `sw.js` `FILES`.
- **Done when:** all baseline and lane E2E specs pass, and `app.js` and `agent-panel.js` are gone.

#### X2 · Remove dead CSS and legacy assets
- **Do:** delete unused rules from `styles.css` (search selectors in `web/src`), and remove legacy JS files no longer referenced (`chart.js` stays, as a typed legacy module).

### Phase 5: Hardening (parallel)
- **H1 · Performance budget:** `public/app/main.js` ≤ 250 KB minified. Lazy-load heavy panels (analytics, chart, Kestrel). Measure first paint before and after; it must not get slower.
- **H2 · Docs:** update README "Tech stack" and "Project structure", `DOCS.md` architecture, and `docs/architecture.svg` labels.
- **H3 · Accessibility pass:** keyboard reachability of every control, focus rings, `aria` on custom widgets; extend E2E with axe checks (`@axe-core/playwright`).

---

## 5. Risks and mitigations
| Risk | Mitigation |
|---|---|
| Hidden coupling through legacy globals (`state`, `accountsCache`, `lastPrices`, `detailChart`) | F4 Proxy bridge, then delete per lane. Cards list the globals they touch; X1 removes the rest |
| Two agents edit the same lines | §2.5 shared-file rules; one lane per area; registry files are append-only |
| Behaviour drift | Baseline E2E (P0-3) is the contract, plus per-lane specs and fake market data for deterministic values |
| Build output drifts from source | the pre-commit hook rebuilds and diffs `public/app/` |
| Bundle grows | H1 budget; lazy imports per island |
| The canvas chart breaks | not rewritten; wrapped with a lifecycle (E2) |
| Personal data leaks into the public repo | existing pre-commit guard; E2E uses temp data dirs and fixtures only |

## 6. Rollback
Each card is one branch and one merge commit. `git revert <merge>` restores the legacy panel, because the legacy code is only deleted inside that same commit.

## 7. Progress tracker
| Card | Lane | Status | Branch | Agent | Notes |
|---|---|---|---|---|---|
| P0-1 | 0 | done (merged 2026-10-25) | mig/P0-safety-net | Claude | @playwright/test 1.64.0; `npm run e2e` |
| P0-2 | 0 | done (merged 2026-10-25) | mig/P0-safety-net | Claude | `lib/fakemarket.js` replaces global fetch; non-loopback hosts blocked |
| P0-3 | 0 | done (merged 2026-10-25) | mig/P0-safety-net | Claude | 9 baseline specs, 36/36 over 3 repeats |
| F1 | 1 | done (not merged) | mig/F1-toolchain | Claude | CSS Modules via `scripts/css-modules.mjs` (names `fs-<File>-<hash>_<class>`), not esbuild `local-css`: its minified names (`.r`) collide with legacy classes. React + Query alone bundle to ~250 KB minified (79 KB gz), the H1 budget |
| F2–F6 | 1 | todo | | | |
| S1, S2 | 2 | todo | | | |
| A1–A3 | A | todo | | | |
| B1–B3 | B | todo | | | |
| C1–C3 | C | todo | | | |
| D1–D4 | D | todo | | | |
| E1–E2 | E | todo | | | |
| F7–F10 | F | todo | | | |
| G1–G3 | G | todo | | | |
| X1–X2 | 4 | todo | | | |
| H1–H3 | 5 | todo | | | |
