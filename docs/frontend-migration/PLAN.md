# FinSight frontend migration: React + TypeScript

| | |
|---|---|
| Status | **Plan v2 (2026-10-25)**, revised after the plan audit (`harness/runs/20261025-FRONTEND-AUDIT-8a6d80f1/AUDIT.md`). **Phases 0–6 are complete and merged** (Phases 0–5 audited 2026-10-26, gate green; Phase 6 merged in `e63e50f`, full verify green on main). Rollback point before Phase 6: local tag `mig-lkg-phase6` (`60f6837`). v1 is in git history (`6d9a740`) |
| Goal | A sustainable, typed, component-based codebase with **no behaviour change for the user** |
| Stack decided | React 19 + TypeScript (frontend), esbuild (build, output committed), TanStack Query (server data), Zustand (UI state), CSS Modules (scoped by our plugin) + existing theme variables, Playwright (E2E). The server moves to TypeScript **last**, as its own migration (Phase 6) |
| Written for | Implementing agents of any capability. Every task card is self-contained; **read §0–§2 and your own card** |

### What changed from v1
1. **Startup contract (§1.6).** A classic `bootstrap.js` runs before every legacy script and owns `window.FinSight`; the module bundle runs after legacy code. v1's store bridge would have broken startup.
2. **DOM ownership (§1.7).** The legacy layout keeps owning each `.panel` element; React mounts *inside* it. v1 nested a React `.panel` inside a placeholder `.panel`, which breaks drag and saved layouts.
3. **Auth, polling and refresh contract (§1.3).** Query defaults are set to match legacy behaviour, queries stop while locked, and one mutation → invalidation map covers every affected view.
4. **Coupling inventory before deletion (I1).** Panel cards list the callers outside their own section that they must fix. Line numbers are hints; named symbols at a baseline commit are authoritative. "Merge in any order" is withdrawn until pilots prove it.
5. **Two pilots gate the panel lanes (Phase 1.5).** One real draggable read-only panel; one portfolio consumer plus a mutation that must update every affected view.
6. **Broader safety net (P0-4, P0-5).** A coverage matrix with the missing scenarios (SELL, cash, import/export, accounts, drag, chart, session expiry, agent streaming, service-worker upgrade, narrow layout) and a performance/visual baseline.
7. **Build delivery.** Code splitting is on, a manifest drives the service-worker cache, and a **tracked** check (`npm run check:web`, also in `npm test`) replaces reliance on a local git hook.
8. **Server → TypeScript moved to Phase 6**, after cutover, with a full launcher inventory.
9. **Rollback (§6)** now distinguishes merge commits from fast-forwards and states dependent rollback order.
10. **Bundle budget (H1)** is now based on a measurement, not 250 KB for `main.js` alone (React + Query already take ~250 KB minified).

---

## 0. Rules for every implementing agent (read first)

1. **Read only:** §0, §1, §2 and **your task card** (plus your section in `COUPLING.md` once I1 exists). Do not read other cards or unrelated files, to save tokens.
2. **Edit only the files your card owns**, plus the caller edits your card lists. Shared files have narrow, append-only rules (§2.5). If you need anything else, stop and write it under "Blocked / needs" in your report.
3. **Behaviour must not change.** Same data, labels, keyboard shortcuts, localStorage keys, API calls and refresh cadence. When in doubt, copy the legacy behaviour exactly. Any intended difference must be labelled in the card and the commit message.
4. **Before you finish, this must pass on Node 24:**
   ```bash
   npm run verify   # typecheck + unit tests (incl. build drift) + check:web + e2e
   ```
   Also check `git diff --stat`: only your files, your listed caller edits and the allowed registry lines may change.
5. **Work in your own git worktree/branch:** `mig/<card-id>` (e.g. `mig/A1-markets`). Never push. Never commit personal data (`data/`, `*.csv`, `agent-link.json`).
6. **Commit message:** `mig(<card-id>): <what>`. Commits use the repo owner's git identity. **No AI co-author trailers.** Merge to `main` with `--no-ff` (one merge commit per card, see §6), only when the owner says so.
7. **Report back** with: card id, files changed, tests added, commands run and their results, anything blocked. Under 15 lines.
8. If a step fails twice, stop and report. Don't improvise architecture changes.
9. **No parallel agents** unless the owner explicitly authorises delegation for that phase.

---

## 1. Target architecture

### 1.1 Strategy: "islands", then cutover (strangler pattern)
The page keeps working the whole time. Each legacy panel's *content* is replaced by a **React island**: a React root mounted inside that panel's existing host element (§1.7). Its old code is deleted from `public/app.js`, and its old body markup from `public/index.html`, **after** the callers listed for it in `COUPLING.md` are redirected. When every panel is an island, Phase 4 swaps the whole page to one React app and deletes `app.js`.

**Why:** each step is small, shippable and testable. Parallel work is possible only once the shared contracts (§1.3, §1.6, §1.7) and the two pilots (Phase 1.5) have held.

### 1.2 Folder layout (after Phase 1)
```
finsight/
├── server.js, lib/*.js             # unchanged until Phase 6
├── shared/
│   └── types.ts                    # API types shared by web (and later server/agent)
├── web/                            # browser source (never served directly)
│   ├── tsconfig.json               # app code; tsconfig.test.json for *.test.ts
│   ├── src/
│   │   ├── package.json            # {"type":"module"} so node:test runs *.test.ts
│   │   ├── bootstrap.ts            # classic script: window.FinSight (store, bus, auth)
│   │   ├── main.tsx                # module: island runtime, QueryClient
│   │   ├── islands.ts              # REGISTRY: island id -> lazy component (append-only)
│   │   ├── api/client.ts           # fetch wrapper (cookies, AbortSignal, 401 -> lock, JSON errors)
│   │   ├── api/queries.ts          # TanStack Query hooks, one per endpoint (append-only)
│   │   ├── api/invalidation.ts     # mutation -> query keys map (append-only)
│   │   ├── state/store.ts          # Zustand vanilla store (created in bootstrap)
│   │   ├── ui/                     # primitives: PanelBody, PanelHeadSlot, Num, Money, Pct, Spark, Empty, Loading, ErrorLine, IslandBoundary
│   │   ├── features/<name>/        # one folder per migrated panel (owned by one card)
│   │   │   ├── <Name>Island.tsx
│   │   │   ├── <Name>.module.css
│   │   │   └── <name>.test.ts      # pure logic tests (node:test, explicit .ts imports)
│   │   └── legacy/                 # typed wrappers for chart.js, indicators.js, strategies.js
│   └── e2e/                        # Playwright specs (baseline/ is the contract)
├── public/
│   ├── index.html, styles.css      # theme variables stay global
│   ├── app/                        # BUILD OUTPUT (committed): bootstrap.js, main.js/.css, chunks/, manifest.json
│   └── app.js, chart.js, …         # legacy, shrinking each phase
└── scripts/build-web.mjs           # esbuild config (+ css-modules.mjs plugin)
```

### 1.3 Data, auth and refresh contract
**Query client defaults** (in `main.tsx`), chosen to match legacy behaviour:

| Option | Value | Why |
|---|---|---|
| `retry` | `false` | legacy code never retries; avoids retry storms while locked |
| `refetchOnWindowFocus`, `refetchOnReconnect` | `false` | legacy refreshes only on its timers and on explicit actions |
| `refetchIntervalInBackground` | `false` | replaces legacy "pause when hidden" |
| `staleTime` | the query's own interval | no extra refetch on mount |
| `enabled` | `auth.unlocked && store.accountReady` (plus the query's own conditions) | nothing runs while locked or before accounts load |

**Polling cadence** (must match `app.js` `startPolling()` and the panel loaders; check against `COUPLING.md`):

| Data | Interval / trigger |
|---|---|
| portfolio, markets, watchlist | 15 s |
| alerts, detail | 30 s |
| FX risk, dividends | when holdings change, else every 120 s |
| World Bank, FRED, calendar | 15 min |

**Query keys** include every parameter that changes the response (`base`, `account`, symbol, range, interval, benchmark…). `queryFn` passes Query's `AbortSignal` to `fetch`. Use v5 syntax: `queryClient.invalidateQueries({ queryKey: ['portfolio'] })`.

**Auth lifecycle.** `window.FinSight.auth` holds `{ unlocked }` and emits `finsight:locked` / `finsight:unlocked`.
- Legacy `showLock()` and `showApp()` set it (F4 caller edit). The API client's 401 handler sets it too. Either side can lock; both sides react.
- On lock: `queryClient.cancelQueries()` and all queries become disabled. Cached data stays in memory but the lock screen covers it, the same as today. On unlock: `invalidateQueries()` refreshes everything.
- A PIN being typed must never be wiped by a re-entrant lock (legacy rule in `showLock`).

**Mutations and refresh.** `api/invalidation.ts` maps each write to the queries it affects. `window.FinSight.bus.invalidate(key)` invalidates Query **and** calls any legacy refreshers registered with `bus.on(key, fn)`, so un-migrated panels still refresh. Starting map (I1 completes it):

| Write | Invalidates |
|---|---|
| buy, sell, delete, import, undo, ledger edit/delete, reset | portfolio, dividends, fx-risk, performance, wealth, ledger, realized, accounts, chart-trades, events |
| cash | portfolio, fx-risk, wealth |
| watchlist add/remove | watchlist, chart watch overlay |
| alerts add/update/remove | alerts, chart alert overlay |
| account add/rename/remove/switch | accounts, then everything keyed by account |
| base change | everything keyed by base |

**Server data lives in Query only.** Zustand holds UI state. Do not copy fetched portfolios into the store.

### 1.4 Styling
- Theme variables (`--bg`, `--panel`, `--amber`, …) stay in `public/styles.css`. **Never hard-code colours.**
- Component styles go in `*.module.css`. `scripts/css-modules.mjs` renames each class to `fs-<File>-<hash>_<class>`, so names cannot collide with legacy global classes (esbuild's own `local-css` minifies to names like `.r`, which do collide). Plain class selectors only: no `:global()` and no `composes`.
- Global classes required by the legacy layout and chart code (`.panel`, `.panel-head`, `.draggable-block`, `.grip`, …) stay global, and React uses them by name where needed.
- Copy legacy rules for the panel you migrate into its module. Delete them from `styles.css` **only if no selector in any retained file uses them**: search `public/*.js` and `web/src`, not just `web/src`. If unsure, leave them for X2.

### 1.5 Build and delivery
- `npm run build` runs `scripts/build-web.mjs` and produces two outputs:
  - `web/src/bootstrap.ts` → `public/app/bootstrap.js` (IIFE).
  - `web/src/main.tsx` → `public/app/main.js` + `main.css` (ESM, **code splitting on**: lazy islands become `public/app/chunks/*.js`).

  It also writes `public/app/manifest.json`, which lists every runtime file. `npm run dev` does the same in watch mode.
- **The build output is committed**, so cloning and running `node server.js` works with no install. The tracked gate is `npm run check:web` (also run by `test/webbuild.test.js` inside `npm test`). It compares `public/app` byte-for-byte with an in-memory build and reports missing, stale and outdated files. The local pre-commit hook calls the same check as a convenience; it is not the guarantee.
- **Service worker:** `sw.js` precaches the static files plus everything in `manifest.json`, and stays network-first. Bump `SHELL` whenever the set of files changes. H4 adds pruning of old chunks and an upgrade test.
- FinSight's server keeps zero runtime dependencies. Frontend libraries are dev dependencies bundled into `public/app`. Versions are pinned exactly with a lockfile. "At least two weeks old" is a policy heuristic, not proof of compatibility; the tested combination is what counts.

### 1.6 Startup contract
Script order in `index.html`, enforced by `web/e2e/smoke.spec.ts`:

```
<script src="/app/bootstrap.js">          classic, synchronous: creates window.FinSight
<script src="/indicators.js"> … "/app.js"   legacy: app.js boots the page (checkAuth → boot)
<script type="module" src="/app/main.js">  runs after all classic scripts: mounts islands
<script src="/agent-panel.js">             legacy Kestrel
```

- `window.FinSight` (typed in `bootstrap.ts`) is the only shared global. F1 provides `{ contract, islandsReady, markIslandsReady }`. F3 adds `bus`, F4 adds `store` and `auth`. Each field is created in `bootstrap.ts`, never in `main.tsx`, so legacy code can rely on it at load.
- **Legacy code must never need `main.js` to start.** Islands are additive: if `main.js` fails to load, every legacy panel still works.
- The store bridge (F4) replaces `let state = {…}` with a Proxy that reads `FinSight.store.getState()` **on every property access** and writes through `setState`. Nested writes (`state.lastPrices[sym] = …`) do not trigger updates through a top-level Proxy. They must go through an explicit setter (`setLastPrice(sym, v)`), and F4 lists those call sites.
- `main.js` calls `FinSight.markIslandsReady()` once its runtime is set up (event `finsight:islands-ready`).

### 1.7 DOM ownership contract
- **The legacy layout owns the panel host.** Each panel stays one direct child of its column: `<div class="panel" data-pid="…">`, with its `.panel-head` markup in `index.html`. The layout code (`initDragLayout`, `saveLayout`, `applyLayout`, `applyPanels` in `app.js`) keeps adding grips, ordering, hiding and drag to it, unchanged until F10.
- **React owns only a body node inside the host:** `<div data-island="<id>"></div>` replaces the panel's legacy body markup. Header controls that React must render go into a `<span data-island-slot="<id>:head">` in the legacy head, filled with `createPortal` from the same island.
- `ui/PanelBody` renders body content only. **There is no React `Panel` that renders `.panel`** until F10 moves layout to React.
- **Runtime (F6):** mount on `[data-island]` nodes as they appear. A host that is *moved* (drag) keeps its root, so never remount on move. Check `isConnected` after a microtask before unmounting. A host that is removed is unmounted with `root.unmount()`. Each island is wrapped in `IslandBoundary` (error boundary + `ErrorLine`), so one failing island or chunk does not affect others.
- Layout registration must be idempotent. Because hosts exist in `index.html` at load, grips and saved order apply before islands mount, which removes the late-mount race.

---

## 2. Conventions

### 2.1 TypeScript
- `strict: true` and `noUncheckedIndexedAccess`; no `any` except at the legacy boundary, marked `// legacy-any`.
- API response types live in `shared/types.ts`, derived from the **server producers** (including nullable and error variants), not only from happy-path fixtures. `api<T>` is a compile-time assertion, not runtime validation.
- File names: `PascalCase.tsx` for components, `camelCase.ts` for logic.

### 2.2 Components
- Function components and hooks only.
- One panel = one folder = one top-level `<XIsland/>` rendering into its `data-island` body node (§1.7).
- Formatting must use `ui/format.ts`, ported 1:1 from `app.js` (`fmt`, `fmtBig`, `money`, `moneyBig`, `moneySigned`, `csym`, `signStr`). **Never write new number formatting.**

### 2.3 Tests
- **Pure logic:** `web/src/**/*.test.ts` next to the code, using `node:test`. Run by `npm test`; import with explicit `.ts` extensions, with no CSS or DOM imports.
- **E2E:** each card adds `web/e2e/<card-id>.spec.ts` covering its rows in the coverage matrix (`web/e2e/COVERAGE.md`, P0-4). It runs against fake market data. **Baseline specs are the contract**: later cards may only change selectors, with the reason stated in the commit message.
- Selectors stay independent of the outcome being checked: don't select by the value you assert.

### 2.4 Accessibility and behaviour parity
Keep existing `id`s that tests or keyboard shortcuts rely on, and keep focus order and `aria-*` labels. Buttons stay `<button>`.

### 2.5 Shared files: the only allowed edits
| File | Allowed change |
|---|---|
| `web/src/islands.ts` | append one line: `'<island-id>': () => import('./features/<name>/<Name>Island.tsx')` |
| `web/src/api/queries.ts` | append one hook for your endpoint (skip if one exists) |
| `web/src/api/invalidation.ts` | append rows for writes your card adds |
| `shared/types.ts` | append types for your endpoint's response |
| `public/index.html` | replace **your panel's body markup only** with `<div data-island="<id>"></div>` (and a head slot if needed); never the `.panel` host |
| `public/app.js` | delete **your section's named functions only** (as listed in `COUPLING.md` at the baseline commit), plus the caller edits listed for your card |
| `public/styles.css` | delete rules that only your panel used (search all retained files) |

---

## 3. Phases and gates

```
Phase 0 safety net ─► Phase 1 foundation ─► Phase 1.5 inventory + pilots ─► GATE ─► Phase 2 panel lanes A–E ─► Phase 3 shell F7–F10 ─► Kestrel G1–G3 ─► Phase 4 cutover ─► Phase 5 hardening ─► Phase 6 server → TS
   P0-1..5            F1..F6                   I1, PILOT-1, PILOT-2                  (A–E after gate)          (after A–E merged)    (after F10)
```

| Phase | Cards | Parallel? | Suggested model | Size |
|---|---|---|---|---|
| 0 Safety net | P0-1–P0-3 (done), P0-4, P0-5 | sequential | strong | M |
| 1 Foundation | F1 (done) – F6 | sequential | strong | L |
| 1.5 Inventory + pilots | I1, PILOT-1, PILOT-2 | sequential | strong | M |
| 2 Panels | A1–A3, B1–B3, C2–C3, D1–D4, E1–E2 | only after the gate, only if delegation is authorised; dependent cards follow `COUPLING.md` order | small for A/B, medium for C/D, strong for E | S–L |
| 3 Shell + Kestrel | F7–F10, then G1–G3 | sequential (they own layout) | medium/strong | M–L |
| 4 Cutover | X1, X2 | sequential | strong | M |
| 5 Hardening | H1–H4 | parallel if authorised | small/medium | S |
| 6 Server → TS | S1, S2 | single agent, after X1 | medium | M |

**The gate before Phase 2:** both pilots merged, `npm run verify` green, and the pilot E2E proofs pass (drag, hide, reload, lock/unlock, one subscription, mutation fan-out). Only then are lanes treated as independent. The merge order inside a lane follows `COUPLING.md` dependencies.

---

## 4. Task cards

> Card format. **Owns**: files you may create/edit. **Callers**: edits outside your files that you must make (from `COUPLING.md`). **Do**: steps. **Done when**: acceptance criteria. **Tests**: what to add.

### Phase 0: Safety net

#### P0-1 · Playwright setup — done
`playwright.config.ts`, `web/e2e/helpers.ts` (`ensurePin`, `unlock`, `seed`). Throwaway server on :8099, `FINSIGHT_FAKE_MARKET=1`, temp data folder, `AGENT_AUTOSTART=0`, `AGENT_URL` pointing at a closed port.

#### P0-2 · Deterministic fake market data — done
`lib/fakemarket.js` replaces global `fetch` when `FINSIGHT_FAKE_MARKET=1`. Yahoo, FRED, World Bank and Forex Factory answer from `test/fixtures/market/`; loopback passes through; any other host is blocked.

#### P0-3 · Baseline E2E specs — done
`web/e2e/baseline/*.spec.ts`: lock, summary + peek, positions, ADD/UNDO, detail, panels, layout (hide), Kestrel offline, themes.

#### P0-4 · Coverage matrix and missing scenarios
- **Owns:** `web/e2e/COVERAGE.md`, `web/e2e/baseline/*.spec.ts` (new files only), `web/e2e/helpers.ts` (append), `test/fixtures/agent/*` and a fake agent server for E2E (`web/e2e/fake-agent.mjs`).
- **Do:**
  1. `COVERAGE.md`: one row per behaviour, with columns for its spec and the card that must keep it green.
  2. Add baseline specs for:
     - SELL with and without price, and DEL with its confirm dialog;
     - CASH edit;
     - CSV import (replace and merge) and export, including `csvCell` formula escaping;
     - account add, switch and rename, and base currency switch (values convert, and a delayed response for the old account must not overwrite the new one);
     - cross-column drag, then reload (order kept);
     - chart range change and indicator toggle (canvas exists, range label);
     - ledger edit and delete;
     - session expiry (server restarted / cookie cleared): the lock appears, protected polling stops (no repeated 401s in the network log), the typed PIN is kept, and unlock resumes;
     - Kestrel streaming against the fake agent: send, stream, cancel, reconnect, attachments, dock/side switch;
     - empty and failure cases (empty portfolio, a market fetch failing, a manual asset with no quote);
     - a narrow viewport (≤ 820 px) smoke test.
  3. A service-worker-enabled project (`serviceWorkers: 'allow'`) with an upgrade test: load, change a file, reload, and the new version is served.
- **Done when:** every row in `COVERAGE.md` has a passing spec on current `main`.

#### P0-5 · Performance and visual baseline
- **Owns:** `web/e2e/perf.spec.ts`, `web/e2e/visual.spec.ts` + snapshots, `docs/frontend-migration/BASELINE.md`.
- **Do:** record, under fixed conditions (Chromium, 1600×1000 and 390×844, cold and warm cache, fake market), first paint, time to the first positions row, and the total transferred JS/CSS. Add a small set of screenshot comparisons (summary, positions, markets, detail) with a tolerance that ignores the live clock.
- **Done when:** `BASELINE.md` has the numbers and the visual spec passes three times in a row.

### Phase 1: Foundation (single agent)

#### F1 · Toolchain — done (with audit fixes)
Two esbuild builds (`bootstrap.js` IIFE; `main.js` ESM with splitting), `manifest.json`, scoped CSS Modules plugin, `typecheck` (web, web tests, root), `check:web` + `test/webbuild.test.js`, colocated `*.test.ts` in `npm test`, `npm run verify`, `index.html` startup order, `sw.js` manifest precache (shell v13). E2E proves bootstrap runs before any legacy script.

#### F2 · Shared types
- **Owns:** `shared/types.ts`.
- **Do:** write types for the main endpoints from the **server producers** (`lib/portfolio.js` `portfolioWithQuotes` and helpers, `lib/dividends.js`, `lib/ledger.js`, `lib/market.js` `normalizeQuote` and `getHistory`, `server.js` route shapes), checked against real responses from the fake-market server. Include nullable fields, `error` variants (e.g. a quote with `error`), `fxMissing` and manual assets. Types: `Portfolio`, `Position`, `Summary`, `Quote`, `HistoryPoint`, `Account`, `WatchItem`, `Alert`, `EventItem`, `DividendsReport`, `LedgerRow`, `ApiErrorBody`.
- **Done when:** the types compile; F3 uses them; a short comment on each type names its producer.

#### F3 · API client, query hooks and bus
- **Owns:** `web/src/api/client.ts`, `web/src/api/queries.ts`, `web/src/api/invalidation.ts`, `web/src/main.tsx` (QueryClient with §1.3 defaults), and `bootstrap.ts` (append the `bus` field).
- **Do:**
  1. `api<T>(path, { signal, ...init })`: same-origin, cookies, JSON. On 401 it calls `FinSight.auth.lock()` (F4; until then dispatch `finsight:locked`). Other non-2xx responses throw `ApiError {status, message}`.
  2. Hooks `usePortfolio()`, `useMarkets()`, `useWatchlist()`, `useAlerts()`, with the §1.3 intervals, keys and `enabled` rules.
  3. `FinSight.bus = { invalidate(key), on(key, fn) }`. `invalidate` calls `invalidateQueries({ queryKey: [key] })` once Query exists, plus every legacy refresher registered for that key.
- **Done when:** typed hooks exist, plus unit tests for error mapping, 401 → lock, abort propagation and the bus calling legacy refreshers (mock fetch).

#### F4 · Store bridge and auth state
- **Owns:** `web/src/state/store.ts`, `bootstrap.ts` (append the `store` and `auth` fields).
- **Callers:** `public/app.js` `let state = {…}` (→ Proxy), every nested `state.lastPrices[...] =` write (→ setter), `showLock()` / `showApp()` (→ `FinSight.auth`).
- **Do:**
  - Create a vanilla Zustand store in `bootstrap.ts` with `{selected, detailRange, base, account, accountReady, peek, lastPrices}`, initialised from the same localStorage keys.
  - Proxy per §1.6. `FinSight.auth = { unlocked, lock(), unlock() }` with events, wired both ways with the legacy lock screen.
- **Done when:** the baseline passes, and the P0-4 session-expiry spec passes with a test island subscribed. A test island that shows `base` updates when legacy code changes the base currency; the clock cannot prove this.

#### F5 · UI primitives and formatting
- **Owns:** `web/src/ui/*`.
- **Do:** port the `app.js` formatting helpers (`fmt`, `fmtBig`, `money`, `moneyBig`, `moneySigned`, `csym`, `signStr`) to `ui/format.ts`, with tests comparing 20 sample values against the legacy functions, which the test loads from `app.js` source. Then build:
  - `PanelBody`, and `PanelHeadSlot` (a portal into `data-island-slot`);
  - `Num`, `Money` (base from the store, blurred when unpeeked);
  - `Pct` (up/down colours);
  - `Spark` (port of the legacy `sparkline()`);
  - `Empty`, `Loading`, `ErrorLine`, `IslandBoundary`.

  No component renders `.panel` (§1.7).
- **Done when:** the format tests pass; the primitives typecheck.

#### F6 · Island runtime + reference island (Clock)
- **Owns:** `web/src/main.tsx` (runtime part), `web/src/islands.ts`, `web/src/features/clock/*`, the clock markup in `index.html`, and `web/src/features/README.md`.
- **Callers:** the `app.js` clock section.
- **Do:** `main.tsx` mounts registered islands into `[data-island]` nodes, each inside `IslandBoundary` + `QueryClientProvider`, and implements the mount, move and unmount rules of §1.7 (MutationObserver). It calls `markIslandsReady()`. Migrate the clock: identical text format, 1 s tick. Write `features/README.md`, the step-by-step recipe every panel card follows, including the `COUPLING.md` caller step and the coverage rows.
- **Done when:** the clock renders from React, the legacy clock code is deleted, and E2E passes. A unit or E2E test proves that a moved host is not remounted and a removed host is unmounted.

### Phase 1.5: Inventory and pilots (single agent; the gate for Phase 2)

#### I1 · Coupling inventory
- **Owns:** `docs/frontend-migration/COUPLING.md`.
- **Do:** at a stated baseline commit, list for every legacy section in `app.js`, `agent-panel.js`, `chart.js` and `journal.js`:
  - the functions it defines;
  - the globals it reads and writes (`state`, `lastPositions`, `lastTableData`, `lastSummary`, `accountsCache`, `lastPrices`, `lastWatch`, `window.__finAlerts`, `detailChart`, `perfSig`, …);
  - **callers outside the section**;
  - DOM ids it reads or writes, the events it emits or listens to, the endpoints it calls and its timers.

  Known examples: `selectSymbol()` → `loadNews`, `loadDetail`; `renderPortfolio()` → `renderSummary`, `renderPositionsTable`, `renderAnalytics`. Then, for each Phase 2 card:
  - its exact symbols;
  - its caller edits, with the adapter to use (`bus.invalidate`, store selection, or a temporary shim);
  - its dependencies on other cards, which give the merge order.

  Complete the §1.3 invalidation map.
- **Done when:** every function in `app.js` is assigned to a card or marked shared/shell, and each Phase 2 card's table row below is updated to reference `COUPLING.md`.

#### PILOT-1 · Read-only draggable panel (World Markets, card A1)
- Migrate A1 following F6's recipe and `COUPLING.md`.
- **Proof (E2E):**
  - drag the panel to another column, reload, and its order is kept;
  - hide it in ⚙ Layout, reload, and it stays hidden;
  - exactly one `.panel[data-pid="markets"]` exists;
  - exactly one `/api/markets` poll runs per 15 s window;
  - lock stops polling and unlock resumes it;
  - after the host is removed, the root is unmounted (no further requests).

#### PILOT-2 · Portfolio consumer + mutation (Summary cards, card C1)
- Migrate C1 (summary cards, peek, card customiser).
- Implement `bus.invalidate('portfolio')` from every legacy write path listed in `COUPLING.md`, and from the command bar.
- **Proof (E2E):** after ADD, SELL, CASH, import, UNDO, an account switch and a base switch, the React summary, legacy positions, dividends, FX risk and ledger all show the new values with no reload. No stale account value appears after a delayed response.

### Phase 2: Panels (after the gate; each card follows `web/src/features/README.md`)

> Every card: create `web/src/features/<name>/`, port the logic, register the island, replace the panel's **body** markup, make the caller edits from `COUPLING.md`, delete the listed legacy symbols and their `boot()`/polling calls, and add `web/e2e/<card>.spec.ts` covering its `COVERAGE.md` rows. Line ranges below are **hints at `6d9a740`**. **`COUPLING.md` Part A is authoritative**: §A7 lists each card's exact symbols, caller edits and dependencies, §A4 the adapters, §A6 the invalidation map. Merge order follows §A7, not "any order".

**Lane A · Read-only market panels** (small model)
| Card | Panel | Legacy hint (app.js) | Body/host | Endpoint | Notes |
|---|---|---|---|---|---|
| A1 | World Markets | 1328–1360 | `#markets`, head slot for `#markets-time` | `/api/markets` | **PILOT-1** |
| A2 | News | 1609–1630 | `#news`, `#news-sym` | `/api/news?symbol=` | follows `store.selected`; caller: `selectSymbol()` |
| A3 | Econ Calendar + World Bank + FRED + Inflation | 360–422, 1361–1460 | `#calendar`, `#wb-*`, `#fred-*`, `#infl-*` | `/api/calendar`, `/api/worldbank`, `/api/fred` | 15 min polling; Fed decision and dot-plot rows always show |

**Lane B · Lists and income** (small/medium model)
| Card | Panel | Legacy hint | Body/host | Endpoint | Notes |
|---|---|---|---|---|---|
| B1 | Watchlist | 1498–1534 | `#watchlist`, `#watch-*` | `/api/watchlist*` | `lastWatch` / `pushChartWatch()` feed the chart: keep via bus |
| B2 | Price Alerts | 1535–1608 | `#alerts`, `#alert-*` | `/api/alerts*` | `window.__finAlerts` + `finsight:alerts` event shared with the chart; desktop notification and beep unchanged |
| B3 | Dividends + Recent Activity | 1461–1497 (+ activity in 166–218) | `#dividends`, `#div-ttm`, `#activity` | `/api/dividends`, portfolio.transactions | holdings-change-or-120 s cadence; withholding text unchanged |

**Lane C · Portfolio overview** (medium model)
| Card | Panel | Legacy hint | Body/host | Endpoint | Notes |
|---|---|---|---|---|---|
| C1 | Summary cards + Peek + card customiser | 423–508 | `#summary`, `#peek-btn`, `#cards-modal` cards part | portfolio | **PILOT-2**; caller: `renderPortfolio()` |
| C2 | FX Risk | 219–359 | `#fxrisk`, `#fxr-spot` | `/api/fx-risk` | what-if slider, VaR, convert-now; maths to `fxrisk.ts` with tests |
| C3 | Analytics: performance, allocation, heatmap, net-worth breakdown | 1694–1969 | `#perf-*`, `#alloc-*`, `#heat*`, `#wealth-*` | `/api/portfolio/performance`, categories | caller: `renderPortfolio()` → `renderAnalytics`; `perfSig` |

**Lane D · Positions and trading records** (medium model; **D1 first**, D2–D4 depend on it)
| Card | Panel | Legacy hint | Body/host | Notes |
|---|---|---|---|---|
| D1 | Positions table | 694–867 | `#positions*`, `#pos-*` | `posView`, `lastTableData`, `lastPositions` are read by analytics/detail: adapters per `COUPLING.md`; keep row flash animation |
| D2 | Add form + symbol search | 1086–1142 | `#add-*` | after a buy → `bus.invalidate` per §1.3 map |
| D3 | Undo + Cash editor | 868–983 | `#undo-btn`, `#cash-btn`, cash modal | |
| D4 | Ledger + CSV import/export | 984–1085, 1631–1693 | ledger modal, `#import-*`, `#export-btn` | keep `csvCell` formula escaping |

**Lane E · Security detail + chart** (strong model; one agent for both cards)
| Card | Panel | Legacy hint | Notes |
|---|---|---|---|
| E1 | Detail header + ranges | 1143–1247 | `#detail-*`, `#ranges`; caller: `selectSymbol()` → `loadDetail` |
| E2 | Chart host | 1248–1327 + `public/chart.js`, `chartgrid.js`, `journal.js` | **Do not rewrite `chart.js`.** Wrap it in `web/src/legacy/ChartHost.tsx`: create in `useEffect`, destroy on unmount, and pass host hooks for trades, watchlist, alerts and multi-chart. Add `legacy/chart.d.ts` typings for the API used. Kestrel reads `detailChart.cfg.strategy`: keep `window.detailChart` until lane G |

### Phase 3: Shell and Kestrel (after all of A–E have merged; these own layout)
| Card | Part | Legacy hint | Notes |
|---|---|---|---|
| F7 | Command bar | 70–165 | every command in README "Commands"; status line; writes go through `bus.invalidate` |
| F8 | Topbar: account selector, base currency, profile, setup wizard, theme/font, layout editor | 509–580, 653–693, 1991–2126 | localStorage keys unchanged; `accountReady` in store |
| F9 | PIN lock | 2127–end | brute-force messages unchanged; owns `FinSight.auth` UI |
| F10 | Layout system in React | 559–651 | panel show/hide and drag between columns, keys `finsight-panels` and `finsight-layout`. Only now may a React `Panel` render `.panel`; migrate hosts in one card |
| G1 | Kestrel chat core (log, turn view, tool rows, status candles, markdown) | `public/agent-panel.js` | XSS-safe markdown as `md.ts`, with tests that neutralise script and HTML payloads; P0-4 fake-agent specs |
| G2 | Kestrel composer: slash menu, attachments, model picker, page context | same | |
| G3 | Kestrel side drawer + dock modes, width/height, collapse | same + `agent-panel.css` | uses the F10 layout API; `finsight-agent-*` keys unchanged |

### Phase 4: Cutover (single agent)

#### X1 · One React app
- **Do:**
  - Create `web/src/App.tsx`, rendering the whole page (topbar, grid, columns, modals). `index.html` shrinks to `<div id="root">` plus scripts, with `bootstrap.js` still first while any legacy script remains.
  - Delete `public/app.js`, the store Proxy, and every `window.FinSight*` field that nothing still needs. Keep `window.detailChart` only if `chart.js` needs it.
  - Update `sw.js` and bump `SHELL`.
- **Done when:** all baseline and lane E2E specs pass, and `app.js` and `agent-panel.js` are gone.

#### X2 · Remove dead CSS and legacy assets
- **Do:** delete unused rules from `styles.css` after searching selectors in `web/src` **and every retained legacy script** (`chart.js`, `chartgrid.js`, `journal.js`, `strategy.js`, `strategies.js`, `indicators.js`). Remove legacy JS files no longer referenced; `chart.js` stays as a typed legacy module.

### Phase 5: Hardening
- **H1 · Performance budget:** compare with `BASELINE.md` (P0-5) using the same conditions. **Measured today:**
  - legacy scripts and CSS total ~528 KB raw / ~147 KB gzip;
  - React 19 + TanStack Query alone add ~250 KB minified / ~79 KB gzip.

  Budget: first paint and time to the first positions row may not get more than 10% slower. Initial JS (bootstrap + main + legacy still loaded) may not exceed the baseline legacy total + 90 KB gzip until X1, and after X1 it must be at or below the baseline. Lazy-load heavy islands (analytics, chart, Kestrel).
- **H2 · Docs:** update README "Tech stack" and "Project structure", `DOCS.md` architecture, and `docs/architecture.svg` labels.
- **H3 · Accessibility pass:** keyboard reachability of every control, focus rings, `aria` on custom widgets; add axe checks to E2E (`@axe-core/playwright`).
- **H4 · Release and offline:** `sw.js` prunes `/app/` entries not in the current manifest on activate. A mixed-version guard: if a lazy chunk fails to load, reload once. An SW-enabled E2E test covers the upgrade and offline cold start.

### Phase 6: Server → TypeScript (single agent, after X1; its own validated migration)

#### S1 · Convert lib/ and server to TypeScript ESM
- **Owns:**
  - `server.js` → `server.ts`, `lib/*.js` → `lib/*.ts`, `test/*.test.js` → `.ts`;
  - `package.json` (`"type": "module"`, scripts, `"engines": {"node": ">=24"}`);
  - root `tsconfig.json` (expand `include` to `server.ts`, `lib`, `test`, `scripts`);
  - every launcher and reference: `playwright.config.ts` (`webServer.command`), `start.command`, `start-demo.command`, `scripts/demo.js`, `install-autostart.sh` (template), `uninstall-autostart.sh`;
  - `~/FinSightData/start-finsight-personal.command`, which is outside the repo: **tell the owner**.
- **Do:**
  1. Rename and convert `require` to `import`, with explicit `.ts` extensions, `import type` for types, and erasable syntax only (no enums, no parameter properties), as in `agent/`.
  2. Type signatures with `shared/types.ts`.
  3. Behaviour byte-identical. Node 24 strips types without checking them, so `npm run typecheck` must cover the server.
  4. Run `grep -rn "server\.js"` across the repo and the owner's launchers; zero hits allowed except history and docs.
  5. An already-installed LaunchAgent is not updated by editing the template: document the re-install step and verify it with the owner.
- **Done when:**
  - `npm run verify` passes;
  - all 109+ unit tests pass as `.ts`;
  - clean startup works in isolated storage, and `npm run demo` works;
  - the owner's launcher has been verified.

#### S2 · Agent shares types
- **Owns:** `agent/src/tools/facts.ts` (types only).
- **Do:** import `Portfolio`/`Position` from `../../../shared/types.ts` (the root `shared/`; `../../shared` would resolve inside `agent/`). Check that `agent/tsconfig.json` allows a file outside its `include` (add a path or `rootDirs` if needed). Replace the local `any` shapes. No logic change.
- **Done when:** `npm run agent:test` passes.

---

## 5. Risks and mitigations
| Risk | Mitigation |
|---|---|
| Startup order (legacy needs something only a module provides) | §1.6: `bootstrap.js` first; legacy never depends on `main.js`; E2E enforces the order |
| Hidden coupling through legacy functions and globals | I1 inventory; caller edits assigned per card; adapters (store, bus) before deletion; pilots before fan-out |
| React and legacy both writing the same DOM | §1.7: legacy owns hosts, React owns a body node; runtime never remounts on move |
| Polling while locked, retry storms, stale account values | §1.3 defaults, `enabled` gating, cancel on lock, keys include account/base, AbortSignal |
| Two agents edit the same lines | §2.5 shared-file rules; one lane per area; registry files append-only; lanes only after the gate |
| Behaviour drift | baseline + P0-4 coverage matrix + P0-5 visual set; fake market data for deterministic values |
| Build output drifts from source | tracked `check:web` in `npm test`; local hook only a convenience |
| Bundle grows / slower first paint | H1 measured budget; code splitting; lazy islands |
| The canvas chart breaks | not rewritten; wrapped with a lifecycle (E2) |
| One island crashes the page | `IslandBoundary` per island; legacy keeps working without `main.js` |
| Service worker serves mixed versions | manifest precache, `SHELL` bump, H4 pruning and reload-once guard |
| Server runtime change breaks launchers | Phase 6 only, with a launcher inventory and owner verification |
| Personal data leaks into the public repo | pre-commit guard; E2E uses temp data folders and fixtures only |

## 6. Rollback
- **Merge policy from F1 on:** each card merges with `git merge --no-ff mig/<card>`, so it is one merge commit, revertable with `git revert -m 1 <merge-sha>`. Phase 0 was fast-forwarded (no merge commit); revert its four commits individually if ever needed.
- **Dependencies:** a card can only be reverted after every later card that depends on it (per `COUPLING.md`) has been reverted, newest first. After any revert, run `npm run verify` before using the app.
- **Last known good:** before each phase starts, tag `main` as `mig-lkg-<phase>` (local tag). Rollback smoke test: check out the tag in a scratch worktree, run `npm run verify` and start the server on isolated storage.
- **Runtime changes** (Phase 6, launchers) are reverted separately from panel cards, together with the owner's launcher.

## 7. Progress tracker
| Card | Lane | Status | Branch | Agent | Notes |
|---|---|---|---|---|---|
| P0-1 | 0 | done (merged 2026-10-25) | mig/P0-safety-net | Claude | @playwright/test 1.64.0; `npm run e2e` |
| P0-2 | 0 | done (merged 2026-10-25) | mig/P0-safety-net | Claude | `lib/fakemarket.js` replaces global fetch; non-loopback hosts blocked |
| P0-3 | 0 | done (merged 2026-10-25) | mig/P0-safety-net | Claude | 9 baseline specs, 36/36 over 3 repeats |
| P0-4 | 0 | done (merged 2026-10-25, c49ca7d) | mig/P0-4-coverage | Claude | 43 scenarios; SSE regression fixed in 31437a0; stale account regression fixed in add0f47 |
| P0-5 | 0 | done (merged 2026-10-25, 353ed94) | mig/P0-5 | Codex | BASELINE.md; eight snapshots, three consecutive comparison passes; rolling-date/FX masks |
| F1 | 1 | done (merged 2026-10-25, e255e56) | mig/F1-toolchain | Claude | splitting + manifest, bootstrap order, tracked `check:web`, colocated tests, scoped CSS Modules plugin; portable maps verified in follow-up 0becbcb |
| F2 | 1 | done (merged 2026-10-25, 0f47cad) | mig/F2 | Codex | producer-derived types; 11 real fake-market HTTP responses type-assigned |
| F3 | 1 | done (merged 2026-10-25, ab329ea) | mig/F3 | Codex | typed client/hooks, refresh bus, Query defaults; 115 unit + 47 E2E |
| F4 | 1 | done (merged 2026-10-25, add0f47) | mig/F4 | Codex | store/auth bridge, sequenced legacy loader, test-only subscribed island; 118 unit + 49 E2E |
| F5 | 1 | done (merged 2026-10-25, db26138) | mig/F5 | Codex | 20-value legacy format comparisons and UI primitives; 119 unit + 49 E2E |
| F6 | 1 | done (merged 2026-10-25, c43c7a9) | mig/F6 | Codex | 119 unit + 52 E2E; lazy clock, move/unmount lifecycle, failure isolation; stop before I1/pilots |
| I1 | 1.5 | done (merged 2026-10-25, 101b708) | mig/I1-coupling | Claude | `COUPLING.md` (baseline `31437a0`, refreshed after F6) + `scripts/coupling-inventory.mjs`; found 4 misplaced helpers and the C1↔C2, C3↔D1, E2↔B1/A3 couplings |
| PILOT-1 (A1) | 1.5 | done (merged 2026-10-25, 4644f1b) | mig/PILOT-1-markets | Claude | World Markets island; all 5 gate proofs pass (drag/reload, hide, 2 polls per 31 s, lock/unlock, unmount). Found and fixed a contract gap: an island mounting during a lock sent one request; the API client now refuses protected calls while locked. Cold transfer 793,872 B vs 529,973 B baseline (React + Query now load for a real panel); timings within noise |
| PILOT-2 (C1) | 1.5 | done (merged 2026-10-25, 853a550) | mig/PILOT-2-summary | Claude | Summary cards + card editor islands, `useFxRisk`; every legacy write goes through `bus.write(kind)` (map completed per COUPLING §A6); fan-out proofs pass. Peek stays legacy (must apply synchronously at load; moves with F8). Intended fix: card order reload bug. Known duplication until D1/C2: `/api/portfolio` and `/api/fx-risk` are each fetched by legacy and by Query |
| A1 | A | done as PILOT-1 (merged) | mig/PILOT-1-markets | Claude | |
| A2 | A | done (merged 2026-10-25) | mig/A2-news | Codex | News island + command adapters; intended fix: old-symbol response cannot overwrite current news; 128 unit + 69 E2E on base 8086 |
| A3 | A | done (merged 2026-10-25, in the integration 26036a8) | mig/A3-macro | Codex | Calendar, WB, FRED, manual inflation; 133 unit + 80 E2E |
| B1 | B | done (merged 2026-10-25, in the integration 26036a8) | mig/B1-watchlist | Codex | Watchlist, search, chart adapter, Query polling |
| B2 | B | done (merged 2026-10-25, in the integration 26036a8) | mig/B2-alerts | Codex | Alerts, chart bridge, notification lifecycle |
| B3 | B | done (merged 2026-10-25, in the integration 26036a8) | mig/B3-income-activity | Codex | Income/activity; intended fix: stale-account response; 120s query replaces side-load duplicate |
| C1 | C | done as PILOT-2 (merged) | mig/PILOT-2-summary | Claude | |
| C2 | C | done (merged 2026-10-25, in the integration 26036a8) | mig/C2-fx-risk | Codex | FX tools/history, typed lots, tested arithmetic; shared query replaces legacy duplicate |
| C3 | C | done (merged 2026-10-25, in the integration 26036a8) | mig/C3-analytics | Claude | Performance, net-worth breakdown, allocation and sector heatmap islands; head controls through head slots; `usePerformance` keyed by the holdings signature (replaces `perfSig`), `useWealth` (60 s, replaces `wealthSig`/`wealthAt`); categories from `useCategories`. Deleted legacy `catCache`, `ensureCategories`, `lastPositions` and the D1/D3 adapters (`assetClass`/`splitByAccount` copies, `analyticsStale`). Drag pids now target the island hosts |
| D1 | D | done (merged 2026-10-25) | mig/D1-positions | Claude | Positions table island (toolbar, filter chips, search, sort, group, collapse, row S/✕, flash) + `useCategories`, `useAccounts`; `posView` keeps the `finsight-posview` key. Legacy keeps `lastTableData` fed from `renderPortfolio` for detail/chart (E1/E2) and its own `assetClass`/`splitByAccount` copies for allocation (C3). Intended fix: a failed row ✕ delete now shows an error |
| D2 | D | done (merged 2026-10-25, in the integration 26036a8) | mig/D2-addform | Claude | Add form + symbol search island; `store.addFormOpen` carries the legacy + ADD button and the setup wizard's "Add manually" choice (a click before the island mounts still counts); debounced search aborts the older request |
| D3 | D | done (merged 2026-10-25, in the integration 26036a8) | mig/D3-undo-cash | Claude | Undo + CASH as TypeScript actions (`window.FinSight.actions`, installed by main.js; `doUndo`/`setCashBalance`/`openCashEditor` stay as one-line globals for the command bar, ledger ↶, wealth and summary openers); cash editor modal island opened by `store.cashEditorOpen`. Legacy `analyticsStale()` keeps the perf/wealth signature resets until C3 |
| D4 | D | done (merged 2026-10-25, in the integration 26036a8) | mig/D4-ledger | Claude | Ledger modal (trades + realized, edit/delete buys, realized CSV) and import modal islands, opened by `store.ledgerOpen`/`importOpen`; EXPORT is `FinSight.actions.exportPortfolio`; `useLedger`/`useRealized` fetch only while their tab is open (replaces the legacy `ledger`/`realized` bus refreshers). `csvCell` ported to `ui/csv.ts`; the legacy copy stays for the baseline spec until X1 |
| E1 + E2 | E | done as one card (merged 2026-10-25, in the integration 26036a8) | mig/E-detail-chart | Claude | Detail island (header, stats, ranges via head slot, manual holdings, auto-select) + `legacy/ChartHost.tsx` wrapping chart.js unchanged (creates its own `#detail-chart-host` root so expand/grid can move it; sets `window.detailChart`). `useHistory`/`useQuote` replace `loadDetail`/`detailHist` and the 30 s poll. **Deviation:** E1 and E2 were done together; split, E1 would have needed a throwaway legacy chart adapter, and both merge in the same batch. Watch feed, trade loader and `chartGrid` stay in app.js behind `window.FinSightChartHooks` so B1 (Codex) keeps its `lastWatch`/`pushChartWatch` contract |
| F7 | 3 | done (merged 2026-10-25, in integ a7e2992) | mig/F7-command | Claude | Command bar, status line and footer as islands; grammar in `features/command/commands.ts` (tested), writes through `bus.write`. `setStatus`/`setFooter` stay global as store writes (`status`, `footer` keys), so messages sent before mount still show. Removed the unused `loadAlerts`/`loadNews`/`setCashBalance` adapters; `loadWatchlist`/`loadDividends` stay as spec hooks |
| F8 | 3 | done (merged 2026-10-25, in integ a7e2992) | mig/F8-topbar | Claude | Account selector, MANAGE ACCOUNTS, base currency, ◐ Profile + setup wizard, PEEK, appearance (theme/font) as islands. Startup account resolution (`loadAccounts`, `accountReady`) stays legacy until X1 and now publishes the list as store `accounts`; peek's `body.unpeek` is applied by bootstrap at load. **Deviation:** the ⚙ Layout modal frame and panels editor stay for F10 (it owns layout; nesting islands inside a React modal is avoided). localStorage keys unchanged |
| F9 | 3 | done (merged 2026-10-25, in integ a7e2992) | mig/F9-lock | Claude | Lock form (title, PIN fields, button, message, offline view) and 🔒 as islands rendering store `lock` (`mode`, `msg`, `fresh`); server error texts pass through unchanged. `checkAuth`/`showLock`/`showApp`/offline retry stay legacy until X1 (they drive boot and polling); unlock goes through `FinSight.auth` |
| F10 | 3 | done (merged 2026-10-25, in integ a7e2992) | mig/F10-layout | Claude | Layout system in TypeScript (`features/layout/layout.ts`: pids, grips, column drag, saved order, hidden panels; keys `finsight-layout`/`finsight-panels` unchanged) and the ⚙ CUSTOMISE LAYOUT modal as one island that renders appearance (F8), the card editor (C1) and the panels editor as plain components. Legacy boot calls `FinSight.layout.init()` after `islandsReady` (the Kestrel dock exists by then). **Deviation:** React does not render the `.panel` hosts yet; they stay in index.html until X1's single App, because rendering them inside islands now would nest React roots |
| G1 + G2 + G3 | 3 | done as one card (merged 2026-10-25, in integ a7e2992; review fixes in 6ff0e89) | mig/G-kestrel | Claude | Kestrel in React: `md.ts` (escape-first markdown, tests neutralise script/img/svg/javascript: payloads), turn model `turns.ts` (tested), chat store/actions `chat.ts` (stream, threads, slash commands, uploads, offline), `Chat.tsx`, and the `KestrelIsland` shell (side drawer width, docked panel height/collapse, ⌘/, Esc). The dock host stays static in index.html so the layout system tags it `kestrel`; `public/agent-panel.js` deleted, `agent-panel.css` kept; `finsight-agent-*` keys unchanged. Intended fix: a turn that fails before the send reply no longer leaves the chat on ■ (spec proves it fails on legacy). **Deviation:** G1–G3 done together (one shared chat state; separate cards would need throwaway bridges) |
| audit fix | 4 | done (merged 2026-10-25, b37c36e, in integ a7e2992) | mig/X1-app | Claude | FRONTEND-006 findings A1 (6M/1Y chart view), A2 (account-scoped chart markers), A4 (watchlist refreshes events) via FRONTEND-007's phase3-source.patch, unchanged; A3 already handled by F8 |
| X1 | 4 | done (merged 2026-10-25, 59b4c46, in integ a7e2992) | mig/X1-app | Claude | `web/src/App.tsx` renders the whole page; `index.html` is `<div id="root">` plus scripts; `public/app.js` deleted; the store Proxy (`legacyState`), `setLastPrice` and `FinSight.layout` removed. Startup/lock (`shell/boot.ts`), chart hooks (`shell/chartHooks.ts`, keeps the A2 fix) and the layout (`shell/layout.ts`, React state; panels live in stable elements moved between columns, so drag and moves keep state) are TypeScript. **Deviation:** mount points stay island hosts mounted by the F6 runtime (code splitting, per-panel failure containment, and the PILOT unmount/move guarantees the specs check). `window.detailChart` and a few documented test/console globals stay (`shell/compat.ts`). `baseline/upgrade.sw` now expects `/chart.js` instead of the deleted `/app.js` |
| X2 | 4 | done (merged 2026-10-25, 769283b, in integ a7e2992) | mig/X1-app | Claude | `scripts/css-dead.mjs` (conservative: a selector is dead only if a class/id it requires appears nowhere in web/src, the retained chart scripts or index.html; classes built at runtime such as `'st-' + code` or `col-${side}` count as used): 6 dead rules removed from styles.css (`.div-head`, `.div-head .dv`, `.div-sub`, `.div-row`, `.div-row .ds`, `.chart-toolbar .ct-label`, all already unused before the migration); agent-panel.css has none. No legacy JS left to remove: every remaining file in public/ is referenced (`chart.js` and its helpers stay as typed classic scripts). README/DOCS still describe app.js and agent-panel.js: H2 |
| H1–H4 | 5 | done (merged 2026-10-25/26: H2 78a7f40; H1 ddff81f, H3 0249acc, H4 c782f80, integrated fbed305 with follow-ups 29bde12/7b37a98/839457e; deterministic SW recovery tests 66b8325; detail chart waits for its grid 4d2d772, merged 60f6837) | mig/H1-perf, docs/h2-react-migration, mig/H3-a11y, mig/H4-release | Claude, Codex | Phase 5 complete; eager bundle 406 KB raw / 118.7 KB gzip vs baseline 530/147 (H1 budget met); axe specs green |
| hardening (out of plan) | 4–5 | done (merged: startup fallback R1 + SW hashed-chunk fallback R2 e79d4b1; AUTHVAL auth-isolation suite and lock/Kestrel fixes in a7e2992; Kestrel review fixes 6ff0e89) | fix/startup-fallback, val/auth-isolation, fix/phase3-review | Claude | recorded so no agent redoes them |
| S1, S2 | 6 | done (merged 2026-10-26 in `e63e50f`: regression tranche ab21d13, S1 33b0c25, compare-tool cleanup fix abb3249, S2 918ff33) | mig/S1-server-ts (S2 from mig/S2-agent-types 4b38c90) | Claude, Codex | Server, `lib/`, tests and `scripts/demo.ts` are TypeScript ESM run directly by Node 24 (`engines >=24`, launchers check it). `public/package.json` and `web/e2e/package.json` mark those folders CommonJS; side effect accepted by the owner: `/package.json` answers 200 `{"type":"commonjs"}` instead of 404. Intended text fix: offline/boot/port hints name `server.ts` (SHELL v36). `scripts/compare-servers.mjs` (old vs new, shared virtual clock): no other differences. 191 unit + 227 E2E green on main. Owner launcher switched to `server.ts`; the frozen JS build stays as a local backup worktree at `mig-lkg-phase6` |
