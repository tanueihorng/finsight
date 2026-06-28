# FINSIGHT // PERSONAL TERMINAL — Developer Docs

Technical reference for the app: architecture, configuration, and the full HTTP API.
For day-to-day usage see [README.md](README.md).

---

## Architecture

A single **zero-dependency Node.js** process (built-in `http` + native `fetch`, Node 18+):

```
browser ──HTTP──▶ server.js ──┬─▶ public/*  (static terminal UI)
                              └─▶ /api/*    (JSON API)
                                     ├─▶ Yahoo Finance / World Bank / FRED  (free, no key)
                                     └─▶ data/portfolio.json                (local store)
```

- **Frontend** (`public/`): vanilla JS, no framework/build. `app.js` is the terminal shell; `chart.js`
  is a self-contained `window.PriceChart` class (loaded **before** `app.js`) that renders the interactive
  security chart — candles/line/area, SMA/EMA/Bollinger overlays, RSI/MACD/volume panes, a crosshair,
  pan/zoom, and the trendline/H-line/Fibonacci drawing tools — on a two-layer HiDPI `<canvas>`. It's
  wrapped in an IIFE so it shares no globals with `app.js`. Polls the API every 15s for live
  data. User preferences (profile name, base currency, summary-card layout, chart type & indicators)
  live in the browser's `localStorage` (`finsight-profile`, `finsight-base`, `finsight-cards`,
  `finsight-chart-cfg`); per-symbol chart drawings live under `finsight-draw:<SYMBOL>`.
- **Backend** (`server.js`): serves static files from `public/` and a JSON API under `/api/`. It
  proxies the free upstream data sources (so the browser avoids CORS and no keys are exposed) and
  persists the portfolio locally.
- **Storage** (`data/portfolio.json`): `{ accounts: [{ id, name, type, positions[], transactions[] }], watchlist[], alerts[], activeId }` — positions/transactions are per-account; watchlist and alerts are global.
  Each position uses **lot tracking** — `lots: [{ q, px, fxUsd, t }]` — where `fxUsd` is the
  native→USD FX rate captured at purchase time (the basis for the Stock-vs-FX P&L split). `quantity`
  and `avgCost` are always derived from the lots on load.
- **Write safety**: every read-modify-write (buy/sell/delete/watch/alert/import/reset **and** the
  background alert timer) is serialized onto one promise chain (`withLock`) so concurrent saves can't
  clobber each other.
- **Caching**: a small in-memory TTL cache fronts every upstream call:

  | Data | TTL |
  |---|---|
  | quotes | 15s |
  | markets overview | 15s |
  | FX rate (spot) | 60s |
  | history | 60s |
  | USD→base FX series (for historical cost) | 6h |
  | historical FX-at-date | 24h |
  | search | 5 min |
  | news | 5 min |
  | FRED | 1h |
  | World Bank | 6h |
  | categories (sector) | 24h |

- **Background alerts**: a timer (every `ALERT_INTERVAL`s) evaluates alerts server-side and fires a
  native macOS notification via `osascript`, so alerts work even with the browser closed.
- **FX model**: market value is converted at the **current** FX rate; **cost basis** is reconstructed
  at each lot's **purchase-time** FX (`fxUsd` × historical USD→base). The difference is the FX P&L.

---

## Configuration (environment variables)

Set these when launching, e.g. `PORT=9000 NOTIFY=0 node server.js`.

| Variable | Default | Effect |
|---|---|---|
| `PORT` | `8000` | HTTP port the server listens on. |
| `NOTIFY` | on | Set `NOTIFY=0` to disable native macOS desktop notifications (toast/beep in the browser still work). |
| `ALERT_INTERVAL` | `60` | Seconds between background alert checks. Clamped to a minimum of 15. |
| `LOCK_IDLE_MIN` | `480` | Minutes a PIN session stays valid while idle before it re-locks. |

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
  "summary": {
    totalValue, totalCost, totalUnrealized, totalUnrealizedPct,
    totalStockPnl, totalFxPnl, dayPnl, dayPct, realizedPnl
  },
  "transactions": [ { type, symbol, quantity, price, currency, fxUsd, time } ]  // last 50, newest first
}
```

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
Dividend income received (parsed from imported IBKR statements; stored per account as
`dividends: [{ symbol, date, amount, currency }]`), converted to base.
→ `{ base, account, total, ttm, count, bySymbol: [ { symbol, amount } ], recent: [ { symbol, date, amount, currency, baseAmount } ] }`

#### `GET /api/portfolio/performance?range=1y&base=SGD`
Value of **current holdings** priced over historical closes, converted to base. (It does not replay
past trades.)
→ `{ range, base, points: [ { t: <ms>, value } ], start, end, changePct }`

#### `GET /api/fx-risk?base=SGD&account=<id>`
Currency-risk view for foreign-currency holdings: per-currency exposure, blended entry rate vs spot,
per-buy FX P&L, and a 1-week parametric VaR (from weekly USD/SGD volatility). Reuses the same
purchase-time FX anchoring as `/api/portfolio`, so `totalFxPnl` reconciles with that endpoint's summary.
→ `{ base, totalValue, foreignBase, totalFxPnl,
     exposures: [ { ccy, notionalNative, notionalBase, pct, blendedEntry, nowRate, driftPct, breakeven,
                    fxPnl, fxPnlPct, sigmaWeeklyPct, oneSigmaBase, var95Base } ],
     vol: { sigmaWeeklyPct, oneSigmaBase, var95Base },
     lots: [ { symbol, currency, t, q, px, entryRate, nowRate, fxPnl, dated, recent } ] }`

#### `GET /api/calendar`
Economic calendar (no key, no base/account). The FOMC anchor is a curated, hardcoded schedule
(refresh annually); `events` is a best-effort, 1-hour-cached pull of this week's high-impact US (and
any SG) releases from Forex Factory's free weekly JSON, filtered to CPI/PCE/jobs/GDP/rate-decision.
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
→ `{ "alerts": [ { id, symbol, op, price, note, createdAt, triggeredAt, currentPrice, currency, name, met } ] }`
(`op` is `">"` or `"<"`; `met` is whether the condition currently holds; `triggeredAt`/`notifiedAt` are
one-shot timestamps.)

#### `POST /api/alerts/add`
Body: `{ "symbol": "AAPL", "op": ">", "price": 320, "note": "" }` (`op` accepts `>`/`<`/`above`/`below`).
→ `{ alerts }`

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

- **New data source**: add a fetch helper + a `/api/...` route in `server.js`, then render it in
  `public/app.js`. Front it with the cache (`cacheGet`/`cacheSet`) to stay friendly to free APIs.
- **New market symbols**: edit `MARKET_GROUPS` in `server.js`.
- **New FRED/World Bank series**: add `<option>`s to `#fred-series` / `#wb-indicator` in `public/index.html`.
- **New summary card**: add an entry to `CARD_DEFS` in `public/app.js` — it appears automatically in
  the ⚙ Layout customizer.
- **New chart indicator/overlay**: add a pure function (aligned 1:1 with bars, `null` during warm-up) to
  `public/chart.js`, register it in the `OVERLAYS` (price-pane line) or `PANES` (sub-pane) table, and draw
  it in `_drawPrice`/`drawIndicatorPanes`. A new drawing tool: add it to `TOOLS`, handle it in
  `_onDown`/`_onUp`, `_drawOne`, and `_hitTest`. Indicators are computed once per `setData` and sliced per
  visible window, so pan/zoom never recompute them.
- **Draggable panels**: each panel is tagged with a stable `data-pid` (see `PANEL_PIDS` in `app.js`); a ⠿
  grip in the header drives HTML5 drag-and-drop. Order is saved per column in `localStorage`
  (`finsight-layout`); show/hide in `finsight-panels`; card layout in `finsight-cards`. All layout state
  is client-side (per browser), not on the server.
- **Rule**: a lock-wrapped function must never call another lock-wrapped function (it would deadlock the
  chain). `buy`/`importCsv` share `buyUnlocked` for this reason.
