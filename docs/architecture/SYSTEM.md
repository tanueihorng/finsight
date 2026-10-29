# FinSight System Architecture & Developer Reference

Current overview of the terminal and supervised Kestrel service. See [developer/API reference](../../DOCS.md) for configuration and endpoints, and [agent SPEC](../../agent/docs/SPEC.md) for the agent contract. Paths such as `data/portfolio.json` below describe a configured data directory; personal launchers may set `FINSIGHT_DATA_DIR` outside the checkout.

---

## 1. Process & Architecture Model

The terminal server is a zero-dependency Node.js process (built-in `node:http` + native `fetch`, Node 24+):

```
browser ──HTTP──▶ server.ts ──┬─▶ public/* (static terminal UI + service worker)
                              ├─▶ /api/* (JSON API over lib/*)
                              │    ├─▶ Yahoo Finance / World Bank / FRED (keyless public feeds)
                              │    └─▶ data/portfolio.json (local store)
                              └─▶ /api/agent/* (Session-gated proxy to local Kestrel service on :8100)
```

`server.ts` is strictly the HTTP server, session guard, and proxy layer. All core business logic lives in `lib/`:

| Module | Responsibility |
|---|---|
| `config.ts` | Paths (`FINSIGHT_DATA_DIR`), port defaults, user agents |
| `cache.ts` | Stale-while-revalidate cache, in-flight de-dupe, persistence to `data/cache.json` |
| `market.ts` | Yahoo Finance: quotes, history, FX, search, markets, news, sectors (429 backoff) |
| `macro.ts` | World Bank, FRED, economic calendar (FOMC schedule + Forex Factory) |
| `store.ts` | Load/migrate/save `portfolio.json`, write serialization lock, undo snapshots |
| `portfolio.ts` | Position math, cash balances, live P&L, stock/FX return decomposition |
| `performance.ts`| Trade replay, time-weighted returns (TWR), dollar-weighted returns (XIRR) |
| `returns.ts` | Pure mathematical routines for period returns and compounding |
| `dividends.ts` | Withholding tax, forward income calculations, dividend calendar |
| `ledger.ts` | Transaction history ledger, buy edits/deletes, realized-gains reporting |
| `csv.ts` | Pure CSV parsing for manual imports and Interactive Brokers activity statements |
| `auth.ts` | Scrypt PIN hashing, session tokens, brute-force throttling |
| `agentproc.ts` | Child process supervisor for the bundled Kestrel AI research agent |
| `agentlink.ts` | Secret-gated loopback communication with the Kestrel agent process |

---

## 2. Frontend Subsystem (`web/` → `public/app/`)

- **Modern Source:** React 19 + TypeScript in `web/src/`.
- **Bundler:** Built via esbuild (`scripts/build-web.mjs`, `npm run build`, `npm run dev` watches).
- **Artifacts:** Bundles directly into committed production assets in `public/app/`:
  - `bootstrap.js`: Creates `window.FinSight` (Zustand UI store, refresh bus, PIN auth state) synchronously before page render.
  - `main.js` / `main.css`: ESM module code-split into chunks (`public/app/chunks/`).
  - `manifest.json`: Runtime inventory for service worker precaching.
- **Page composition:** `web/src/main.tsx` mounts one React app (`App.tsx`). The island registry and `mountIslands` remain for external embeds and compatibility tests.
- **Data Layer:** TanStack Query (`web/src/api/queries.ts`) with automatic poll suspension when locked or hidden.
- **Appearance:** `data-theme` (accent), `data-font` and `data-mode` (`dark` | `light`) on `<html>`, applied before first paint from `finsight-theme`, `finsight-font` and `finsight-mode`. Every colour is a token on `:root` in `public/styles.css`; light mode redefines them under `:root[data-mode="light"]`, with a darker light variant per accent. The ◐ top-bar button and ⚙ Layout APPEARANCE switch modes; charts repaint through `chartHooks.repaint()`.
- **Kestrel panel states (FEAT-009):** side drawer (resizable), docked terminal panel, and full page (`body.agent-full`, the same drawer below the top bar with the grid `inert`; `⌘⇧/`, Esc returns). With the panel closed, a running turn shows a capsule (`role="status"`, no finding text) and the ASK button and top bar show a busy state. On the full page, a turn's views move to a workspace column, and the council can switch between Cards and Chain of thought (`kestrel.councilView`, `⌘.`). All council surfaces read one view model (`web/src/features/kestrel/council.ts`) that UNPEEK blanks.

---

## 3. Data Storage & Safety Model

- **Portfolio Store (`data/portfolio.json`):**
  - Multi-account structure (`accounts: [{ id, name, type, positions[], transactions[], dividends[], cash{} }]`).
  - Lot-based accounting (`lots: [{ q, px, fxUsd, t }]`) preserving purchase-time native→USD exchange rates for true currency-vs-asset return decomposition.
- **Undo Stack (`data/undo.json`):** 25-step deep historical snapshot for all state mutations.
- **Concurrency Guard:** All disk read-modify-writes are serialized through a single promise chain (`withLock`) to prevent race conditions.
- **Stale-While-Revalidate Cache (`lib/cache.ts`):**
  - Upstream financial data is cached in memory and persisted to `data/cache.json` (≤ 30 days retention).
  - Outages or rate limits (HTTP 429) automatically serve the last known good value with background exponential backoff.

---

## 4. Development & Testing Commands

* **Run Server:** `node server.ts`
* **Agent Tests & Secret Scan:** `npm run agent:test`
* **Full Unit Suite:** `npm test`
* **Typecheck:** `npm run typecheck`
* **Web Bundle Consistency Check:** `npm run check:web`
* **Browser E2E (Playwright):** `npm run e2e`
* **Full Release Verification:** `npm run verify`
