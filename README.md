# FINSIGHT // PERSONAL TERMINAL

A personal **Bloomberg-style terminal** for tracking your own stock portfolio, inspired by
[FinceptTerminal](https://github.com/Fincept-Corporation/FinceptTerminal) but rebuilt small,
customizable, and **100% free** — no paid APIs, no API keys, no accounts.

- Add stocks with a **quantity** and your **average buy price**
- **Sell** (auto-computes realized P&L) and **delete** positions
- **Base currency** roll-up — deposit in SGD but hold USD/HKD/EUR stocks? Your whole
  portfolio is converted into one currency of your choice (default **SGD**, switch any time)
- **Watchlist** — track symbols you don't own, live
- **Price alerts** — get a desktop notification + on-screen toast + beep when a price crosses your target
- **News** — live headlines for the selected security (free, no key)
- **Multiple accounts** — keep separate portfolios (IBKR / Crypto / SGX…) and switch between them, or see an **All Accounts** combined view
- **Broker import** — drop in an **Interactive Brokers**, **moomoo**, or **Tiger** statement (CSV), or any `symbol,quantity,avg_price` file
- **Dividend tracking** — income received, last-12-month total, and per-holding breakdown (pulled automatically from an imported IBKR statement)
- **Configurable, draggable layout** — choose which summary **cards** and **panels** show (**⚙ Layout**), and **drag the ⠿ grip** in any panel's header to rearrange widgets — even between columns. Your layout is remembered.
- **PIN lock** — set a PIN on first launch; the app and its data API stay locked until you enter it (hashed, with brute-force throttling)
- **CSV import / export** — bulk-load your existing holdings from a spreadsheet, or export them
- **Stock vs FX P&L** — see how much of your gain is the *stock moving* vs the *currency moving*
- **FX risk panel** — if you fund in SGD and hold USD stocks, track your **USD exposure**, your
  **blended entry rate** (avg USD/SGD you bought at) vs spot, **per-buy FX gain/loss**, **realized FX**
  on closed trades, a **what-if USD ±%** slider, and a **1-week FX VaR** (how much the currency alone
  could move your book in a week)
- **Economic calendar** — the next **Fed rate decision** + **dot-plot (FOMC SEP)** date, plus this
  week's high-impact **CPI / PCE / jobs / GDP** releases with forecast vs previous — free, no key
- **US Fed data (FRED)** — Treasury yields, **CPI / Core PCE inflation**, Fed funds, unemployment, yield curve — no key
- **Charts & analytics** — portfolio performance over time, allocation donut, and a **sector heatmap**
  (treemap of your holdings, sized by value and coloured by % change, grouped by category)
- Live **world market data**: global indices, **VIX**, FX, crypto, commodities, bond yields
- **World Bank** macro data (GDP, inflation, unemployment, …) — free government/world data
- **Interactive trading chart** — candlestick / line / area, moving averages (SMA 20/50/200, EMA 21),
  Bollinger Bands, RSI and MACD panes, a volume strip, a hover crosshair with OHLC readout, plus
  mouse-wheel zoom & drag-to-pan
- **Drawing tools** — Fibonacci retracement, trendlines, and horizontal support/resistance lines,
  saved per-symbol so they're still there next time
- Security **detail panel** with the chart (1D → 5Y) and key stats
- Your portfolio is stored locally in `data/portfolio.json` — it never leaves your machine

No build step. No dependencies to install. Just Node.js.

> **Developers:** see [DOCS.md](DOCS.md) for architecture, configuration (env vars), and the full
> HTTP API reference. Licensed MIT — see [LICENSE](LICENSE).

On **first launch** a quick **setup wizard** asks your name + base currency and lets you **import a CSV**,
**add holdings manually**, or **start empty**. Reopen it any time from the **◐ Profile** button. You can
also **customise which summary cards and panels** show (and their order) via the **⚙ Layout** button —
your choices are remembered in the browser.

---

## Run it

You need **Node.js 18+** (you have v24). From this folder:

```bash
node server.js
```

Then open **http://localhost:8000** in your browser.

To use a different port: `PORT=9000 node server.js`

**Easier launch:** double-click **`start.command`** in Finder (it opens a window running the server).

**Always-on (auto-fetch even when the app is closed):** run once
```bash
./install-autostart.sh
```
This installs a macOS launchd agent so the server **starts automatically at login and restarts if it
crashes** — which is what lets **background price alerts** keep working (and fire macOS notifications)
even when no browser is open. Remove it any time with `./uninstall-autostart.sh`.

---

## Commands (type in the top command bar)

| Command | What it does |
|---|---|
| `ADD AAPL 10 195.50` | Buy/add 10 shares of AAPL at avg price 195.50 (averages in if you already hold it) |
| `BUY MSFT 5 410` | Same as ADD |
| `SELL AAPL 5` | Sell 5 AAPL at the current market price (records realized P&L) |
| `SELL AAPL 5 320` | Sell 5 AAPL at a specific price |
| `DEL AAPL` | Remove AAPL from tracking entirely (no sale recorded) |
| `Q TSLA` or just `TSLA` | Pull up a security's detail + chart + news |
| `WATCH NVDA` / `UNWATCH NVDA` | Add / remove a symbol from your watchlist |
| `ALERT AAPL > 320` | Alert when AAPL rises to/above 320 (use `<` for below) |
| `NEWS TSLA` | Load news for a symbol (`NEWS` alone = general market news) |
| `MKT` | Refresh world markets |
| `HELP` | Show command help |

You can also use the **+ ADD** button / form (with symbol autocomplete) and the **S** (sell) /
**✕** (delete) buttons on each position row.

### Base currency (SGD / USD / …)
Use the **BASE** dropdown in the top-right. Your positions keep their native per-share prices
(AVG / LAST columns), but **market value, P&L and all totals are converted into your base
currency** using live FX from Yahoo. The native currency of each holding is shown next to its name
(e.g. `Apple Inc. · USD`). Your choice is remembered between sessions.

### Stock P&L vs FX P&L (where your gain came from)
Because you fund in SGD but hold USD/HKD stocks, part of your gain/loss comes from the **stock price**
moving and part from the **exchange rate** moving. The summary cards split this out:

- **STOCK P&L** — the pure price move, valued at today's FX (what you'd gain if the currency hadn't moved).
- **FX P&L** — the gain/loss purely from the currency, on your original cost.
- **UNREALIZED P&L = STOCK P&L + FX P&L** — your true gain in your base currency.

How it works: each time you buy, the app records the **exchange rate at that moment** (per lot). Your
true cost basis is what you actually paid; the split compares that against today's price and today's FX.

**Back-dating:** for holdings you bought earlier (or import), give the **purchase date** — the date box
in the **+ ADD** form, a 5th token in the command (`ADD AAPL 10 195.50 2024-01-15`), or a `date` column
in your CSV. The app then fetches the **historical exchange rate for that date**, so the Stock-vs-FX
split is accurate. Without a date, a buy uses today's rate. Each buy/sell also **locks in the exchange
rate at that moment**, so your historical FX figures stay stable over time.

### FX RISK panel (USD exposure, per-buy FX, what-if, VaR)
If you fund in one currency (SGD) and hold stocks in another (USD), the **FX RISK** panel makes the
currency side of your portfolio explicit:

- **Exposure** — how much of your book (in your base currency) is "riding on" USD, and the USD notional.
- **Blended entry** — the weighted-average USD/SGD rate you actually bought at, vs the live **spot** and
  the **drift** between them.
- **FX P&L** — gain/loss from the currency alone (open positions), and **REALIZED FX** for closed trades.
- **Per-buy FX history** — a row per purchase: USD/SGD then vs now → the dollars you've won/lost on FX alone.
- **What-if slider** — drag a USD/SGD shock (±%) to see the live impact on your book.
- **1-week FX VaR** — a 1σ weekly move and a 95% value-at-risk, from recent USD/SGD volatility.

> Buys newer than ~7 days show ~0 FX P&L by design (the rate hasn't moved yet — shown as "settling").
> Imported lots without a purchase date fall back to today's rate; add a date to backfill the true entry FX.

### ECON CALENDAR panel (Fed · CPI · PCE)
A forward-looking macro calendar focused on what moves the US dollar (and therefore your USD holdings):

- **Next Fed decision** and **next dot-plot (FOMC SEP)** date — always shown, from the Fed's published
  schedule (no feed needed).
- **This week's high-impact releases** — CPI, **PCE**, jobs, GDP, the rate decision — with **forecast vs
  previous**, in your local time. (Best-effort free feed; the panel still shows the Fed schedule if it's down.)

### Charts & analytics (left column)
- **Portfolio Performance** — your **current holdings** valued with historical prices over 1M–5Y,
  converted to your base currency. (It values today's holdings back through time; it does **not** replay
  past buys/sells.)
- **Allocation** — a donut of your weights, toggle **HOLDING ↔ SECTOR**. Click a slice to inspect it.
- **Sector Heatmap** — a treemap of your holdings: each tile is **sized by market value** and **coloured
  by % change** (green up / red down), **grouped by sector**. Toggle **DAY % ↔ TOTAL %** (today's move
  vs your overall gain). Click a tile to open that security.

### Security detail chart (right column)
Click a position, or type **`Q SYMBOL`**, to open a full interactive chart in the detail panel:
- **Chart type** — `Candles` / `Line` / `Area`.
- **`IND`** overlays — `MA20` `MA50` `MA200` (simple moving averages), `EMA21`, and `BBANDS` (Bollinger
  Bands). Toggle any combination; they're drawn over the price.
- **`VOL` `RSI` `MACD`** — add a volume strip and RSI(14) / MACD(12,26,9) sub-panes below the price.
- **`DRAW` tools** — `✛` cursor, `╱` trendline, `─` horizontal line, `ƒ` **Fibonacci retracement**, and
  `✕` to clear. Drag two points to place a trendline or Fib; click for a horizontal line.
  **Double-click** a drawing to delete it. Drawings are **saved per symbol**.
- **Navigate** — **scroll** to zoom, **drag** to pan, **hover** for a crosshair with the bar's
  O/H/L/C, volume and indicator values. Your chart type and indicator choices are remembered.
- Use the **`1D … 5Y`** range buttons (top-right of the panel) to change the timeframe.

### Macro panels: World Bank vs FRED (why CPI sometimes shows an old year)
Both are free. They differ in cadence:
- **World Bank** is **annual data, published with a lag** — e.g. the latest US inflation figure is for
  **2024** (the 2025 annual number isn't released yet). That's expected, not a bug.
- **FRED** (US FED · MACRO) is **monthly and current** — use it for up-to-date inflation, rates, jobs.

So if you want today's inflation, read it from the FRED panel; the World Bank panel is for long-run
annual history and non-US countries.

### Watchlist, alerts, news
- **Watchlist** (left panel): add symbols you want to follow without owning them. Click a row to
  inspect it. Add via the **+ WATCH** button (with search) or `WATCH NVDA`.
- **Price alerts** (left panel): set a target with **+ ALERT** or `ALERT AAPL > 320`. When the app is
  open you get a **browser notification + on-screen toast + beep** (checked every 15s). The **server also
  checks every 60s on its own and fires a native macOS notification** — so you're alerted **even when the
  browser is closed** (as long as the server is running; see "always-on" above). Alerts are one-shot —
  delete and re-add to re-arm. Turn off desktop notifications with `NOTIFY=0 node server.js`; change the
  background cadence with `ALERT_INTERVAL=30 node server.js` (seconds).
- **News** (right panel): updates to the selected security's latest headlines; click to open the
  article in a new tab. `NEWS` on its own shows general market news.

### Import / export your holdings (CSV)
Click **IMPORT** (top of the Positions panel). Paste CSV or choose a file. Minimal format:

```
symbol,quantity,avg_price
AAPL,10,195.50
MSFT,5,380
0700.HK,100,400
D05.SI,200,38.20
```

- The header row is optional, and column names are matched loosely (`ticker`/`qty`/`shares`/`cost` all work).
- Tick **Replace existing positions** to overwrite; otherwise rows are **added/averaged-in**.
- **EXPORT** downloads your current holdings (with live value in your base currency) as `portfolio.csv`.
- **CLEAR ALL POSITIONS** (in the import dialog) wipes positions + history but keeps your watchlist and alerts.

### Symbol formats (Yahoo)
- US stocks: `AAPL`, `MSFT`, `TSLA`
- Indices: `^GSPC` (S&P 500), `^DJI`, `^IXIC`, `^FTSE`, `^N225`
- FX: `EURUSD=X`, `USDJPY=X`
- Crypto: `BTC-USD`, `ETH-USD`
- Commodities: `GC=F` (gold), `CL=F` (oil)
- Non-US stocks use a suffix: `RELIANCE.NS` (India), `0700.HK` (Hong Kong), `BMW.DE` (Germany), `D05.SI` (Singapore)

Use the search box in the **+ ADD** form to find the exact ticker.

---

## Data sources (all free, no key)

| Source | Used for | Key needed? |
|---|---|---|
| **Yahoo Finance** (`query1.finance.yahoo.com`) | Quotes, history, search — stocks, indices, VIX, FX, crypto, commodities | No |
| **World Bank API** (`api.worldbank.org`) | Macro indicators by country | No |
| **FRED** (`fred.stlouisfed.org` graph CSV) | US Fed data: Treasury yields, CPI, PCE, Fed funds, unemployment | No |
| **Forex Factory** (`nfs.faireconomy.media` weekly JSON) | Economic-calendar events (CPI/PCE/jobs/FOMC), this week | No |

> Free data can be delayed (typically real-time-ish to ~15 min) and is best-effort.
> This is for **personal tracking, not investment advice**.

### Disclaimer & data-source terms
This project is **not affiliated with, endorsed by, or connected to** Bloomberg, Yahoo, Interactive
Brokers, Forex Factory, the Federal Reserve, or any data provider. "Bloomberg-style" describes the
look only. The code merely *fetches* public endpoints for your own personal, local use — it does **not
redistribute** any provider's data, and you shouldn't either:

- **FRED** (US Federal Reserve) and the **World Bank** publish open/public-domain data — fine to use.
- **Yahoo Finance** uses an unofficial endpoint; it's a widely-used grey area — use it for personal
  purposes and expect occasional rate-limiting.
- **Forex Factory's** calendar feed is free for **personal use only — do not rebroadcast it**. The
  always-on part of the calendar (the FOMC schedule) is public Federal Reserve data; the live
  this-week feed is best-effort and the app degrades gracefully without it.

Nothing here is financial advice. Markets data is provided "as is" with no warranty (see [LICENSE](LICENSE)).

### US Fed data (FRED) — built in, no key
The **US FED · MACRO** panel pulls Federal Reserve data (the "free government data bank") straight from
FRED's public CSV export — **no API key, no account**. It (and the World Bank panel) load on open and
**auto-refresh every 15 minutes**; the LOAD button still forces an immediate refresh. Pick a series:
10Y / 2Y Treasury yields, the 10Y–2Y yield-curve spread, Fed funds rate, CPI inflation (YoY),
unemployment, 30-yr mortgage rate, real GDP. To add more series, drop another `<option>` into
`#fred-series` in `public/index.html` (value = `SERIES_ID|transform`, e.g. `PAYEMS|chg`).

---

## Project structure

```
finsight/
├── server.js              # Zero-dependency Node backend (API proxy + portfolio store + alert checker)
├── start.command          # Double-click launcher (macOS)
├── install-autostart.sh   # Install launchd agent (auto-start at login)
├── uninstall-autostart.sh # Remove the launchd agent
├── package.json
├── README.md              # This file (how to use it)
├── DOCS.md                # Developer docs: architecture, config, full API reference
├── LICENSE                # MIT
├── data/                  # Your data — git-ignored, never leaves your machine
│   └── portfolio.json     # Portfolio + watchlist + alerts (created on first use)
└── public/
    ├── index.html         # Terminal UI
    ├── styles.css         # Dark "terminal" theme
    ├── chart.js           # Self-contained canvas trading chart (candles, indicators, drawing tools)
    └── app.js             # Frontend logic
```

---

## Customize it

- **Change the market overview symbols:** edit `MARKET_GROUPS` near the top of `server.js`.
- **Change colors:** edit the `:root` variables at the top of `public/styles.css`.
- **Change refresh rate:** the `setInterval(..., 15000)` calls at the bottom of `public/app.js`.
- **Add more World Bank indicators:** add `<option>`s in `public/index.html` (`#wb-indicator`).
- **Add a new data source:** add a fetch helper + route in `server.js`, then render it in `app.js`.

---

## Notes & limits
- Yahoo's batch quote endpoint now requires auth, so quotes are fetched per-symbol and cached ~15s.
  A minimal `User-Agent` is used because a full desktop-browser UA gets rate-limited (HTTP 429).
- **Market value** is converted at the **current** FX rate; **cost basis** uses each lot's
  **purchase-time** FX rate — that difference is exactly the Stock-vs-FX P&L split.
- Realized (closed-trade) P&L **is** FX-decomposed into stock vs currency (sells taken before this
  feature existed are counted in the total but not split, and are labelled as such).
- Everything runs locally; nothing is sent anywhere except the public data APIs above.
