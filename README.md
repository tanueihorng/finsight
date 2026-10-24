<div align="center">

<img src="docs/logo.png" alt="FinSight Terminal" width="620">

<h1>FinSight <sub>// personal terminal</sub></h1>

<p><b>A free, Bloomberg-style portfolio terminal that runs entirely on your own machine.</b><br>
Live market data, FX-risk tracking, and an economic calendar — no accounts, no API keys, no build step.<br>
Now with <b>↗ Kestrel</b>, a built-in AI research agent that knows your portfolio.</p>

<p>
<img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-a78bfa">
<img alt="Node ≥ 18" src="https://img.shields.io/badge/node-%E2%89%A5%2018-2ec27e">
<img alt="API keys: none" src="https://img.shields.io/badge/API%20keys-none-38bdf8">
<img alt="Dependencies: zero" src="https://img.shields.io/badge/dependencies-zero-a78bfa">
<img alt="Runs 100% local" src="https://img.shields.io/badge/runs-100%25%20local-2ec27e">
<img alt="AI agent: Kestrel" src="https://img.shields.io/badge/AI%20agent-%E2%86%97%20Kestrel-2ec27e">
<img alt="Models: any" src="https://img.shields.io/badge/models-DeepSeek%20%C2%B7%20Claude%20%C2%B7%20more-38bdf8">
</p>

<p>
<a href="#-meet-kestrel--your-ai-research-agent">↗ Kestrel AI agent</a> ·
<a href="#-quick-start">Quick start</a> ·
<a href="#-features">Features</a> ·
<a href="#-fx-risk--macro">FX risk &amp; macro</a> ·
<a href="#-themes--fonts">Themes</a> ·
<a href="#%EF%B8%8F-architecture">Architecture</a> ·
<a href="DOCS.md">Developer docs</a>
</p>

</div>

---

## ✨ Why FinSight

A personal trading terminal that's **small, hackable, and 100% free** — inspired by the Bloomberg-terminal idea but rebuilt as a ~250 KB zero-dependency web app you run locally. Your portfolio lives in a single `data/portfolio.json` on your machine and **never leaves it**. No sign-up, no paid feeds, no telemetry — just `node server.js` and a browser tab.

It's built for the investor who **funds in one currency and invests in another** (e.g. convert SGD → USD to buy US stocks): it separates how much of your return came from the **stock moving** vs the **currency moving**, and gives you a real **FX-risk cockpit**.

<div align="center"><img src="docs/hero.svg" alt="FinSight terminal — a glimpse of the UI" width="100%"></div>

## ↗ Meet Kestrel — your AI research agent

<div align="center"><img src="docs/kestrel.svg" alt="Kestrel chat panel running a pre-trade check inside FinSight" width="100%"></div>

Press **⌘/** anywhere in FinSight and a chat panel slides in. **Kestrel** is an AI research agent that can see what you can see: your holdings, cash, P&amp;L, upcoming earnings, your strategy library and the chart you're looking at. It answers with real numbers from FinSight, cites its sources, and **never trades**.

> *"Which of my holdings have a live strategy setup?"* · *"How exposed am I to semiconductors?"* · *"What changed in NVDA's last 10-Q?"* · *"Why is my portfolio down today?"* · *"Is adding 20 more TSM a good idea under my rules?"*

| | |
|---|---|
| 🧠 **Any model** | DeepSeek (default, very cheap), Claude Haiku, Claude Code, or any OpenAI-compatible model. Switch mid-chat from the model picker; adding a model is one manifest file |
| 📊 **Knows your portfolio** | 35 read-only tools: positions, exposure by currency/sector, cash, dividends, events, ledger, journal. Totals and weights come from code, not model arithmetic |
| 📈 **Uses your strategies** | Runs the same strategy engines as the chart (pullback, breakout, MA trend, RSI-2, DCA zones), scans holdings for live setups, sizes positions from your real cash |
| 🔎 **Researches** | SEC EDGAR filings and XBRL financials, web search and page reading. Every fact carries a source and a date |
| 🧩 **Skills** | `/pre-trade-check`, `/position-review`, `/earnings-review`, `/why-did-it-move`, `/strategy-scan` — or drop in your own [Agent Skills](https://github.com/anthropics/skills)-format playbooks |
| 📎 **Files & pictures** | Paste or drop PDFs, Word docs, CSVs or chart screenshots and ask about them |
| 🖥️ **Terminal-style chat** | Inspired by Claude Code: streamed answers, live tool calls (`⏺ get_portfolio ⎿ 6 positions`), a "Pricing it in…" status line with rising green candles and a $, `/` command menu, per-answer cost and trace |
| 🔍 **Fully traceable** | Every model call, tool call and data request is logged locally, so any answer can be traced end to end |

<div align="center"><img src="docs/kestrel-architecture.svg" alt="How Kestrel fits into FinSight" width="100%"></div>

**Built to be trusted with your money data**
- 🛑 **Read-only by design** — no tool can trade, move money, message anyone or edit your records. Facts you tell it become *proposals* you confirm.
- 🔐 **Local and locked** — Kestrel runs on loopback behind your FinSight PIN and reads data with a GET-only token. API keys live in the macOS Keychain.
- 🧱 **Hardened** — sandboxed strategy plugins, SSRF-guarded web fetching, untrusted web pages and documents can't give it orders, per-answer spend limits and a daily cap.
- 🙈 **Nothing personal in the repo** — chats, logs, uploads and keys stay in your data folder.

**Turn it on**

```bash
npm run agent:install          # once: installs the agent's dependencies
export DEEPSEEK_API_KEY=...    # or add it to the macOS Keychain (see agent/README.md)
node server.js                 # FinSight starts, supervises and stops Kestrel for you
```

Then press **⌘/** (or the **↗ KESTREL** button). FinSight works exactly as before without it. Full guide: **[agent/README.md](agent/README.md)** · spec: **[agent/docs/SPEC.md](agent/docs/SPEC.md)**.


## 🚀 Quick start

> Requires **Node.js 18+** (no `npm install` — there are no dependencies).

```bash
git clone https://github.com/tanueihorng/finsight.git
cd finsight
node server.js
```

Then open **http://localhost:8000**. On a Mac you can also just double-click **`start.command`**.

Want to look around first? `npm run demo` opens FinSight + Kestrel on a **made-up portfolio** (PIN `2468`) without touching any real data.

A first-launch wizard sets your name + base currency and lets you **import a broker CSV**, add holdings manually, or start empty. Non-technical friend? Point them at **[START-HERE.md](START-HERE.md)**.

<details>
<summary><b>Import your holdings from a spreadsheet (CSV)</b></summary>

Click **IMPORT** in the Positions panel and paste/choose a file. Minimal format (header optional, column names matched loosely; add a `date` column to capture purchase-time FX):

```
symbol,quantity,avg_price,date
AAPL,10,195.50,2024-06-03
D05.SI,200,38.20
0700.HK,100,400
```

Or drop in a raw **Interactive Brokers / moomoo / Tiger** statement — FinSight detects the holdings (and, for IBKR, your dividend history). **EXPORT** downloads your current holdings with live value in your base currency.
</details>

## 🧩 Features

| | |
|---|---|
| 📊 **Portfolio tracking** | Add/sell/average positions; live quotes, P&L, day change, weights |
| 🌐 **Base-currency roll-up** | Hold USD/HKD/EUR stocks, see everything in your currency (default SGD) |
| 💱 **Stock vs FX P&L** | Split every gain into *price move* vs *currency move* |
| 🛡️ **FX risk panel** | USD exposure, blended entry rate, per-buy FX, realized FX, what-if slider, 1-week VaR |
| 📅 **Economic calendar** | Next Fed decision + dot-plot, plus this week's CPI / PCE / jobs / GDP |
| 🏦 **Macro panels** | FRED (CPI, Core PCE, Fed funds, yields), World Bank, VIX, world markets |
| 📈 **Interactive charts** | Candles/line/area, SMA/EMA/Bollinger, RSI, MACD, volume, drawing tools |
| 📐 **Real returns** | Replays your trades: time-weighted return, XIRR, and vs S&P 500 / MSCI World / STI in your currency |
| 🧮 **Analytics** | Allocation donut, sector heatmap |
| 📒 **Ledger + undo** | Every trade in one place; fix a buy's date/price; undo any change; realized gains by year (CSV) |
| 📥 **Broker import** | Interactive Brokers / moomoo / Tiger statements, or plain CSV |
| 💵 **Dividends** | Received and forward income **net of withholding tax**, yield on cost, next ex-date |
| 🗓️ **Company dates** | Upcoming earnings and ex-dividend dates for what you hold or watch |
| 💰 **Cash** | Track uninvested cash per currency — net worth, and foreign cash counts as FX exposure |
| 📲 **Installable** | Install as its own app window; opens instantly; warm cache survives restarts and Yahoo hiccups |
| 🔔 **Price alerts** | Desktop notification + toast + beep, even when the browser is closed |
| 🎨 **Themes & fonts** | Switch accent palette and font; remembered per browser |
| 🔒 **PIN lock** | Hashed PIN with brute-force throttling; the data API stays locked |
| 🗂️ **Multiple accounts** | Separate portfolios (IBKR / Crypto / SGX…) + an All-Accounts view |
| ⚙️ **Configurable layout** | Choose & reorder cards and panels; drag the ⠿ grip to rearrange |

## 💱 FX risk & 📅 macro

Because you fund in SGD but hold USD stocks, part of your gain/loss is the **stock price** moving and part is the **exchange rate** moving. FinSight makes that explicit.

**FX RISK panel**
- **Exposure** — how much of your book (in base currency) rides on USD, plus the USD notional.
- **Blended entry** — your weighted-average USD/SGD cost vs live **spot** and the **drift** between them.
- **FX P&L** — gain/loss from currency alone (open positions) + **realized FX** on closed trades.
- **Per-buy FX history** — one row per purchase: USD/SGD then vs now → the S$ you've won/lost on FX alone.
- **What-if slider** — drag a USD/SGD shock (±%) for the live impact on your book.
- **1-week FX VaR** — a 1σ weekly move and a 95% value-at-risk from recent USD/SGD volatility.
- **Target exposure** — set the share you want in foreign currency; see the gap in S$.
- **Convert now vs later** — what an amount buys at spot, and the typical 1-month range from recent volatility.

**ECON CALENDAR panel** — the next **Fed rate decision** and **dot-plot (FOMC SEP)** date (always shown, from the Fed's published schedule), plus this week's high-impact **CPI / PCE / jobs / GDP** releases with forecast vs previous, in your local time.

<details>
<summary><b>How the FX math works (and its limits)</b></summary>

Each buy/sell records the **exchange rate at that moment** (per lot), so your true cost basis is what you actually paid. `UNREALIZED = STOCK P&L + FX P&L`. Back-date a holding (a `date` column on import, the +ADD date box, or `ADD AAPL 10 195.50 2024-01-15`) and FinSight fetches the **historical** rate so the split is accurate.

- Buys newer than ~7 days show ~0 FX P&L by design (the rate hasn't moved yet — shown as "settling").
- Imported lots without a purchase date fall back to today's rate; add a date to backfill the true entry FX.
- VaR sums per-currency risk (conservative; exact for a single foreign currency).
</details>

## 🎨 Themes & fonts

Open **⚙ Layout** to switch the look — four accent palettes (**Violet** default, **Amber** for the classic Bloomberg feel, **Teal**, **Phosphor** green) and the font (**Mono / Sans / Serif**). All system fonts, so it stays offline. Your choice is remembered in the browser.

## 🗂️ Commands

Type in the top command bar:

| Command | What it does |
|---|---|
| `ADD AAPL 10 195.50` | Buy/add 10 AAPL at avg 195.50 (averages in if held) |
| `SELL AAPL 5 [price]` | Sell 5 AAPL (records realized P&L; price optional → market) |
| `DEL AAPL` | Remove AAPL from tracking |
| `UNDO` | Undo the last change (buy, sell, import, edit, cash…) |
| `LEDGER` | Open all trades — fix a buy's date/price, realized gains by year |
| `CASH USD 5000` | Set uninvested cash in a currency (`0` clears it) |
| `WHT US 15` | Dividend withholding rate for a market (default US 30% — Singapore resident) |
| `Q TSLA` / just `TSLA` | Pull up a security's detail + chart + news |
| `WATCH NVDA` / `UNWATCH NVDA` | Add / remove from the watchlist |
| `ALERT AAPL > 320` | Alert when AAPL crosses a target (`<` for below) |
| `NEWS TSLA` · `MKT` · `HELP` | News for a symbol · refresh markets · help |

<details>
<summary><b>Symbol formats (Yahoo)</b></summary>

US: `AAPL` · Indices: `^GSPC` `^DJI` `^IXIC` `^VIX` · FX: `EURUSD=X` `USDSGD=X` · Crypto: `BTC-USD`
Commodities: `GC=F` (gold) `CL=F` (oil) · Non-US suffixes: `0700.HK` `D05.SI` `BMW.DE` `RELIANCE.NS`
</details>

## 🎭 Demo mode

Double-click **`start-demo.command`** or run `npm run demo`. A second FinSight opens on `http://127.0.0.1:8003` with a made-up portfolio in `~/FinSightDemo` (PIN `2468`) and its own Kestrel instance. Your real data folder is never used, and `npm run demo:reset` reseeds it. Handy for screenshots, testing and showing friends.

## 🔌 Data sources &nbsp;·&nbsp; ⚠️ disclaimer

All free, no key:

| Source | Used for |
|---|---|
| **Yahoo Finance** | Quotes, history, search — stocks, indices, VIX, FX, crypto, commodities |
| **FRED** | US Fed data: Treasury yields, CPI, PCE, Fed funds, unemployment |
| **World Bank** | Macro indicators by country |
| **Forex Factory** | This-week economic-calendar events (CPI/PCE/jobs/FOMC) |

> [!IMPORTANT]
> **Not affiliated** with Bloomberg, Yahoo, Interactive Brokers, Forex Factory, or the Federal Reserve. "Bloomberg-style" describes the look only. The code *fetches* public endpoints for your own personal, local use — it does **not redistribute** any provider's data, and you shouldn't either. **FRED**/**World Bank** are open data; **Yahoo** is an unofficial endpoint (a common grey area — expect occasional rate-limiting); **Forex Factory's** feed is free for **personal use only — don't rebroadcast it**. Nothing here is financial advice; data is "as is" with no warranty.

## 🏗️ Architecture

Every component, how they talk to each other, and where data lives. FinSight owns your portfolio data and all market-data fetching. Kestrel runs as a supervised loopback service with read-only access, and everything except model and data providers stays on your machine.

<div align="center"><img src="docs/architecture.svg" alt="Full FinSight + Kestrel architecture: browser, FinSight server, Kestrel agent (API, chat engine, model adapters, 35 tools, MCP server, sandbox), internet services and local storage" width="100%"></div>

**How the Kestrel chatbot works with FinSight**, in six steps:

<div align="center"><img src="docs/kestrel-flow.svg" alt="How Kestrel works inside FinSight: you ask, FinSight checks your PIN and passes it on, Kestrel and the AI model use tools that read your portfolio through FinSight, run your strategies and research, then the answer streams back" width="100%"></div>

<details>
<summary><b>Component summary</b></summary>

| Layer | Pieces |
|---|---|
| **Browser** | Terminal UI (`public/app.js`, `chart.js`), ↗ Kestrel panel (`agent-panel.js`, SSE stream), service worker (static files only), PIN lock |
| **FinSight server** (`:8001`) | `server.js` router with security headers and Host check · `lib/auth` PIN sessions · `lib/agentlink` GET-only agent token and `/api/agent/*` proxy · `lib/agentproc` agent supervisor · domain logic in `lib/` (portfolio, ledger, dividends, performance, market, macro, charts, journal, cache) |
| **Kestrel agent** (`127.0.0.1:8100`) | HTTP API (`/v1`, loopback and secret gate) · chat engine (tool loop, limits, retries, SSE events) · model adapters (OpenAI-compatible, Anthropic SDK, Claude Code CLI) · 35 read-only tools · MCP server (stdio) · strategy sandbox · SSRF-guarded fetch · uploads · skills · interaction log |
| **Storage** | `~/FinSightData`: portfolio and app JSON files (0600) · `agent/agent.db` SQLite (threads, messages, turns, events, traces, cost, cache, proposals, FTS) · logs, uploads, skills, config · macOS Keychain for API keys |
| **Internet** | LLM providers (DeepSeek, Anthropic) · SEC EDGAR · Tavily/Brave search · Yahoo Finance, FRED, World Bank, Forex Factory (via FinSight only) |
</details>

## 📁 Project structure

```
finsight/
├── server.js              # Zero-dependency Node HTTP server (routes only)
├── lib/                   # Market data, cache, portfolio math, performance, dividends, ledger…
├── test/                  # npm test — offline, zero-dependency (node:test)
├── agent/                 # ↗ Kestrel AI agent (TypeScript, own deps: npm run agent:install)
│   ├── src/               #   chat engine, model adapters, tools, MCP server, sandbox
│   ├── skills/            #   bundled playbooks (/pre-trade-check …)
│   └── plugins/brains/    #   one manifest per model (DeepSeek, Claude…)
├── scripts/demo.js        # Demo mode on a made-up portfolio
├── start.command          # Double-click launcher (macOS)
├── DOCS.md                # Developer docs: architecture, config, full API reference
├── data/                  # Your data — git-ignored, never leaves your machine
│   └── portfolio.json
└── public/
    ├── index.html         # Terminal UI
    ├── styles.css         # Themeable dark "terminal" styles
    ├── chart.js           # Self-contained canvas trading chart
    ├── app.js             # Frontend logic
    ├── agent-panel.js     # Kestrel chat panel
    └── sw.js              # Service worker (installable app; static files only)
```

> **Developers:** see **[DOCS.md](DOCS.md)** for architecture, env-var config, and the full HTTP API reference.

## 📄 License

[MIT](LICENSE) — free to use, modify, and share. Built for personal portfolio tracking, **not investment advice**.

<div align="center"><sub>Made for people who fund in one currency and invest in another.</sub></div>
