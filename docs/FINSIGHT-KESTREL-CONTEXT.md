# FinSight and Kestrel: full context

One file that explains the whole system to a person or a coding agent starting cold.

- **Snapshot:** commit `e17a083` on branch `feat/kestrel-research-tools`, written 2026-11-10.
- **Scope:** the FinSight terminal (server, data, frontend), the Kestrel agent in `agent/`, how they connect, how they are tested, and what is planned.
- **Source of truth:** the code. Where this file and the code disagree, the code wins. Section 30 lists places where the older docs have already drifted.
- **Personal data:** none. Holdings, keys, PINs, tokens, `INVESTMENT_POLICY.md` and `INVESTOR_PROFILE.md` live only in `~/FinSightData/` and must never enter this repository.

## Contents

1. [What the product is](#1-what-the-product-is)
2. [Hard rules](#2-hard-rules)
3. [Runtime topology](#3-runtime-topology)
4. [Repository map](#4-repository-map)
5. [Commands](#5-commands)
6. [Server: security and auth](#6-server-security-and-auth)
7. [Server: HTTP routes](#7-server-http-routes)
8. [Storage and data model](#8-storage-and-data-model)
9. [Market data and cache](#9-market-data-and-cache)
10. [Portfolio accounting](#10-portfolio-accounting)
11. [Other server modules](#11-other-server-modules)
12. [Paper trading](#12-paper-trading)
13. [Agent link and supervisor](#13-agent-link-and-supervisor)
14. [Frontend architecture](#14-frontend-architecture)
15. [Frontend features](#15-frontend-features)
16. [Kestrel: overview and config](#16-kestrel-overview-and-config)
17. [Kestrel: HTTP API](#17-kestrel-http-api)
18. [Kestrel: chat engine](#18-kestrel-chat-engine)
19. [Kestrel: context and prompt](#19-kestrel-context-and-prompt)
20. [Kestrel: brains](#20-kestrel-brains)
21. [Kestrel: tools](#21-kestrel-tools)
22. [Kestrel: research computations](#22-kestrel-research-computations)
23. [Kestrel: strategies and sandbox](#23-kestrel-strategies-and-sandbox)
24. [Kestrel: Investment Council](#24-kestrel-investment-council)
25. [Kestrel: intelligent UI](#25-kestrel-intelligent-ui)
26. [Kestrel: supporting subsystems](#26-kestrel-supporting-subsystems)
27. [Kestrel: chat frontend](#27-kestrel-chat-frontend)
28. [Testing](#28-testing)
29. [Environment variables](#29-environment-variables)
30. [Doc and code mismatches](#30-doc-and-code-mismatches)
31. [Feature status](#31-feature-status)
32. [Quant engine status and design](#32-quant-engine-status-and-design)
33. [How to change things](#33-how-to-change-things)
34. [Glossary](#34-glossary)

---

## 1. What the product is

**FinSight** is a private, local investment terminal for one user. It combines live market data, multi-account portfolio accounting with a stock-versus-FX P&L split, a custom charting engine, macro panels, a trade journal, and Alpaca paper trading. It binds to loopback, keeps data in local JSON files, and its server has no npm runtime dependencies.

**Kestrel** is the agent that lives in `agent/`. It is a separate Node process behind FinSight's `/api/agent/*` proxy. It is model-agnostic through brain plugins. It answers from tools rather than memory, runs an optional multi-role Investment Council, draws validated interactive views in chat, and can place **paper** orders only.

The product exists to answer four questions at all times (`docs/product/PRD.md`):

1. What changed? Facts and data times, separated from interpretation.
2. Is action needed? Urgent constraints, separated from noise.
3. What rule supports it? Accepted policy, valuation hurdles, risk budgets.
4. What invalidates the decision? Observable disproving criteria and review dates.

**Stack**

| Layer | Technology |
|---|---|
| Runtime | Node 24 or newer, running TypeScript natively (erasable syntax only, no build step for the server) |
| Server | Zero-dependency `node:http` in `server.ts` and `lib/` |
| Frontend | React 19, esbuild, TanStack Query, Zustand; build output committed in `public/app/` |
| Charts | Hand-written canvas engine in classic scripts under `public/` |
| Agent | TypeScript, better-sqlite3 (WAL), zod 4, Anthropic SDK, MCP SDK, readability, linkedom, mammoth, unpdf |
| Tests | `node:test`, Playwright |

---

## 2. Hard rules

From `AGENTS.md`, `CLAUDE.md`, and the agent spec. These bind every change.

**Data and safety**

- No personal data in the repo: holdings, keys, PIN credentials, `agent-link.json`, `INVESTMENT_POLICY.md`, `INVESTOR_PROFILE.md`.
- No arithmetic by language models. Every figure comes from code, and the model chooses inputs and explains results.
- Kestrel is read-only toward the user's world. The single write path is paper orders. Real-money orders do not exist anywhere in the code.
- Durable records change only through `propose_record_update`, which the user must accept.
- Strategy signals come only from `run_strategy` or `scan_strategies`.
- Answers cite `asOf` or `retrievedAt`.
- Fetched web text and uploaded documents are untrusted data, not instructions.

**Process**

- Read `docs/README.md` and `docs/BACKLOG.md` first.
- New features get `docs/features/FEAT-XXX-<slug>.md` and a backlog entry, marked deferred until the user selects them.
- On completion, update BACKLOG and CHANGELOG with real commit hashes, and keep implemented, verified, merged and deployed distinct.
- `npm run agent:test` must pass before committing.
- Read `agent/docs/SPEC.md` before changing the agent. A change that contradicts it needs the user's approval.
- In the parent investment workspace, `harness/queue.json` owns scheduling and `harness/STATE.md` names the active checkout.

---

## 3. Runtime topology

```
Browser (localhost)
   │  cookie session, same-origin writes
   ▼
FinSight server.ts ──────────────► Yahoo, FRED, World Bank, Forex Factory, Nasdaq IPOs
   │        │  ▲                   Alpaca paper REST + trade_updates WebSocket
   │        │  │ Bearer token (read allowlist + 2 paper write routes)
   │        ▼  │
   │     Kestrel agent (agent/src/cli.ts start) ──► model APIs (DeepSeek, OpenAI, Anthropic, claude CLI)
   │        ▲                                   ──► Tavily, Brave, DeepSeek search; SEC EDGAR; FINRA
   │        │ /api/agent/* proxy, adds x-agent-secret
   └────────┘
                 agent.db (SQLite), logs/, uploads/, skills/, records/

MCP clients (Claude Code, Codex) ── stdio ──► agent/src/cli.ts mcp ── same tool registry
```

**Ownership**

- FinSight owns portfolio data, calculations, market data, and the user's paper settings and limits.
- Kestrel owns threads, turns, traces, cost accounting, tools, and model calls.
- Keys for Alpaca stay on the FinSight server and are never returned to the browser or the agent.

**Profiles and ports**

| Profile | FinSight | Agent | Data folder | Started by |
|---|---|---|---|---|
| Standard | 8000 | 8100 | `./data` | `npm start` |
| Personal | 8001 | agent default | `~/FinSightData` | personal launcher (the agent config default `finsightUrl` is `http://127.0.0.1:8001`) |
| Standalone | 8002 | 8102 | `~/FinSightStandalone` | `start.command`, refuses overlap with personal or demo storage |
| Demo | 8003 | 8103 | `~/FinSightDemo`, PIN 2468 | `npm run demo`, synthetic data, refuses personal paths |
| E2E | base 8096 + offset | 8097 fake | temp folders | Playwright |

---

## 4. Repository map

About 522 tracked files, excluding `public/app`, images, and the lockfile.

```
server.ts                 HTTP server, routing, security, background alerts (506 lines)
lib/                      Server modules (section 10, 11, 12)
shared/                   types.ts (wire types), council-lenses.ts, ui.ts
public/
  index.html              Shell page, early fetches, modulepreload list
  chart.js                Canvas chart engine (3019 lines)
  chartgrid.js            Multi-chart grid
  indicators.js           Indicator math, shared with the server (357 lines)
  strategy.js             Pullback analyser (208 lines)
  strategies.js           Strategy library (301 lines)
  journal.js              Journal UI
  styles.css              Main stylesheet (1008 lines)
  agent-panel.css         Kestrel stylesheet (560 lines)
  sw.js                   Service worker
  package.json            Marks the UMD files CommonJS for Node's require
  app/                    Committed esbuild output
web/src/                  React app (section 14, 15)
web/e2e/                  Playwright specs, fake-agent.mjs, real-council-agent.mjs,
                          sw-server.mjs, ui-fixture.mjs, COVERAGE.md
test/                     node:test suite and fixtures
scripts/                  build-web.mjs, demo.ts, demo-safety.ts, compare-servers.mjs,
                          coupling-inventory.mjs, css-dead.mjs, css-modules.mjs,
                          build-council-preview.mjs, check-launcher-path.ts
agent/
  src/
    cli.ts config.ts log.ts secrets.ts skills.ts types.ts uploads.ts
    api/                  server.ts, usage.ts
    brains/               anthropic, claudecode, mock, openai, registry, responses, types
    chat/                 bus, context, council, council-contract, council-evidence,
                          council-metrics, council-readiness, council-service, engine,
                          prompt, research-subjects
    mcp/server.ts         MCP over stdio
    obs/audit.ts          Interaction log
    sandbox/              host.ts, strategy-worker.cjs
    store/db.ts           SQLite schema and queries
    tools/                attachments, facts, finsight, index, netguard, paper, records,
                          registry, research, strategies, ui, web
    ui/                   qualification.ts, schema.ts
  plugins/brains/         claude-code, deepseek-flash, deepseek-pro, gpt-6-luna,
                          gpt-6-sol, haiku, sonnet
  plugins/strategy-evidence.json
  skills/                 earnings-review, position-review, pre-trade-check,
                          strategy-scan, why-did-it-move
  docs/                   SPEC, COUNCIL, INTELLIGENT-UI, UI-QUALIFICATION, ADR-THINKING-EFFORT
  evals/                  council-cases.ts
  scripts/                cache-probe.ts, evaluate-council.ts, qualify-ui.ts, secret-scan.ts
  test/                   node:test suite
docs/
  BACKLOG.md README.md
  architecture/           SYSTEM, finsight-architecture, kestrel-architecture
  features/               FEAT-001 to FEAT-013 (no 004)
  product/PRD.md
  frontend-migration/ testing/ master/ guide/ archive/
Launchers                 start.command, start-demo.command,
                          install-autostart.sh, uninstall-autostart.sh
Top-level docs            README, AGENTS, CLAUDE, DOCS, CHANGELOG, START-HERE
```

`.gitignore` keeps out `data/`, `*.csv`, `*.zip`, `.claude/`, `finsight-handoff.md`, `node_modules/`, `agent/node_modules/`, `agent/scratch/`, `test-results/`, `playwright-report/`.

---

## 5. Commands

**Root**

| Command | Purpose |
|---|---|
| `npm start` | Run the server |
| `npm test` | Root and web unit tests |
| `npm run typecheck` | `tsc -p web && tsc -p web/tsconfig.test.json && tsc -p .` |
| `npm run build` | Build web into `public/app` |
| `npm run dev` | Rebuild on change |
| `npm run check:web` | Fail if `public/app` differs from a fresh build |
| `npm run e2e` | Playwright |
| `npm run verify` | Combined verification |
| `npm run demo`, `npm run demo:reset` | Demo profile, optionally reseeded |
| `npm run agent:install` | Install agent dependencies |
| `npm run agent:test` | Agent `check`: typecheck, tests, secret scan |

**Agent CLI**

```bash
node agent/src/cli.ts start
```

Subcommands: `start`, `doctor`, `mcp`, `cost`, `logs [turnId] [--kind k] [--limit n] [--width n]`, `skills [add <github-folder-url>]`.

**MCP registration**

```bash
claude mcp add finsight -- node <finsight>/agent/src/cli.ts mcp
```

---

## 6. Server: security and auth

**Response and request protection**

- `X-Frame-Options: DENY` and `X-Content-Type-Options: nosniff` on responses.
- Host header checked on loopback to stop DNS rebinding. `HOST=0.0.0.0` opts out.
- Every non-GET `/api/` request must pass `sameOriginWrite` (`Sec-Fetch-Site` and `Origin`, when sent, must match), or it gets 403.
- Request body limit 25 MB.
- Content-hashed chunks are served immutable. Everything else is `no-cache` with an ETag.

**PIN lock**

- Always reachable: `/api/auth/status`, `setup`, `login`, `logout`, `change`.
- PIN is 4 to 12 digits (`PIN_RE`), scrypt-hashed in `auth.json` with async scrypt to keep it off the event loop.
- Sessions are 24 random bytes in an in-memory map, sent as `sid` (`HttpOnly; SameSite=Strict`), and clear on server restart.
- Idle lock after `LOCK_IDLE_MIN` (default 480).
- Throttle is per source IP. After 5 failures the delay is 15 s × (n − 4), capped at 300 s.
- Changing the PIN clears every session.
- The gate fails closed when no PIN exists, and that includes the agent token.
- An hourly janitor removes stale sessions and throttle entries, because the LaunchAgent process runs for months.

**Book pinning**

Every request runs inside `withBook(chosenBook(), …)` using AsyncLocalStorage, so a book switch in mid-request cannot move it to the other book. `PAPER_READONLY` returns 409 on manual book edits while in the paper book.

**Background work**

- Alert timer `ALERT_INTERVAL` (default 60 s, minimum 15 s) fires macOS notifications, so alerts work with no browser open once autostart is installed.
- Paper SSE sends a ping every 25 s.
- Graceful shutdown on SIGINT, SIGTERM and SIGHUP persists the cache and stops the agent.

---

## 7. Server: HTTP routes

| Area | Routes |
|---|---|
| Health | `/api/health`, `/api/agent-status` |
| Auth | `/api/auth/{status,setup,login,logout,change}` |
| Book | `/api/book` GET and POST |
| Paper | `/api/paper/{state,settings,stream,orders,orders/cancel,tickets/decide,connect,disconnect,sync}` |
| Agent proxy | `/api/agent/*` maps to agent `/v1/*` |
| Charts | `/api/charts/{drawings,layouts,current,layouts/save,layouts/delete}`, `/api/chart-trades` |
| Journal | `/api/journal`, `/api/journal/{create,update,delete,image,csv}` |
| Quotes and history | `/api/quote`, `/api/quote-details` (≤20), `/api/history`, `/api/history/batch` (≤200 symbols, 6 concurrent), `/api/search`, `/api/fund`, `/api/markets` |
| Macro | `/api/worldbank`, `/api/fred`, `/api/calendar` |
| Accounts | `/api/accounts`, `/api/accounts/{add,rename,remove}` |
| Portfolio | `/api/portfolio`, `/api/portfolio/{buy,transfer,import-preview,sell,delete,import,reset,performance}` |
| Lists | `/api/watchlist`, `/api/watchlist/{add,remove}`, `/api/alerts`, `/api/alerts/{add,update,remove}` |
| Reports | `/api/news`, `/api/categories`, `/api/dividends`, `/api/events`, `/api/discover`, `/api/ledger`, `/api/ledger/{edit,delete}`, `/api/realized`, `/api/fx-risk` |
| Settings | `/api/settings/withholding`, `/api/cash`, `/api/undo` |

---

## 8. Storage and data model

Everything sits under `DATA_DIR` (`FINSIGHT_DATA_DIR`, default `./data`). Writes go to a temp file and rename atomically. A corrupt portfolio file is backed up rather than wiped.

| File | Contents |
|---|---|
| `portfolio.json` | Accounts, watchlist, alerts, settings, activeId |
| `undo.json` | Last 25 steps |
| `auth.json` | PIN salt and hash |
| `cache.json` | Persisted upstream cache, kept ≤30 days |
| `book.json` | The chosen book, `real` or `paper` |
| `paper/portfolio.json` | Paper book mirror, same shape |
| `paper/{settings,orders,sync}.json` | Paper settings, orders and tickets, sync state |
| `paper/fake-alpaca.json` | Offline fake only |
| `alpaca-paper.json` | Paper keys, mode 0600 |
| `agent-link.json` | Token and proxy secret, mode 0600 |
| `journal.json`, `journal-img/` | Journal and snapshots |
| `charts.json` | Drawings, current settings, named layouts |
| `agent/` | Agent home in the standard profile, including `agent.log` |

**Shapes** (`lib/model.ts`; older files can lack fields)

```ts
StoredLot        { q, px, fxUsd, t, usdBase?, usdBaseCcy?, tx? }
SoldLot          { q, px, fxUsd, t, usdBase, usdBaseCcy }
StoredPosition   { symbol, name?, currency?, quantity, avgCost, lots[] }
StoredAccount    { id, name, type, positions[], transactions[], dividends[], cash{} }
StoredPortfolio  { accounts[], watchlist[], alerts[], settings{}, activeId }
UndoEntry        { at, label, snap: { accounts[], activeId } }
```

Transactions are BUY, SELL, DELETE, TRANSFER, and legacy types. A legacy single-portfolio file migrates into one "Main" account. `quantity` and `avgCost` are always re-derived from lots on load, so a hand-edited file cannot poison P&L.

**Locking and undo**

- `withLock` is one global promise chain. A function holding the lock must never call another lock-wrapped function, or it deadlocks.
- Fetch remote data before taking the lock. Holding it across Yahoo round-trips stalled every other mutation.
- Mutation recipe: `withLock(() => withUndo('Label', () => { … }))`.
- Undo snapshots accounts and `activeId` only, so undoing a trade does not drop a watchlist symbol added since.

---

## 9. Market data and cache

**Sources**

| Source | Used for | Key |
|---|---|---|
| Yahoo Finance | Quotes, history, FX, search, world markets, news, categories, fund data, screens | None |
| FRED CSV export | US macro series | None |
| World Bank v2 | Country indicators | None |
| Forex Factory weekly JSON | High-impact events | None |
| Curated `FOMC_SCHEDULE` | FOMC dates and SEP flags, refreshed each December | n/a |
| Nasdaq IPO calendar | US IPOs | None |
| SEC EDGAR | Filings, facts, Form 4 | None, needs a User-Agent |
| FINRA | Short interest | None |
| Alpaca paper | Paper account | Paper key |
| Tavily, Brave, DeepSeek | Web search (agent) | Provider key |

**Cache semantics** (`lib/cache.ts`, `cached(key, ttl, fn, { stale, persist })`)

- Fresher than `ttl`: served from memory.
- Within `ttl + stale`: served at once and refreshed in the background.
- Older or missing: fetched. If the fetch fails, the last good value of any age is served instead of an error.
- Concurrent callers share one in-flight fetch.
- `persist: true` also writes to `cache.json`, so a restart or a Yahoo outage does not mean a cold terminal.
- `cachedWithStatus` also reports `fresh`, `stale-revalidating` or `stale-fallback`.

| Data | TTL / stale | Persisted |
|---|---|---|
| Quotes | 15 s | Yes |
| Markets | 30 s / 5 min | |
| FX spot | 60 s | |
| Intraday history | 60 s | |
| Daily and weekly history | 5–15 min / 7 d | Yes |
| Earnings details | 6 h / 3 d | |
| Dividends | 12 h / 7 d | |
| Search | 5 min | |
| News | 5 min / 1 h | |
| FRED | 1 h / 7 d | |
| World Bank | 6 h / 30 d | |
| Categories | 24 h / 30 d | |
| Calendar | 1 h / 1 d | |

**Yahoo quirks**

- A rich desktop Chrome User-Agent triggers bot detection. `UA` stays `Mozilla/5.0`.
- `query1` is tried, then `query2`. After 429 on both, calls stop for a cooldown that doubles from 1 to 10 minutes.
- `range=max` returns quarterly bars regardless of interval, so code uses explicit year ranges.

**Offline mode.** `FINSIGHT_FAKE_MARKET=1` replaces global `fetch` (`lib/fakemarket.ts`). Prices are a seeded sine walk ending at the fixture price, so results repeat across restarts. Loopback passes through and any other host throws. `lib/fakealpaca.ts` fakes the Alpaca paper API.

---

## 10. Portfolio accounting

**FX model**

- Market value uses current FX. Cost uses each lot's purchase FX.
- `UNREALIZED = STOCK P&L + FX P&L`.
- Each lot stores `fxUsd` and, when known, `usdBase` for the base currency at purchase, so history in that base is reproducible.
- `lotBuyRate` prefers the persisted rate for this base, then the USD anchor plus weekly USD-to-base history, then today's rate.
- Buys within the last 7 days use the current rate, so a fresh buy shows about zero FX P&L.
- `fxRateAt` records the true rate for back-dated or imported purchases.

**Operations** (`lib/portfolio.ts`)

- `buy`, `sell`, `del`, `setCash`, account add, rename and remove, watchlist, alerts, CSV import.
- `sell` peeks at currency, fetches price and FX outside the lock, then re-validates under it. A sale cannot predate the first purchase. Selling effectively the whole position applies factor 0, so no float dust survives. The consumed slice of each lot is snapshotted so realized P&L can split into stock and FX.
- `ALL` is a read-only merged view with per-account `holdings`. Writes reject it through `resolveAccount`.

**Transfers** (`lib/transfers.ts`). One save and one undo for both accounts. Lots split proportionally and keep date, price and FX. No SELL or BUY and no realized P&L.

**Ledger** (`lib/ledger.ts`). Browses every trade. `editBuy` changes date, price or quantity of a still-open buy, and a date change re-fetches purchase FX. `deleteBuy` removes the transaction and its open lot. `realizedReport` gives closed trades by year with proceeds, cost at actual FX, stock versus FX, holding period, and dividends by year.

**Performance** (`lib/performance.ts`, `lib/returns.ts`)

- Replays BUY, SELL and DELETE in time order to rebuild daily holdings, valued with historical prices and historical FX.
- Buys and sells are cash flows, not gains.
- **TWR**: `periodReturn` measures yesterday's book from close to close, and new money joins after. Only a day starting from nothing uses the new money as the unit. `chainReturns` compounds.
- **XIRR**: Newton from a sensible guess, falling back to bisection, and null with no sign change.
- `annualize` leaves spans under a year unannualised.
- Benchmark: the index's TWR in base currency, plus a shadow portfolio putting the same flows into the index on the same days.
- Response flags: `approx` (holdings with no transaction history, treated as held all window), `transfers` (a buy priced outside the day's range enters at market value), `missing`.

**Dividends** (`lib/dividends.ts`). Gross, tax, net. IBKR statements record actual withholding. Otherwise defaults per market apply: `US 30, SG 0, HK 0, UK 0, EU 15, JP 15.315, AU 0, CA 25, OTHER 0`, changed with the `WHT` command. Forward income uses trailing per-share. `estimateNextEx` uses the median gap of recent ex-dates. `upcomingEvents` covers holdings and watchlist for 60 days.

**FX risk.** `weeklyFxVol` is the standard deviation of weekly log returns over 5 years, driving a 95% 1-week parametric VaR (exposure × 1.645 × σ, summed per currency, which is conservative), cached 6 h.

**Import** (`lib/csv.ts`, `lib/trade-import.ts`)

- `parseIbkrPositions` reads Open Positions and adds Yahoo suffixes from the listing exchange.
- `parseIbkrDividends` attaches matching withholding.
- `parseCsv` finds a header row anywhere and matches columns loosely (moomoo, Tiger, generic).
- `parseIbkrTrades` reads only explicit Trades sections and fails on unsupported instruments or malformed rows rather than losing trades.
- Trade import is a preview with a token, then apply. It adds only fills not already recorded, applies chronologically in memory, and saves once. A stale preview cannot mutate the book.

---

## 11. Other server modules

| Module | Role |
|---|---|
| `lib/discover.ts` | Movers and earnings among held and watched symbols (not market-wide, and the response says so), plus US gainers and losers from Yahoo screens and the Nasdaq IPO calendar. Quotes older than 4 days are stale. Max 200 symbols. Earnings horizon 60 days. Indices, FX, futures and crypto are excluded and listed. Each section fails alone. |
| `lib/macro.ts` | World Bank, FRED, economic calendar. An expired FOMC list says so rather than disappearing. |
| `lib/journal.ts` | Kinds idea, paper, replay, live. Statuses watching, open, closed, cancelled. Metrics in R on the **initial** stop. Records only and never places orders. |
| `lib/charts.ts` | Validated drawings per symbol, opaque size-bounded chart settings, named layouts. Guards `__proto__`. |
| `lib/alertmath.ts` | Drawn-line value in bar-index space, matching what the chart draws, including log scale. Indicator alerts: RSI, SMA, EMA, MFI, CCI, %R. |
| `lib/legacymath.ts` | Typed bridge that `require`s `public/indicators.js`, so browser and server share the same math. |
| `lib/agentlink.ts` | Section 13 |
| `lib/agentproc.ts` | Section 13 |

---

## 12. Paper trading

Files: `lib/paper.ts` (362 lines), `lib/alpaca.ts`, `lib/paperstream.ts`, `lib/book.ts`, `web/src/features/paper/`, `agent/src/tools/paper.ts`.

**Paper only by construction**

- `PAPER_URL` is a constant, and no live URL exists in FinSight.
- `ALPACA_PAPER_URL` can only override to a loopback host for tests.
- Live keys, whose id starts `AK`, are refused. Paper ids start `PK`.
- Keys stay on the server and are never returned.

**Two books.** REAL is `DATA_DIR/portfolio.json`. PAPER is `DATA_DIR/paper/portfolio.json`, a mirror of the Alpaca account. The choice is global in `book.json`, so all tabs and the agent see the same book. Switching posts to the server and reloads the page, so no query retains the other book's data.

**Settings**

```ts
{ approval: 'ask' | 'auto',
  limits: { maxOrderUsd, maxOrdersPerDay, maxPositionPct, symbols } }
```

Default is `ask` with no limits.

**Order rules** (`normalizeOrder`)

- Exactly one of qty or notional.
- Notional is at least 1 and market orders only.
- Limit orders need a price.
- Fractional or notional orders must be `day`. `tif` is `day` or `gtc`.
- US symbols only. `BRK-B` maps to `BRK.B`.

**Kestrel orders**

- `limitBreach` checks allowlist, daily count, order value and position weight. It fails closed without a price.
- Orders serialise through `kestrelQueue`.
- In `ask` mode, an order becomes a ticket. Tickets are claimed inside the `withOrders` lock. Statuses: pending, approving, approved, rejected, failed. The last 200 are kept.
- In `ask` mode, Kestrel may cancel only its own orders.
- Client order ids are `fs-k-…` for Kestrel and `fs-u-…` for the user.

**Mirror sync** (`syncOnce`)

- Replays fills, sets cash, compares against Alpaca positions, and rebuilds once on drift.
- Resets if the account number changes.
- Shorts are not mirrored.
- Coalesced sync (400 ms / 150 ms), a 5-minute backstop poll, and the `trade_updates` stream.

**Stream** (`lib/paperstream.ts`). Built-in WebSocket, no dependency. Authenticate, wait for `authorized`, listen on `trade_updates`. Paper sends JSON in binary frames, so both are decoded. Reconnects at 1 s doubling to 60 s with ±20% jitter. Rejected keys stop it with no retry loop. States: off, connecting, live, retrying, auth_failed.

---

## 13. Agent link and supervisor

**`lib/agentlink.ts`.** `agent-link.json` (0600): `{ token, proxySecret, createdAt }`.

Token GET allowlist: `/api/portfolio`, `accounts`, `quote`, `history`, `history/batch`, `categories`, `events`, `dividends`, `realized`, `portfolio/performance`, `fx-risk`, `ledger`, `watchlist`, `alerts`, `news`, `fred`, `journal`, `calendar`, `markets`, `search`, `fund`, `quote-details`, `paper/state`, `paper/settings`, `book`.

Token POST allowlist: `/api/paper/orders`, `/api/paper/orders/cancel`. Nothing else.

Proxy: `/api/agent/x` to `/v1/x`, adding `x-agent-secret` and `x-finsight-request-id`. Body limits are 64 KB, 22 MB for uploads, and 4 MB for delete-all. Returns 503 `AGENT_OFFLINE` when down.

**`lib/agentproc.ts`.** Spawns `cli.ts start`, through a login shell on macOS so environment keys load. Log at `DATA_DIR/agent/agent.log`. Restart backoff 2 s × 2^n up to 60 s. Gives up after 5 crashes in 10 minutes. Statuses: stopped, disabled, not-installed, external, running, crashed, restarting.

---

## 14. Frontend architecture

**Build** (`scripts/build-web.mjs`). Output in `public/app/` is committed, so a fresh clone runs with no install.

- `bootstrap.js`: classic script, loaded before legacy scripts, owns `window.FinSight`.
- `main.js` and `main.css`: ES module entry; lazy panels become `chunks/*.js`.
- `manifest.json`: every runtime file, for the service worker.
- The build also keeps `index.html`'s modulepreload list current.
- CSS modules scope to `fs-<File>-<hash>_<class>`.

**Boot order:** `bootstrap.js`, then legacy chart scripts, then `main.js`.

**Startup performance (H1).** `index.html` starts the session check and, for a signed-in session, accounts and portfolio before any script loads (`api/early.ts`). Each early response is handed out once. React 19 holds Suspense reveals until 300 ms after the last fallback across all roots, so island hosts wait for their chunk before mounting, and a loaded chunk's thenable resolves synchronously so no fallback appears.

**Islands.** The page is one React app (`App.tsx`) whose mount points are island hosts (`data-island`), each with its own lazy root, so a chunk failure stays in its panel. Panels are stable elements moved between columns, with contents portalled in.

Registered islands: Account, AccountsModal, Activity, AddForm, Alerts, Allocation, Base, Book, Calendar, CashEditor, Clock, Command, Detail, Dialog, Discover, Dividends, Footer, Fred, FxRisk, Heatmap, Import, Inflation, Kestrel, LayoutButton, LayoutModal, Ledger, LockButton, Lock, Markets, Mode, News, Paper, Peek, Performance, Positions, Profile, Setup, Status, Summary, Ticker, Toast, TradeSheet, Watchlist, Wealth, WorldBank.

**Shell modules**

| File | Role |
|---|---|
| `shell/boot.ts` | Session check, lock screen, account resolution (`accountReady` gates every query), refresh on returning to the tab, offline screen with retry |
| `shell/layout.ts` | Columns, order, hidden panels, drag rearrange |
| `shell/chartHooks.ts` | Chart watch list, trade markers scoped per account with a request token, multi-chart grid |
| `shell/chunkGuard.ts` | Recovers from failed chunks across a deploy. Identifies a build by loader source text. Will not reload over unsaved input |
| `shell/compat.ts` | Window names used by older specs and the console |

**Default layout**

- Left: `positions, performance, wealth, allocation, heatmap, watchlist, alerts, fxrisk, dividends, activity`
- Right: `detail, kestrel, news, markets, discover, calendar, worldbank, fred, inflation`

**State and data**

- `api/client.ts`: `ApiError`. While locked, protected requests fail without touching the network.
- `api/queries.ts`: TanStack hooks. Hooks stay disabled until the account is known, so nothing is sent with an uninitialised account. Polling pauses while locked or hidden.
- `api/invalidation.ts`: map of writes to reader keys, with `accounts` first where a write can remove the active account. Failed readers do not block others.
- `state/store.ts`: Zustand UI state, including modals opened before their island mounts.

**localStorage keys:** `finsight-profile`, `-base`, `-cards`, `-chart-cfg`, `-layout`, `-panels`, `-theme`, `-font`, `-mode`, `finsight-draw:<SYMBOL>`, `finsight-agent-*`, `kestrel.councilView`.

**Service worker.** Precaches the manifest's files, is network-first, and never caches the API.

**PEEK.** `body.unpeek` hides sensitive numbers. It applies at load, before any lazy island. Council finding text and counts blank too.

---

## 15. Frontend features

`web/src/features/`: activity, addform, alerts, analytics, cash, clock, command, detail, discover, dividends, fxrisk, kestrel, layout, ledger, lock, macro, markets, news, paper, positions, summary, ticker, topbar, trade, watchlist. `web/src/ui/` holds shared components. `web/src/legacy/` holds bridges to the classic scripts.

**Charts** (`public/chart.js`). Canvas engine with drawings, indicators, volume profile, relative strength, anchored VWAP, strategy overlays, trade and dividend markers, multi-chart grid, saved layouts, line and indicator alerts.

**Indicators** (`public/indicators.js`). The same bytes run in the browser and through `lib/legacymath.ts` on the server.

---

## 16. Kestrel: overview and config

Agent home is `AGENT_HOME`, holding `config.json`, `agent.db`, `logs/`, `uploads/`, and installed skills.

**`config.json`** is strict-validated.

| Key | Default or values |
|---|---|
| `port` | agent port |
| `finsightUrl` | `http://127.0.0.1:8001` |
| `finsightDataDir`, `finsightRepo`, `recordsDir` | paths |
| `defaultBrain` | `deepseek-flash` |
| `uiViews` | boolean |
| `council` | false |
| `assistantName` | Kestrel |
| `timezone` | string |
| `logRetentionDays` | 14 |
| `searchProvider` | `tavily`, `brave`, `deepseek`, `none` |
| `fetchProvider` | `local`, `deepseek` |
| `edgarUserAgent` | string |
| `limits` | below |

**Limits** (`LIMIT_DEFAULTS`)

| Limit | Default |
|---|---|
| `turnSteps` | 25 |
| `turnSeconds` | 300 |
| `turnUsd` | 0.25 |
| `dayUsd` | 5 |
| `searchesPerTurn` | 20 |
| `fetchesPerTurn` | 25 |
| `councilResearchCalls` | 8 |
| `councilTurnUsd` | optional, falls back to `turnUsd` |
| `councilOutputTokens` | optional, falls back to 2000 |

`saveLimits` writes atomically. The settings dialog edits these through `GET` and `PATCH /v1/limits`.

**Secrets** (`secrets.ts`). macOS Keychain (service `finsight-agent`, account = key name), then the process environment, then a 0600 env file in the home. Values are registered with the log redactor.

---

## 17. Kestrel: HTTP API

Host allowlist. Any `Origin` header is rejected, since only FinSight's server calls it. `x-agent-secret` compares timing-safe.

| Method and path | Purpose |
|---|---|
| `GET /v1/health` | Unauthenticated `{ok:true}` |
| `GET /v1/brains`, `search-providers`, `info`, `skills`, `plugins`, `strategies` | Discovery. `info` reports version 0.2.0 and the Council flag |
| `POST /v1/uploads` | Attachments |
| `GET /v1/logs` | Interaction log |
| `/v1/threads` CRUD | `DELETE` needs `?confirm=true` |
| `/v1/threads/delete-all`, `/preview` | Bulk delete with preview |
| `POST /v1/threads/:id/messages` | Send: `content` ≤12000, `brain`, `search`, `effort`, `lens`, `pageContext{view,symbol,timeframe,strategy,account,base}`, `idempotencyKey`, `expectedVersion`, `attachmentIds` ≤5 |
| `POST /v1/threads/:id/stop` | Stop a turn |
| `GET /v1/threads/:id/events` | SSE, replay from `Last-Event-ID`, subscribe-then-replay de-duplication, 15 s heartbeat |
| `GET /v1/turns/:id/trace` | Steps and cost |
| `GET, PATCH /v1/limits` | Limits |
| `GET /v1/cost` | Spend |
| `GET /v1/usage?period=day\|week\|month\|all` | By model and search provider, next to prices (`PRICES_CHECKED` 2026-11-10) |
| `/v1/proposals`, accept and reject | Record updates |

---

## 18. Kestrel: chat engine

`agent/src/chat/engine.ts`.

**Rules**

- One running turn per thread.
- `idempotencyKey` de-duplicates sends, and `expectedVersion` provides optimistic concurrency.
- The daily cap is checked first.
- A crashed turn is marked interrupted at startup.
- Events are pruned at 30 days.

**Message blocks** (provider-neutral)

`text`, `notice`, `attachment`, `tool_call`, `tool_result`, `image`, `citation`. Notice kinds: lens, skill, page_context, context_pack, limit, error, stopped, truncated, refusal, council, council_evidence, research_scope.

**Loop**

1. Build context and call the brain.
2. Run tool calls, at most 4 in parallel, through the registry.
3. Continue until the model finishes.
4. Over a limit (steps, cost, or 80% of time), make one final no-tools call with `FINAL_ANSWER_NUDGE`.

**Retries.** Transient errors retry up to 3 times, only before any text has been emitted, with backoff min(8000, 500·2^n)·(0.5+rand).

**Context pack.** TTL 15 minutes.

**UI sources.** `get_portfolio`, `query_positions`, `get_cash`, `get_exposures`, `get_accounts`, `get_quote`, `get_history` register results that `render_ui` can bind to. `render_ui` with `complete:true` can end the turn.

**SSE events.** `turn.started`, `delta`, `tool.started`, `tool.finished`, `ui.render`, `citation`, `turn.finished`, `turn.stopped`, `turn.failed`, `turn.retry`, `budget.warning`, `council.progress`.

**Event bus** (`chat/bus.ts`). Each event persists first, then goes to subscribers. Text deltas coalesce at about 40 ms to avoid one database write per token.

---

## 19. Kestrel: context and prompt

**Context** (`chat/context.ts`)

- Budget = floor(contextTokens × 0.9) − maxOutput − bytes(system) − bytes(tools).
- UTF-8 bytes overestimate tokens on purpose. An image counts 16,384.
- Whole turns are kept, newest first.
- A current turn that cannot fit returns `CONTEXT_TOO_LARGE`.

**Prompt** (`chat/prompt.ts`). A stable prefix for prompt caching plus `DATE_SUFFIX`. Rules cover numbers, strategies, documents, web content, and boundaries: no real-money orders, paper orders always called paper, durable facts only through `propose_record_update`.

---

## 20. Kestrel: brains

A brain is a plugin folder in `agent/plugins/brains/` with a manifest. Adapters: `openai` (chat-completions compatible), `responses` (stateless Responses API), `anthropic`, `claudecode`, `mock`.

| Id | Model | Input / output per million | Context | Notes |
|---|---|---|---|---|
| `deepseek-flash` | DeepSeek | $0.30 / $1.20, cache $0.006 | 1M | Off-peak ×0.5 outside weekday UTC 1–4 and 6–10. UI views. Thinking none, low, high, max (default high). Max output 8000 |
| `deepseek-pro` | `deepseek-v4-pro` | $1.32 / $3.96 | | |
| `gpt-6-luna` | Responses | $0.10 / $0.50 | 1.05M | UI views. Long context over 272K ×2 input, ×1.5 output. Max 4000. Thinking none to max (default none) |
| `gpt-6-sol` | Responses | $2 / $10 | 272K | No UI views |
| `haiku` | `claude-haiku-5-5` | $0.10 / $0.50 | | Vision. Long context over 100K ×5 / ×5. Max 16000 |
| `sonnet` | `claude-sonnet-5-5` | $2 / $10, cache $0.10 | | Effort medium. Max 16000 |
| `claude-code` | CLI, `sonnet` | subscription | | Native search |

**`costOf`** handles cache read, cache write (×1.25), long context, off-peak, and per-search pricing.

**Adapter details**

- `openai`: newer OpenAI models reject `max_tokens`, while compatible providers still use it. That stays a transport detail.
- `responses`: stateless. Encrypted reasoning stays with its output items, bound to the same brain, model and origin, and is never rendered. Provider error bodies stay out of chat.
- `anthropic`: the stable prefix is cached. Assistant content, including thinking blocks, is kept verbatim in `providerExtra` and replayed only to the same brain. A refusal or `max_tokens` can cut a `tool_use` mid-input, so those calls never run.
- `claudecode`: runs `claude -p` with our tools over MCP, in an empty scratch cwd, with built-in tools limited to WebSearch and WebFetch, no shell, edit or write, no user settings, no session persistence, and a hard timeout.

---

## 21. Kestrel: tools

53 tools at runtime. The registry is the single source for chat, Council, and MCP.

**Registry behaviour.** Name regex, zod validation, default 30 s timeout, `MAX_RESULT_CHARS` 30,000 with a truncation note. `render_ui` allows 3 attempts and 24 KiB. SEC requests are paced at least 110 ms apart through `secSlot`, across the process.

| Group | Tools |
|---|---|
| UI | `render_ui` |
| Context | `get_context_pack` |
| Portfolio | `get_portfolio`, `query_positions`, `get_exposures`, `portfolio_weights`, `get_cash`, `get_accounts` |
| Market | `get_quote`, `get_history`, `search_instruments`, `get_fund_profile`, `get_earnings_dates`, `get_events`, `get_news`, `get_macro_series` |
| Reports | `get_dividends`, `get_realized`, `get_performance`, `get_fx_risk`, `get_ledger`, `get_watchlist`, `get_alerts`, `get_journal` |
| Attachments | `list_attachments`, `read_attachment`, `search_attachments` |
| Records | `get_policy`, `get_profile`, `get_decisions`, `search_memory`, `propose_record_update` |
| Strategies | `list_strategies`, `get_strategy`, `run_strategy`, `scan_strategies`, `size_position` |
| Web and SEC | `web_search`, `fetch_url`, `edgar_filings`, `edgar_financials`, `valuation_metrics`, `edgar_recent_8k` |
| Research | `insider_trades`, `short_interest`, `technical_indicators`, `dcf_valuation`, `peer_comparison` |
| Paper | `paper_account`, `paper_place_order`, `paper_cancel_order` |
| Skills | `use_skill`, `read_skill_file` |

**Weight bases** (`tools/facts.ts`). `weightPct` is the share of securities value, matching the terminal. `weightInclCashPct` divides by securities plus cash. Every weight-bearing result names its basis and denominator so they are never compared silently. Unknown liabilities stay unknown, never zero.

**Classification.** Results say `sector`, `instrument_type`, `label` or `unclassified`. A sector is economic, and an instrument type says nothing about what a fund holds. A failed lookup is unclassified rather than silently "Other". Membership is reported, so a group's makeup is never inferred from names.

**History compression.** A year of daily points becomes a summary plus month-end samples.

**Web safety** (`tools/netguard.ts`). Blocked IPv4 and IPv6 ranges are checked inside DNS lookup, so rebinding cannot pass. Redirects are re-checked, with 5 redirects, 10 MB, 20 s, and an allowed content-type list. Search provider can be set per message, and availability means key presence.

---

## 22. Kestrel: research computations

All in `tools/web.ts` and `tools/research.ts`. URLs are built in code, never taken from the model.

**SEC handling**

- `latestShares`: latest cover-page count summed across share classes in the same filing. Filers with no cover count (GOOGL) use the latest diluted weighted average, and it is named as such.
- `ttm`: four consecutive discrete quarters when present, else latest fiscal year plus the year-to-date change. A first-quarter YTD counts.
- `reportedFacts`: maps US GAAP names to `ifrs-full` for foreign filers.
- `filerType`: 20-F, 40-F and 6-K mean foreign private issuer.
- `ADR_RATIOS`: curated ordinary-per-ADR with a filing source. A foreign issuer missing here gets **no** market cap or per-share multiple, because a wrong ratio would be wrong by the ratio. Dual-class issuers are left out deliberately.
- `EARNINGS_6K`: only a 6-K naming quarterly results counts as an earnings release.
- `PENDING_EVENT`: an agreement's effects are potential until close, detected from the filing's wording.
- `exhibit99`: finds the press release among a filing's files. `secHtml` unwraps SGML envelopes.

**Insiders** (`parseForm4`, `summariseInsiders`, `applyAmendments`). Only codes P and S count as discretionary trades. A Form 4/A replaces the original for the same owner set and period.

**Short interest.** FINRA fields that come back null stay null, never 0.

**Technicals** (`technicals`). SMA in O(n), Wilder RSI, most recent 50/200 cross, returns, volatility.

**Fundamentals** (`fundamentals`)

- Revenue CAGR merges fiscal years across concepts, since filers switch concept names.
- Balance-sheet items all come from one date, the latest cash date.
- `LongTermDebt` already includes the current portion.
- Margins and FCF require both legs on the same trailing period.

**DCF** (`dcfPerShare`, `impliedGrowth`). Explicit FCF years, with growth optionally fading linearly to terminal, plus Gordon terminal value. Reverse DCF solves first-year growth, null outside −50% to +150%. Refusal is decided by typed blockers, never by the wording of a gap.

**Peers** (`peer_comparison`). Two companies at a time, rows in input order. Stale figures stay out of medians.

---

## 23. Kestrel: strategies and sandbox

**Library** (`public/strategies.js`): five strategies, costs of 10 bps per side plus 5 bps entry slippage, stop checked before target, no look-ahead tests.

| Id | Name | Rule summary | NDX evidence (2026-10-15, survivorship-biased) |
|---|---|---|---|
| `pullback` | Pullback (Martin Luk) | Momentum leader pulls back to 21 EMA, buy break of setup bar high | −0.16R |
| `breakout` | Breakout / VCP | Stage-2, tight base near highs, buy 20-day pivot break | +0.05R |
| `matrend` | MA trend (50/200) | In 50>200, buy reclaim of 50-day, exit close below 200-day | +4.9% per trade |
| `rsi2` | RSI-2 (Connors) | Above 200-day, buy 2-day RSI washout, sell above 5-day average | 0.0R |
| `dcazones` | 200-day / Fib DCA zones | Add near 200-day or 38.2% of last 126-bar up-move | +5.1% vs +4.0% 63-day |

All have status `backtested`, recorded in `agent/plugins/strategy-evidence.json`. None has proven edge.

**Sandbox** (`sandbox/host.ts`, `strategy-worker.cjs`). Child process under the Node permission model, 10 s default and 256 MB. Ops are `list` and `run`. `compact()` returns only the last 3 trades. Private plugins live in `~/FinSightData/strategies/<id>/` and export `run(bars, params)`. Agent tools use 2 years of daily bars.

---

## 24. Kestrel: Investment Council

Files: `chat/council.ts`, `council-contract.ts`, `council-evidence.ts`, `council-metrics.ts`, `council-readiness.ts`, `council-service.ts`, `research-subjects.ts`, `shared/council-lenses.ts`, `agent/docs/COUNCIL.md`.

**Entry.** `/committee` or `/debate`. Requires `cfg.council`, an API brain without native search, and no attachments. Qualified only for `deepseek-flash` with effort `none`, otherwise `COUNCIL_MODEL_UNQUALIFIED` (mock excepted). No other API reply runs in the thread while a Council runs.

**Flow**

1. **Subject resolution**: one model call proposes `explicit`, `reference`, `general` or `clarify`. Candidates are verified through `/api/search` and must have matching positive quotes. The chart never substitutes for a named company. A clarification or unavailable subject stops the run.
2. **Evidence plan**: code retrieves evidence before any specialist runs.
3. **Seven stages**: 3 assessments (growth, macro, risk; concurrency 2), 3 sequential challenges, chair synthesis.
4. **Readiness** prepended to the answer.

**Evidence plan.** `PLAN_LIMITS {subjects:3, items:37, concurrency:3}`.

- Each SEC equity: history, financials, valuation, earnings8k, 8k, technicals, insiders, short, plus two code-built news searches.
- Funds: history, fund profile, issuer marked `unavailable`.
- Shared: events:earnings, portfolio:weights (and selected account), portfolio:sectors, portfolio:policy, macro:DGS10.
- Item status: `retrieved`, `failed`, `not_applicable`, `unavailable`, `skipped_limit`.

**Specialist tools**

- Risk: `get_exposures`, `query_positions`, `portfolio_weights`, `get_cash`, `get_policy`, `technical_indicators`, `short_interest`.
- Growth and macro: `get_quote`, `get_history`, `edgar_filings`, `edgar_financials`, `valuation_metrics`, `edgar_recent_8k`, `get_earnings_dates`, `web_search`, `fetch_url`, `insider_trades`, `short_interest`, `technical_indicators`, `dcf_valuation`, `peer_comparison`.

One research batch per specialist (config default 8 calls; runtime fallback 4). Excess calls are acknowledged but not executed. A specialist that lists gaps without researching is nudged once. Fetches cap at 6000 chars. Output is min(`councilOutputTokens` ?? 2000, model max). At most 4 findings. One validation or metric repair per stage.

**Contracts**

```ts
Evidence { id, source, observedAt, retrievedAt }
Finding  { claim, evidenceIds, assumptions, uncertainty, counterevidence,
           invalidation, missingEvidence }
Decision { verdict: 'buy_now'|'wait'|'no_action'|'insufficient_evidence',
           rationale, buyNow, wait, noAction, valuation, momentum,
           changesView, evidenceIds }
```

`Decision` is required when `DECISION_QUESTION` matches. `buy_now` is downgraded if the macro assessment did not complete. Stage failure causes: budget, context, tool, validation, model, stopped.

**Budget**

- Reservation = ((bytes + 8192) × input + output × outputPrice) / 1e6, at the highest long-context tier, held in both turn and day budgets.
- A quarter of the cap is held for the chair.
- Web requests reserve US$0.01.
- `reserveWhenSettled` waits for in-flight calls.
- The ledger row is `council-reserved` until reconciled. A failed or unknown call keeps the conservative reservation, never a fake zero.

**Figure checks** (`council-metrics.ts`). No model judgement. Issues trigger the one repair.

- A percentage in a claim must appear in the evidence it cites. Rounded figures match.
- One claim must not mix weight bases.
- Group membership must agree with the cited exposure result. Negated statements agree.
- Qualitative words such as "nearly doubled" must match the figures.
- A pending agreement's effects must not be stated as settled.
- All-account figures must name that scope.
- Approximate trailing P/E must be called approximate.
- Guidance stated as midpoint and tolerance: code computes the bounds.
- Counterevidence must name supplied evidence.

**Readiness.** `ready`, `partial`, `insufficient`. Always at least partial today, because qualitative claims have not been independently verified. A non-ready run ends with stop reason `council_partial` or `council_insufficient`.

**Lenses** (`shared/council-lenses.ts`, version 1)

| Id | Priorities | Limitation |
|---|---|---|
| `balanced` | capital preservation, concentration, downside, policy fit | Missing policy is not permission to assume one |
| `growth` | business quality, growth durability, unit economics, reinvestment, valuation expectations | Growth does not establish suitability |
| `speculative` | catalysts, payoff scenarios, dilution, liquidity, permanent loss, invalidation | Do not assume leverage or stop rules |
| `hedge-fund` | variant perception, catalysts, downside, positioning, hedging evidence | No privileged access; disclose missing positioning data |
| `macro` | inflation, employment, credit, liquidity, policy transmission, alternative scenarios | Tie macro evidence to the question |

**Evidence so far.** Pilot 5 of 6, reliability rerun 6 of 6, and no demonstrated superiority over the Balanced single-lens path. Generic installs default off.

---

## 25. Kestrel: intelligent UI

Files: `ui/schema.ts`, `tools/ui.ts`, `ui/qualification.ts`, `web/src/features/kestrel/ui/UiView.tsx`, `agent/docs/INTELLIGENT-UI.md`.

- The model sends a `UiRequest` (version 1) to `render_ui`. `bindUi` fills it from completed tool results, so numbers come from code and not from model-typed arguments.
- Only the accepted `UiSpec` reaches the browser, and every spec has a text `fallback` of up to 16,000 chars. Max 24 KiB.
- Kinds exercised by qualification: `stat_grid`, `table`, `price_chart`, `exposure_chart`.
- A tiny nonzero quote or quantity is never displayed as an invented zero.
- Views persist in the `ui_views` table.
- Enabled per brain (manifest `ui`) and by `KESTREL_UI` or `uiViews`.
- `agent/scripts/qualify-ui.ts` runs a fixed synthetic evaluation with no personal holdings, web, or paid judges.

---

## 26. Kestrel: supporting subsystems

**Database** (`store/db.ts`). better-sqlite3 in WAL mode. Tables: `schema_migrations`, `threads`, `messages`, `turns`, `events`, `trace_steps` (with cache columns), `cost_ledger` (with token columns), `cache`, `proposals`, `fts_messages`, `ui_views`. 4 migrations. Backup `agent.db.bak-v<N>` before migrating.

**Skills** (`skills.ts`). Folders with `SKILL.md`. Only name and description enter the system prompt, and the body loads through `use_skill` or `/<name>`. Instructions only, with the same tools as chat. `agent skills add` installs text files, size-capped, from a GitHub folder URL.

**Records** (`tools/records.ts`). `INVESTMENT_POLICY.md`, `INVESTOR_PROFILE.md`, `DECISION_LOG.md` in `recordsDir`, path-confined.

**Uploads** (`uploads.ts`). At most 5 files, 15 MB each. PNG, JPEG, GIF, WebP, PDF, DOCX, TXT, MD, CSV, JSON. Type is checked by magic bytes, not name. Text extracts locally so every model can read documents. Images go only to vision models. Stored 0600.

**Logs** (`obs/audit.ts`, `log.ts`). Daily JSONL under `<home>/logs/`, one line per API request, model request and response, tool call, FinSight call, MCP call, and error. Correlation ids flow through AsyncLocalStorage. Redacted, large fields capped, 14-day retention.

**MCP** (`mcp/server.ts`). Stdio, same registry. Stdout is the protocol, logs go to stderr. One budget per session, using the same per-turn limits.

**FinSight client** (`tools/finsight.ts`). Reads `agent-link.json`. GET on the allowlist and POST to paper order routes only. Paper errors keep their user-facing reason.

---

## 27. Kestrel: chat frontend

`web/src/features/kestrel/`.

| File | Role |
|---|---|
| `KestrelIsland.tsx` | Drawer, dock, full page (`body.agent-full`), run capsule, ⌘/ toggle, Esc stops a reply or closes but never discards a typed message |
| `Chat.tsx` | Log, composer, slash menu, attachments, model and search pickers, briefing tiles, workspace column in full page |
| `chat.ts` | State outside React, so the stream and draft survive moving between drawer and dock |
| `turns.ts` | A turn as ordered parts (text, tool, notice, council, ui), citations, meta, readiness |
| `council.ts` | One view model for cards, chain, compact, capsule. Built only from public summaries |
| `md.ts` | Safe markdown subset. Text is escaped first, links must be http(s) |
| `briefing.ts` | Start screen from FinSight data with no model call |
| `limits.ts`, `usage.ts` | Settings dialog: Usage and Limits tabs |
| `ui/UiView.tsx` | Renders accepted views, lazy-loaded |

**Slash commands in the composer:** `/new`, `/model`, `/cost`, `/limits`, `/strategies`, `/skills`, `/logs`, `/help`, `/delete`, `/clear`, plus `/committee` and `/debate` for Council and `/<skill>`.

---

## 28. Testing

| Suite | Command | State at this snapshot |
|---|---|---|
| Agent typecheck, tests, secret scan | `npm run agent:test` | 265 of 265 passed before `e17a083` |
| Root and web unit | `npm test` | 272 of 272 passed |
| Types | `npm run typecheck` | Passed |
| Web build freshness | `npm run check:web` | Passed |
| Playwright | `npm run e2e` | Not run for `e17a083` |

**Playwright projects** (`playwright.config.ts`). Throwaway servers with `FINSIGHT_FAKE_MARKET=1` and temp folders. It never touches `~/FinSightData`. Serial, one worker, no retries.

| Project | Port | Setup | Specs |
|---|---|---|---|
| chromium | base+3 | Agent off | Most specs |
| agent | base+2 and fake agent base+1 | `web/e2e/fake-agent.mjs` | `*.agent.spec.ts` |
| sw | base | Temp copy of the app, service workers on | `*.sw.spec.ts` |

`*.realagent.spec.ts` is excluded by default. `E2E_PORT_BASE` lets two worktrees run at once. `web/e2e/COVERAGE.md` tracks coverage.

**Evaluation scripts.** `agent/scripts/evaluate-council.ts` with `agent/evals/council-cases.ts`, `qualify-ui.ts`, `cache-probe.ts`.

---

## 29. Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | 8000 | FinSight port |
| `HOST` | 127.0.0.1 | Bind address |
| `FINSIGHT_DATA_DIR` | `./data` | Data folder |
| `FINSIGHT_CACHE_PERSIST` | | Cache persistence switch |
| `NOTIFY` | | Desktop notifications |
| `ALERT_INTERVAL` | 60 | Alert check, seconds, min 15 |
| `LOCK_IDLE_MIN` | 480 | Idle lock minutes |
| `AGENT_AUTOSTART` | | Supervise the agent |
| `AGENT_DIR`, `AGENT_URL`, `AGENT_SHELL_ENV` | | Agent location, URL, login-shell env |
| `ALPACA_PAPER_KEY_ID`, `ALPACA_PAPER_SECRET_KEY`, `ALPACA_PAPER_URL` | | Paper keys; URL is loopback-only override |
| `FINSIGHT_FAKE_MARKET` | | Offline fixtures |
| `FINSIGHT_DEMO_DIR`, `FINSIGHT_DEMO_MODE` | `~/FinSightDemo` | Demo |
| `AGENT_PORT`, `AGENT_HOME`, `AGENT_BRAIN`, `AGENT_NAME` | | Agent settings |
| `AGENT_DEBUG`, `AGENT_NO_KEYCHAIN`, `AGENT_PARENT_PID` | | Debugging, skip Keychain, parent tracking |
| `FINSIGHT_URL`, `FINSIGHT_REPO`, `RECORDS_DIR` | | Agent paths |
| `KESTREL_UI`, `KESTREL_COUNCIL` | | Feature switches |
| `TAVILY_API_KEY`, `BRAVE_API_KEY` | | Search keys |
| `MCP_CLIENT` | `mcp` | MCP client label |
| `E2E_PORT_BASE` | 8096 | Playwright ports |

Model API keys resolve through the secret store in section 16.

---

## 30. Doc and code mismatches

Trust the code over these.

| Document | Says | Actual |
|---|---|---|
| `docs/architecture/kestrel-architecture.md`, `finsight-architecture.md` | 38 tools, read-only, 8 steps, $0.05 cap, `propose_trade`, `get_sec_filing`, Claude 3.5 Haiku | 53 tools, paper orders allowed, 25 steps, $0.25; those two tools do not exist |
| `agent/README.md` | Older sample limits and model list | Section 16 and 20 |
| `agent/docs/SPEC.md` | Workflows and task queue (FR-5), task and run endpoints | Not implemented in the router |
| `agent/docs/SPEC.md` | Strategy `signal/exit` engine contract | Strategies are `run(bars, params)` analysers |
| `agent/docs/SPEC.md` | FR-4.12 10 s limit | Scans use up to 110 s |
| `agent/docs/SPEC.md` | Private repo | Agent lives in `agent/` of this repo |
| `agent/docs/COUNCIL.md` | Early sections | Historical; read the latest sections |
| `docs/BACKLOG.md` | KESTRELTOOLS-001 uncommitted | Committed in `67ee925` |
| `agent/package.json` | Version 0.1.0 | `/v1/info` reports 0.2.0 |

---

## 31. Feature status

| Id | Feature | Status |
|---|---|---|
| FEAT-001 | IBKR MCP live sync | Deferred |
| FEAT-002 | Investment Council and lenses | Delivered; generic default off; COUNCILQUALITY-001 open |
| FEAT-003 | Chat deletion | Merged, `d9ee5c8` |
| FEAT-005 | Prompt cache optimisation | Merged, `d9ee5c8` |
| FEAT-006 | New-symbol trade sheet | Merged, `d9ee5c8` |
| FEAT-007 | Account transfers | Merged, `d9ee5c8` |
| FEAT-008 | IBKR trade import | Merged, `d9ee5c8` |
| FEAT-009 | Council full-page UI | Merged in PR #1 |
| FEAT-010 | Market Discover | Merged locally |
| FEAT-011 | Agent data sources | Deferred |
| FEAT-012 | Paper trading | Merged locally; live run verified 2026-11-03 |
| FEAT-013 | Agentic trading | Planned, not selected: paper-trade-cycle, TradeProposal, bracket orders, L2 triggers, scorecard |
| KESTRELTOOLS-001 | Research tools | Committed `67ee925` |
| IDEA-001 to 004 | Ideas | Backlog only |

**Git state.** `e17a083` is pushed to `origin/feat/kestrel-research-tools`. No pull request exists for that branch yet.

---

## 32. Quant engine status and design

**Target architecture** (as supplied by the user)

| Layer | Scope | Intended implementation |
|---|---|---|
| Research Agent | News, filings, earnings, macro, fundamentals | Qwen3.7 Plus or Claude Haiku 5.5 |
| Quant Engine | Indicators, backtesting, returns, volatility | Python and market APIs |
| Investment Analyst | Bull/bear, valuation, thesis | DeepSeek V4.1 Flash |
| Risk and Validation | Exposure limits, sizing, conflicting evidence, stale data | Deterministic code, optional LLM reviewer |
| Paper Trading Simulator | Fills, positions, cash, P&L, audit trail | |

**What exists**

| Capability | Where | Limit |
|---|---|---|
| Indicators | `public/indicators.js`, `technical_indicators` | Complete enough |
| Returns and volatility | `technical_indicators` (`agent/src/tools/research.ts`), `lib/returns.ts` | Per symbol, or whole-book TWR |
| Backtesting | Five fixed strategies via `run_strategy` and `scan_strategies` | Single symbol, no portfolio view, 2y bars to agent tools |
| Sizing | `size_position` | |
| Risk checks | Paper limits, Council figure checks, freshness metadata | No dedicated risk engine |
| Paper | Alpaca mirror | Real provider, not a simulator |

**What is missing.** Portfolio backtest, Sharpe and drawdown across a book, walk-forward validation, saved runs, and user-defined rules without code. There is no Python at runtime.

**Recommended design, proposed as FEAT-014 and not yet selected**

Stay in TypeScript and extend the strategy engine rather than adding a Python service, which would break the zero-dependency, single-runtime model.

1. New `backtest` op in `sandbox/strategy-worker.cjs` returning **all** trades, not `compact()`.
2. Pure portfolio replay module: date-ordered entries across symbols, position caps, cash, costs, equity curve.
3. Metrics module: CAGR, volatility, Sharpe, Sortino, max drawdown, exposure, turnover, win rate, expectancy, benchmark comparison.
4. `backtest_portfolio` tool with parameters validated by zod.
5. Saved runs in `agent.db`, through a new migration.
6. Then walk-forward validation, JSON rule strategies, and an equity-curve view.

Survivorship bias in the universe must be disclosed on every result.

---

## 33. How to change things

**Add a server mutation**

1. Fetch remote data first.
2. Write `withLock(() => withUndo('Label', () => { … }))`.
3. Add the route in `server.ts`. If paper mode must refuse it, add it to `PAPER_READONLY`.
4. Add the reader keys in `web/src/api/invalidation.ts`.
5. Test in `test/`.

**Add a panel.** Create the island component, register it in `web/src/islands.ts`, add a host in `App.tsx`, add it to `DEFAULT_COLUMNS`, and add `PANELS` and `HIDE_ID` entries if it can be hidden. Run `npm run build` and commit `public/app`.

**Add an agent tool.** Define it with a zod schema in the right `agent/src/tools/` file and register it in `tools/index.ts`. Compute in code. Return `asOf` and source. If it needs a new FinSight route, add that to the token allowlist in `lib/agentlink.ts` and keep it read-only. Add it to a Council role only with a test. Add `TOOL_VERBS` wording if the chat should describe it.

**Add a brain.** Add a folder in `agent/plugins/brains/` with a manifest including pricing, context size and capabilities. Reuse an adapter. The Council stays unqualified until the evaluation passes.

**Before committing.** Run `npm run agent:test`, `npm test`, `npm run typecheck`, `npm run check:web`, and `npm run e2e` when UI changed. Check the diff for personal data.

---

## 34. Glossary

| Term | Meaning |
|---|---|
| Book | REAL or PAPER portfolio |
| Brain | A model plugin |
| Council | Multi-role review run |
| Evidence plan | Code-retrieved evidence before specialists run |
| Island | A panel with its own lazy React root |
| Lens | A versioned analytical perspective |
| PEEK | Numbers visible (`store.peek` true) |
| R | Profit or loss in units of initial risk |
| Skill | Folder of instructions for the model |
| Ticket | A Kestrel paper order awaiting approval |
| TWR | Time-weighted return |
| UNPEEK | Sensitive numbers hidden (`body.unpeek`) |
| XIRR | Money-weighted annual return |
