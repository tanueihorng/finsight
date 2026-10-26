# FINSIGHT // PERSONAL TERMINAL — Developer Docs

Technical reference for configuration and the HTTP API. Start with [the documentation index](docs/README.md) and [current architecture](docs/architecture/SYSTEM.md).
For day-to-day usage see [README.md](README.md).

---

## Architecture

A single **zero-dependency Node.js** process (built-in `http` + native `fetch`, Node 24+, which runs the TypeScript server directly):

```
browser ──HTTP──▶ server.ts ──┬─▶ public/*  (static terminal UI + service worker)
                              └─▶ /api/*    (JSON API)
                                     ├─▶ Yahoo Finance / World Bank / FRED  (free, no key)
                                     └─▶ data/portfolio.json                (local store)
```

`server.ts` is only the HTTP layer; the logic lives in `lib/`:

| Module | Responsibility |
|---|---|
| `config.ts` | Ports, paths (`FINSIGHT_DATA_DIR`), Yahoo user agent |
| `cache.ts` | Stale-while-revalidate cache, in-flight de-dupe, persistence to `data/cache.json` |
| `market.ts` | Yahoo: quotes, history, FX, search, markets, news, sectors, earnings/dividend details (429 backoff) |
| `macro.ts` | World Bank, FRED, economic calendar (FOMC schedule + Forex Factory) |
| `store.ts` | Load/migrate/save `portfolio.json`, account views, write lock, undo snapshots |
| `portfolio.ts` | Buy/sell/delete, accounts, cash, live P&L + stock/FX split, FX risk, watchlist, alerts, import |
| `performance.ts` | Trade replay → value, TWR, XIRR, benchmark |
| `returns.ts` | Pure return math (period return, TWR chaining, XIRR) |
| `dividends.ts` | Withholding tax, forward income, upcoming earnings / ex-dividend dates |
| `ledger.ts` | Trade ledger, buy edits/deletes, realized-gains report |
| `csv.ts` | CSV / IBKR statement parsing (pure) |
| `auth.ts` | PIN hashing, sessions, throttling |

Tests: `npm test` (Node's built-in `node:test`). `test/helpers.ts` swaps `fetch` for
an in-memory fake Yahoo and points `FINSIGHT_DATA_DIR` at a temp dir, so the server suite is offline and
never touches your data. The same run executes the web unit tests (`web/src/**/*.test.ts`, pure logic)
and the committed-bundle check (`test/webbuild.test.ts` → `npm run check:web`). Browser E2E is
`npm run e2e` (Playwright): it starts throwaway servers with fake market data and fresh temp data
folders — never your `~/FinSightData` — on ports `E2E_PORT_BASE` (default 8096) + offset, so two
worktrees can run E2E at once with different bases. `npm run verify` = typecheck + unit + bundle check
+ E2E. Use **Node 24** for development and for running the server (Node strips the TypeScript types; `npm run typecheck` checks them).

- **Frontend** (`web/` → built to `public/app/`): React 19 + TypeScript.
  The source lives in `web/src` (never served directly) and is bundled by esbuild
  (`scripts/build-web.mjs`, `npm run build`; `npm run dev` watches) into **committed** build output in
  `public/app/` — `bootstrap.js` (classic script), `main.js`/`main.css` (ESM, code-split), lazy chunks in
  `public/app/chunks/`, and `manifest.json` (every runtime file). `npm run check:web` (also part of
  `npm test`) fails if `public/app` differs from a fresh build, so a fresh clone runs with no install.
  Script order in `index.html`: `/app/bootstrap.js` first (creates `window.FinSight` — a Zustand UI
  store, a refresh bus, and the PIN lock/auth state — synchronously, before anything else), then the
  plain-JS chart scripts (`indicators.js`, `strategy.js`, `strategies.js`, `chart.js`, `chartgrid.js`,
  `journal.js`), then the module `/app/main.js`, which mounts the app.
  `web/src/main.tsx` mounts one React application from `web/src/App.tsx`, with TanStack Query
  and an error boundary. `mountIslands` remains for external embeds and compatibility tests;
  it is not the main page composition model. Server data belongs to TanStack Query
  (`web/src/api/queries.ts`); UI state belongs to the Zustand store; mutations invalidate
  queries through `web/src/api/invalidation.ts`. Startup lives in `web/src/shell/boot.ts`,
  layout in `web/src/shell/layout.ts`, and compatibility globals in `web/src/shell/compat.ts`.
- **Chart** (`public/chart.js`, plain JS, kept): a self-contained `window.PriceChart` class that renders the interactive
  security chart — candles/line/area, SMA/EMA/Bollinger overlays, RSI/MACD/volume panes, a crosshair,
  pan/zoom, and the trendline/H-line/Fibonacci drawing tools — on a two-layer HiDPI `<canvas>`. It's
  driven by Pointer Events (mouse, pen and touch: one finger pans or draws, two fingers pinch-zoom, a long
  press opens the crosshair). `chartgrid.js` (`window.ChartGrid`) wraps it for the 2- and 4-chart
  full-screen workspace (linked symbol, crosshair synced by date, shared per-symbol drawings).
  React drives both through typed hooks in `web/src/shell/chartHooks.ts`. Chart extras: compare symbols (as-of joined, % scale), ledger trades/dividends/average cost
  (`GET /api/chart-trades?symbol=&account=`), alerts drawn on the chart, older history loaded when you pan
  past the first bar, and a watchlist side panel (↑/↓ steps). NB: Yahoo's `range=max` returns *quarterly*
  bars for every interval, so the chart asks for explicit years (`10y`, `20y`, `50y`). It's
  wrapped in an IIFE so it shares no globals with the app. Live data refreshes on the Query poll
  (15 s for portfolio/markets). User preferences (profile name, base currency, summary-card layout, chart type & indicators)
  live in the browser's `localStorage` (`finsight-profile`, `finsight-base`, `finsight-cards`,
  `finsight-chart-cfg`; panel order/visibility in `finsight-layout`/`finsight-panels`); per-symbol chart drawings live under `finsight-draw:<SYMBOL>`.
- **Backend** (`server.ts`): serves static files from `public/` and a JSON API under `/api/`. It
  proxies the free upstream data sources (so the browser avoids CORS and no keys are exposed) and
  persists the portfolio locally.
- **Storage** (`data/portfolio.json`): `{ accounts: [{ id, name, type, positions[], transactions[], dividends[], cash{} }], watchlist[], alerts[], settings{}, activeId }` — positions/transactions/cash are per-account; watchlist, alerts and settings (e.g. `withholding`) are global.
  Each position uses **lot tracking** — `lots: [{ q, px, fxUsd, t, usdBase?, tx? }]` — where `fxUsd` is the
  native→USD FX rate captured at purchase time (the basis for the Stock-vs-FX P&L split) and `tx` links
  the lot to its BUY transaction (for ledger edits). `quantity` and `avgCost` are always derived from
  the lots on load. Transactions carry a stable `id`.
- **Undo** (`data/undo.json`): every user-facing change (buy, sell, delete, import, clear, ledger edit,
  accounts, cash) snapshots `accounts` + `activeId` first — 25 steps deep. Watchlist/alerts aren't
  rolled back.
- **Other files in `data/`**: `auth.json` (scrypt-hashed PIN), `cache.json` (persisted market/macro cache).
- **Write safety**: every read-modify-write (buy/sell/delete/watch/alert/import/reset **and** the
  background alert timer) is serialized onto one promise chain (`withLock`) so concurrent saves can't
  clobber each other.
- **Caching** (`lib/cache.ts`): every upstream call goes through `cached(key, ttl, fn, { stale, persist })`.
  Fresh entries are served from memory; *stale* ones are served immediately and refreshed in the
  background; if a refresh fails the last good value is served instead of an error. Concurrent callers
  share one in-flight request. `persist` entries are also written to `data/cache.json` (kept ≤ 30 days),
  so a restart or a Yahoo outage isn't a cold start. After HTTP 429 from both Yahoo hosts, calls back
  off for 1 → 10 minutes.

  | Data | Fresh for | Served stale for | Persisted |
  |---|---|---|---|
  | quotes | 15s | — (last value only if a fetch fails) | ✓ |
  | markets overview | 30s | 5 min | |
  | FX rate (spot) | 60s | — | |
  | history (intraday) | 60s | — | |
  | history (daily/weekly) | 5–15 min | 7 days | ✓ |
  | earnings/dividend details | 6h | 3 days | ✓ |
  | dividend history | 12h | 7 days | ✓ |
  | search | 5 min | — | |
  | news | 5 min | 1h | |
  | FRED | 1h | 7 days | ✓ |
  | World Bank | 6h | 30 days | ✓ |
  | categories (sector) | 24h | 30 days | ✓ |
  | calendar | 1h | 1 day | |

- **Background alerts**: a timer (every `ALERT_INTERVAL`s) evaluates alerts server-side and fires a
  native macOS notification via `osascript`, so alerts work even with the browser closed.
- **FX model**: market value is converted at the **current** FX rate; **cost basis** is reconstructed
  at each lot's **purchase-time** FX (`fxUsd` × historical USD→base). The difference is the FX P&L.
- **Performance model** (`lib/performance.ts`): replays BUY/SELL/DELETE in time order, values the
  holdings each trading day with historical prices **and** historical FX, and treats buys/sells as
  cash flows. Daily TWR is measured on the book held since the previous close (new money joins after),
  chained; XIRR solves the dated cash flows. A BUY whose price is outside that day's trading range (an
  average cost with no real purchase date) enters at market value and is reported in `transfers`;
  holdings without any transaction history are treated as held for the whole window (`approx`).
- **Service worker** (`public/sw.js`): makes the app installable and the shell instant. It precaches
  the static files plus every runtime file listed in `public/app/manifest.json` (written by the build)
  and serves them network-first — the server is local, so an update always shows on the next load and
  the cache is only the offline fallback. API responses are never cached in the browser, so portfolio
  data stays behind the PIN.

---

## Configuration (environment variables)

Set these when launching, e.g. `PORT=9000 NOTIFY=0 node server.ts`.

| Variable | Default | Effect |
|---|---|---|
| `PORT` | `8000` | HTTP port the server listens on. |
| `NOTIFY` | on | Set `NOTIFY=0` to disable native macOS desktop notifications (toast/beep in the browser still work). |
| `ALERT_INTERVAL` | `60` | Seconds between background alert checks. Clamped to a minimum of 15. |
| `LOCK_IDLE_MIN` | `480` | Minutes a PIN session stays valid while idle before it re-locks. |
| `HOST` | `127.0.0.1` | Interface to bind. Loopback only by default. |
| `FINSIGHT_DATA_DIR` | `./data` | Where `portfolio.json`, `auth.json`, `undo.json` and `cache.json` live. |
| `FINSIGHT_CACHE_PERSIST` | on | Set `0` to keep the cache in memory only. |

There are **no API keys or secrets** — all data sources are free and keyless.

---

## HTTP API

Base URL: `http://localhost:8000`. All responses are JSON. Request bodies for `POST` are JSON
(`Content-Type: application/json`). Errors return the appropriate status with `{ "error": "<message>" }`;
unknown `/api/*` paths return `404 { "error": "Unknown endpoint" }`.

Money fields are returned in the requested **base** currency (`?base=`, default `SGD`); per-share
fields (`avgCost`, `last`, `price`) stay in each security's **native** currency.

### Authentication (PIN lock)

Once a PIN is set, **every `/api/*` route except `/api/auth/*` and `/api/health` requires a valid session
cookie** (`sid`, HttpOnly) — otherwise it returns `401 { "error": "Locked. Enter your PIN." }`. The PIN is
scrypt-hashed in `data/auth.json`; sessions live in memory (cleared on server restart).

- `GET  /api/auth/status` → `{ pinSet, authed }`
- `POST /api/auth/setup` — body `{ pin }` (4–12 digits; only when none set) → sets PIN + session cookie
- `POST /api/auth/login` — body `{ pin }` → session cookie (throttled after 5 wrong tries)
- `POST /api/auth/logout` → clears the session
- `POST /api/auth/change` — body `{ current, pin }` (must be logged in) → changes the PIN

### System

#### `GET /api/health`
Liveness check (public). → `{ "ok": true, "time": <ms epoch> }`

### Market data

#### `GET /api/quote?symbols=AAPL,MSFT,^GSPC`
Live quote(s). `symbols` = comma-separated list.
→ `{ "quotes": [ { symbol, name, currency, exchange, type, price, prevClose, change, changePct,
dayHigh, dayLow, weekHigh52, weekLow52, volume, marketTime } ] }`
A symbol that fails resolves to `{ symbol, error }` in the array (the call still succeeds).

#### `GET /api/history?symbol=AAPL&range=1mo&interval=1d`
Price history for charts. `range` (default `1mo`): `1d,5d,1mo,6mo,1y,5y,…`; `interval` (default `1d`):
`5m,15m,1d,1wk,…`.
→ `{ symbol, range, interval, meta: {<same fields as a quote>}, points: [ { t: <ms>, o, h, l, c, v } ] }`
  where `o/h/l/c/v` are open/high/low/close/volume. `c` (close) is always present (points with a null
  close are dropped); `o/h/l/v` can individually be null on gappy bars, so consumers must null-guard them.
  The interactive candlestick chart uses all of OHLCV; older consumers that only read `c` are unaffected.

#### `GET /api/search?q=apple`
Symbol search.
→ `[ { symbol, name, exchange, type } ]`

#### `GET /api/markets`
World-markets overview, grouped.
→ `{ Indices: [...], FX: [...], Crypto: [...], Commodities: [...], Rates: [...] }` where each item is a
quote plus a friendly `label`.

### Macro

#### `GET /api/worldbank?country=US&indicator=FP.CPI.TOTL.ZG`
World Bank indicator (annual). `country` = ISO code (default `WLD`); `indicator` = WB code
(default `NY.GDP.MKTP.CD`).
→ `{ country, countryName, indicator, label, series: [ { year, value } ] }`

#### `GET /api/fred?series=DGS10&transform=lin&start=2015-01-01`
FRED (US Federal Reserve) series via the public CSV export (no key). `transform`: `lin` (level) or
`pc1` (percent change YoY), etc.
→ `{ series, transform, points: [ { date: "YYYY-MM-DD", value } ] }`

### Accounts

The store holds multiple named accounts (each its own positions/transactions); watchlist and alerts
are global. Portfolio endpoints take `?account=<id>` (default: the active account; use `ALL` for a
read-only combined view — you can't buy/sell into `ALL`).

#### `GET /api/accounts`
→ `{ "accounts": [ { id, name, type, count } ], "activeId": "<id>" }`

#### `POST /api/accounts/add` — body `{ name, type }` → `{ accounts, activeId, newId }`
#### `POST /api/accounts/rename` — body `{ id, name, type }` → `{ accounts, activeId }`
#### `POST /api/accounts/remove` — body `{ id }` (can't remove the last one) → `{ accounts, activeId }`

### Portfolio

All portfolio endpoints accept `?base=<CCY>` and `?account=<id>`, and return values in that currency
for that account (or the `ALL` combined view).

#### `GET /api/portfolio?base=SGD`
The full portfolio with live P&L.
→
```jsonc
{
  "base": "SGD",
  "fx": { "USD": 1.29 },              // native→base rates used
  "fxMissing": [],                    // currencies with no FX (shown unconverted)
  "positions": [ {
    symbol, name, currency, quantity, avgCost,   // avgCost = native per-share
    fxRate, last, change, changePct,
    marketValue, cost, costAtNow,                // base currency
    unrealized, unrealizedPct, stockPnl, fxPnl, dayChange, weight
  } ],
  "cash": [ { ccy, amount, base } ],          // uninvested balances
  "summary": {
    totalValue, totalCost, cashBase, netWorth, totalUnrealized, totalUnrealizedPct,
    totalStockPnl, totalFxPnl, dayPnl, dayPct,
    realizedPnl, realizedStockPnl, realizedFxPnl, realizedLegacy
  },
  "transactions": [ { id, type, symbol, quantity, price, currency, fxUsd, time } ]  // last 50, newest first
}
```

#### `POST /api/cash?base=SGD&account=<id>`
Body: `{ "ccy": "USD", "amount": 5000 }` (`0` removes it). Sets the account's uninvested cash in that
currency. Counts toward `netWorth`, and foreign cash counts as FX exposure. → the portfolio object.

#### `POST /api/portfolio/buy?base=SGD`
Body: `{ "symbol": "AAPL", "quantity": 10, "price": 195.50, "date": "2024-01-15" }` (`date` optional —
records the historical FX rate for that day). Averages into an existing position. → the portfolio object.

#### `POST /api/portfolio/sell?base=SGD`
Body: `{ "symbol": "AAPL", "quantity": 5, "price": 320 }` (`price` optional → uses current market price).
Records realized P&L. → the portfolio object plus `lastRealized` (native-currency realized for this sale).

#### `POST /api/portfolio/delete?base=SGD`
Body: `{ "symbol": "AAPL" }`. Removes the position entirely (no sale recorded). → the portfolio object.

#### `POST /api/portfolio/import?base=SGD`
Body: `{ "csv": "<csv text>", "replace": false }`. CSV columns (header optional, names matched loosely):
`symbol, quantity, avg_price`, optional `date`. With `replace: true`, positions **and** transaction
history are cleared first. → the portfolio object plus `imported: { added, total, failed: [symbols] }`.

#### `POST /api/portfolio/reset?base=SGD`
No body. Clears positions + transactions (keeps watchlist & alerts). → the portfolio object.

#### `GET /api/dividends?base=SGD&account=<id>`
Dividend income received (from imported IBKR statements, stored per account as
`dividends: [{ symbol, date, amount, currency, tax? }]`) — gross, withholding and net — plus forward
income from current holdings (Yahoo forward dividend rate, else the trailing 12 months).
`tax` is the actual IBKR withholding; otherwise a per-market rate applies (`withholding`).
→ `{ base, account, count, total, ttm,
     received: { total: { gross, tax, net }, ttm: { gross, tax, net } },
     bySymbol: [ { symbol, gross, tax, net } ], recent: [ { symbol, date, amount, currency, baseAmount, baseTax, baseNet, whtRate, whtActual } ],
     forward: [ { symbol, currency, perShare, source, annualGross, annualTax, annualNet, whtRate, yieldOnCost, currentYield, nextEx, nextExEstimated, nextPay } ],
     forwardTotal: { gross, tax, net }, withholding: { US: 30, SG: 0, … } }`

#### `POST /api/settings/withholding`
Body: `{ "market": "US", "pct": 15 }`. Markets: `US SG HK UK EU JP AU CA OTHER`. → `{ withholding }`

#### `GET /api/events?account=<id>`
Earnings and ex-dividend dates in the next 60 days for holdings + watchlist. Uses Yahoo's key-free
quote API (session cookie + crumb); ex-dates missing there are estimated from the payment cadence
(`estimated: true`). → `{ ok, events: [ { symbol, kind: "EARNINGS"|"EX-DIV", t, estimated, amount?, held } ] }`

#### `GET /api/portfolio/performance?range=1y&base=SGD&benchmark=^GSPC`
Replays your trades (see *Performance model*). `range`: `1mo 3mo 6mo ytd 1y 2y 5y max`.
`benchmark`: any Yahoo symbol, or `none`.
→ `{ range, base, interval, points: [ { t, value, invested, bench } ], start, end,
     netInvested, totalIn, totalOut, income, gain,
     twr, twrAnnual, xirr, mwr, spanDays, changePct,           // % ; xirr is annualised, mwr is over the window
     benchmark: { symbol, name, twr, twrAnnual, shadowEnd } | null,
     approx: [symbols], missing: [symbols], transfers: [symbols] }`

### Ledger & undo

#### `GET /api/ledger?base=SGD&account=<id>`
Every transaction, newest first. → `{ base, account, rows: [ { id, type, symbol, quantity, price, currency, time, account, accountId, editable?, valueBase?, realized?, realizedStock?, realizedFx?, legacy? } ] }`

#### `POST /api/ledger/edit?base=SGD`
Body: `{ id, date?, price?, quantity? }`. Only a BUY whose lot is still open. A new `date` re-fetches the
purchase-time FX. → `{ id, symbol }`

#### `POST /api/ledger/delete`
Body: `{ id }`. Removes a BUY and its open lot. → `{ id, symbol }`

#### `GET /api/realized?base=SGD&account=<id>`
Closed trades with proceeds, cost at the FX paid, stock/FX split and holding period, plus per-year totals
(including dividends gross/tax/net).
→ `{ base, account, rows: [ { id, time, year, symbol, quantity, price, currency, proceeds, cost, stock, fx, total, legacy, heldDays } ],
     years: [ { year, trades, proceeds, cost, stock, fx, total, divGross, divTax, divNet } ] }`

#### `GET /api/undo` → `{ available, last: { at, label } | null }`
#### `POST /api/undo` → `{ undone, at, available, last }` (400-style error "Nothing to undo" when empty)

#### `GET /api/fx-risk?base=SGD&account=<id>`
Currency-risk view for foreign-currency holdings: per-currency exposure, blended entry rate vs spot,
per-buy FX P&L, and a 1-week parametric VaR (from weekly USD/SGD volatility). Reuses the same
purchase-time FX anchoring as `/api/portfolio`, so `totalFxPnl` reconciles with that endpoint's summary.
→ `{ base, totalValue, foreignBase, totalFxPnl,
     exposures: [ { ccy, cashBase, notionalNative, notionalBase, pct, blendedEntry, nowRate, driftPct, breakeven,
                    fxPnl, fxPnlPct, sigmaWeeklyPct, oneSigmaBase, var95Base } ],
     vol: { sigmaWeeklyPct, oneSigmaBase, var95Base },
     lots: [ { symbol, currency, t, q, px, entryRate, nowRate, fxPnl, dated, recent } ] }`

#### `GET /api/calendar`
Economic calendar (no key, no base/account). The FOMC anchor is a curated, hardcoded schedule
(refresh annually); `events` is a best-effort, 1-hour-cached pull of this week's high-impact US (and
any SG) releases from Forex Factory's free weekly JSON, filtered by currency + impact
(all high-impact USD releases plus any SGD releases — no title matching).
Degrades to `eventsOk: false` (FOMC anchor only) if the feed is unavailable.
→ `{ now, fomc: [ { start, end, sep, decisionMs } ], nextFomc, nextSep,
     events: [ { title, country, time, impact, forecast, previous } ], eventsOk, sepUrl }`

### Watchlist

#### `GET /api/watchlist`
→ `{ "watchlist": [ <quote objects> ] }`

#### `POST /api/watchlist/add`
Body: `{ "symbol": "NVDA" }` (validated against a live quote). → `{ watchlist }`

#### `POST /api/watchlist/remove`
Body: `{ "symbol": "NVDA" }`. → `{ watchlist }`

### Alerts

#### `GET /api/alerts`
Alerts with live status.
→ `{ "alerts": [ { id, symbol, kind, op, price, line, ind, drawingId, note, createdAt, triggeredAt, label, currentPrice, currentValue, level, currency, name, met } ] }`
(`op` is `">"` or `"<"`; `met` is whether `currentValue op level` holds now; `triggeredAt`/`notifiedAt` are
one-shot timestamps. `label` is a readable condition, e.g. `AAPL RSI(14, 1d) ≥ 70`.)

Kinds (`lib/alertmath.ts` holds the maths):
- `price` — live price vs `price`.
- `line` — live price vs a drawn sloped line `line: { pts: [{t,p},{t,p}], interval, log }`, valued at the
  latest bar in **bar-index** space exactly as the chart draws it (weekends do not bend the line).
- `ind` — `ind: { type, length, interval }`: `rsi`/`mfi`/`cci`/`willr` compare the oscillator with
  `price` (the level); `sma`/`ema` compare the live price with the average.
History for `line`/`ind` comes from the cached `/api/history`. The background timer evaluates every
alert each minute and sends one macOS notification per trigger. Alerts never place orders.

#### `POST /api/alerts/add`
Body: `{ "symbol": "AAPL", "op": ">", "price": 320, "note": "" }` (`op` accepts `>`/`<`/`above`/`below`),
or with `kind: "line"` / `kind: "ind"` and the fields above; `drawingId` links an alert to a chart drawing.
→ `{ alerts }`

#### `POST /api/alerts/update`
Body: `{ "id", ...fields }` — replaces the condition (the chart sends this when a linked line is moved) and
re-arms the alert. → `{ alerts }`

#### `POST /api/alerts/remove`
Body: `{ "id": "<alert id>" }`. → `{ alerts }`

### News & categories

#### `GET /api/news?symbol=AAPL`
Latest headlines (omit `symbol` for general market news).
→ `{ "news": [ { title, publisher, link, time, tickers } ] }`

#### `GET /api/categories?symbols=AAPL,BTC-USD`
Sector/category per symbol (for the heatmap). Equities get their sector; ETFs/crypto/commodities/etc.
are bucketed by instrument type.
→ `{ "AAPL": { symbol, sector, type, category }, "BTC-USD": { … } }`

---

## Extending it

- **New data source**: add a fetch helper in `lib/` wrapped in `cached(...)` (stay friendly to free
  APIs), a `/api/...` route in `server.ts`, then render it in the React app — a component in
  `web/src/features/` registered in `web/src/islands.ts` (recipe: `web/src/features/README.md`).
  Add a test with the fake market in `test/helpers.ts`.
- **New market symbols**: edit `MARKET_GROUPS` in `lib/market.ts`.
- **New FRED/World Bank series**: add an entry to `fredOptions` / `worldBankOptions` in
  `web/src/features/macro/options.ts` (the FRED / World Bank islands render them as `<select>`s).
- **New portfolio mutation**: wrap it as `withLock(() => withUndo('Label', () => { … }))` so it's
  serialized and undoable.
- **New summary card**: add an entry to `CARD_DEFS` in `web/src/features/summary/cards.ts` — it appears
  automatically in the ⚙ Layout customizer.
- **New chart indicator/overlay**: add a pure function (aligned 1:1 with bars, `null` during warm-up) to
  `public/indicators.js` (tested in `test/indicators.test.js` / `test/chartfeatures.test.js`), then register
  it in the `IND` table in `public/chart.js` (`pane: true` for a sub-pane). `calc(bars, params, ctx, inst)`
  returns `{ lines, levels?, range?, fill?, cloud?, profile? }`; lines may set `dots`, `step`, `dirs`, `dash`.
  `ctx.series(sym)` gives another symbol's bars (used by RS). A new drawing tool: add it to `TOOLS` and
  `GROUPS`, then handle it in `_drawOne`, `_hit` and (if it has unusual handles) `_handles`. Indicators are
  computed when data or settings change, not on pan/zoom.
- **Draggable panels**: each panel is tagged with a stable `data-pid` (ids, default order and the
  show/hide list live in `web/src/shell/layout.ts`); a ⠿ grip in the header drives HTML5
  drag-and-drop. Order is saved per column in `localStorage`
  (`finsight-layout`); show/hide in `finsight-panels`; card layout in `finsight-cards`. All layout state
  is client-side (per browser), not on the server.
- **Rule**: a lock-wrapped function must never call another lock-wrapped function (it would deadlock the
  chain). `buy`/`importCsv` share `buyUnlocked` for this reason.
