# FinSight Terminal · System Architecture

> Supporting architecture illustration: [finsight-architecture.html](finsight-architecture.html). Read [SYSTEM.md](SYSTEM.md) and the source for current behavior; this diagram is not an execution or safety guarantee.

FinSight is a personal Bloomberg-style financial terminal designed to run entirely on the user's local machine with **zero runtime dependencies**, **no external database**, and **no required API keys**. It provides live multi-currency portfolio tracking, FX-risk attribution (separating stock performance from currency fluctuation), technical analysis charts, economic calendar integration, and a supervised local AI research agent (**↗ Kestrel**).

---

## 1. System Topology & Component Model

The system runs entirely locally on loopback (`127.0.0.1`), strictly bound to avoid remote exposure.

```
┌──────────────────────────────────────── User's Mac ────────────────────────────────────────┐
│                                                                                            │
│   Browser (Port 8000)                                                                      │
│   ┌────────────────────────────────────────────────────────┐                               │
│   │ React 19 SPA · Canvas Chart.js · ↗ Kestrel Chat Panel  │                               │
│   └───────────────────────────┬────────────────────────────┘                               │
│                               │ HTTP / SSE (Cookie Session)                                │
│                               ▼                                                            │
│   FinSight Server (:8000 Loopback, Node.js 24+)                                            │
│   ┌────────────────────────────────────────────────────────┐                               │
│   │ HTTP Router (server.ts)                                │                               │
│   │ ├── Auth & Session Gate (lib/auth.ts)                  │                               │
│   │ ├── Agent Reverse Proxy & Token Gate (lib/agentlink.ts)│                               │
│   │ ├── Agent Process Supervisor (lib/agentproc.ts)        │                               │
│   │ └── Domain Services (lib/portfolio.ts, lib/market.ts)  │                               │
│   └──────────┬───────────────────┬───────────────────┬─────┘                               │
│              │                   │                   │                                     │
│              ▼                   ▼                   ▼                                     │
│      ┌───────────────┐   ┌───────────────┐   ┌────────────────┐                            │
│      │ Data Store    │   │ Market Feeds  │   │ Kestrel Agent  │                            │
│      │ ~/FinSightData│   │ Yahoo, FRED   │   │ :8100 Loopback │                            │
│      │ 0600 JSON     │   │ (HTTPS Out)   │   │ (Supervised)   │                            │
│      └───────────────┘   └───────────────┘   └────────────────┘                            │
└────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Component Breakdown

| Node ID | Component | Role | Description |
|---|---|---|---|
| `browser` | **FinSight Terminal (UI)** | `user` | Single-page React 19 application built to `public/app/`. Features plain canvas charts (`chart.js`), multi-currency portfolio tables, FX risk cockpits, and a collapsible Kestrel chat panel. |
| `server` | **FinSight Server** | `orch` | Native Node.js HTTP server (`server.ts`) with zero external runtime dependencies. Enforces security headers (`X-Frame-Options: DENY`, `nosniff`), DNS rebinding protection, and route dispatching. |
| `auth` | **Auth & PIN Sessions** | `orch` | In-memory session manager with scrypt PIN hashing. Issues 7-day `sid` cookies for browser interactions and inspects the token allowlist for agent requests. |
| `engine` | **Portfolio & FX Engine** | `compute` | Computes stock return vs. currency return split, weighted sector and currency exposures, lot-level average cost accounting, and 1-week 95% Value-at-Risk (VaR). |
| `store` | **Local Data Store** | `vector` | Filesystem JSON storage located at `~/FinSightData/` (outside git repository). Files are strictly written with `0600` permissions (owner read/write only) using atomic temporary file renaming. |
| `market` | **Market & Macro Feeds** | `ext` | Unauthenticated public financial APIs (Yahoo Finance v8 chart API, Federal Reserve FRED, World Bank, and Forex Factory calendar). |
| `agent` | **↗ Kestrel Agent Service** | `compute` | Separate autonomous research agent process listening on `127.0.0.1:8100`. Features 38 read-only tools and streams SSE responses back through the FinSight proxy. |
| `supervisor` | **Agent Supervisor** | `seed` | Process manager inside FinSight (`lib/agentproc.ts`). Spawns Kestrel on startup, rotates communication secrets in `agent-link.json`, performs exponential backoff restarts on crash, and shuts it down on exit. |

---

## 2. Deployment Modes

FinSight supports two runtime modes via the mode switcher:

1. **Live Portfolio (`live`)**:
   - Primary operational mode using personal investment records stored in `~/FinSightData/portfolio.json`.
   - Connects to live internet market feeds (Yahoo Finance, FRED, World Bank).
   - High-precision FX conversion rates and live stock prices.
2. **Demo Sandbox (`demo`)**:
   - Isolated sandbox mode started via `npm run demo` or double-clicking `start-demo.command`.
   - Pre-configured demo PIN `2468` and synthetic portfolio data (`data/demo/`).
   - Uses `lib/fakemarket.ts` generating Geometric Brownian Motion (GBM) price walks for fully offline testing.

---

## 3. Interactive Data Flows

### Flow 1: Load Portfolio & Quotes (`GET /api/portfolio`)
1. **Browser → Server**: Terminal UI requests active portfolio with target base currency (`GET /api/portfolio?base=SGD`).
2. **Server → Auth**: Validates `sid` cookie against in-memory session table.
3. **Server → Store**: Reads position quantities, purchase dates, entry prices, and cash balances from `portfolio.json`.
4. **Server → Market**: Queries Yahoo Finance for real-time quotes and currency pairs (`NVDA`, `D05.SI`, `USDSGD=X`).
5. **Market → Server**: Returns latest traded prices, bid/ask, day change, and exchange rates.
6. **Server → Engine**: Calls `portfolioWithQuotes()` to calculate asset P&L vs currency P&L separation:
   $$\text{Stock P\&L} = (\text{Price} - \text{AvgCost}) \times \text{Qty} \times \text{CurrentFX}$$
   $$\text{FX P\&L} = (\text{CurrentFX} - \text{EntryFX}) \times \text{AvgCost} \times \text{Qty}$$
7. **Engine → Server**: Returns consolidated portfolio summary, sector weights, and 1-week VaR.
8. **Server → Browser**: Delivers enriched JSON response; React updates position grids and FX gauges.

### Flow 2: Record Buy / Sell Trade (`POST /api/portfolio/buy`)
1. **Browser → Server**: User submits buy transaction order (Symbol: NVDA, Qty: 20, Price: $140.00).
2. **Server → Auth**: Validates session and checks `Sec-Fetch-Site: same-origin` to block CSRF.
3. **Server → Engine**: Verifies sufficient cash, recalculates blended average cost, and deducts cash.
4. **Engine → Store**: Atomically writes updated positions to `portfolio.json` and appends trade entry to `ledger.json`.
5. **Store → Server**: Disk write fsync completes; server issues an undo snapshot token.
6. **Server → Browser**: Returns `200 OK`; UI presents toast confirmation and updates balances.

### Flow 3: Chart & Technical Indicators (`GET /api/history`)
1. **Browser → Server**: Chart panel requests 1-year daily candlestick data for active symbol.
2. **Server → Store**: Inspects in-memory market cache (`cache.ts`, 15-minute TTL).
3. **Server → Market**: On cache miss, downloads 252 daily OHLCV bars from Yahoo Finance.
4. **Market → Server**: Delivers raw price and volume arrays.
5. **Server → Engine**: Computes technical indicators: 20/50/200 EMA, RSI-14, MACD, and scans for strategy patterns (e.g. Pullback to 20 EMA, DCA zones).
6. **Server → Browser**: HTML5 canvas paints candles, indicator curves, and trade execution markers.

### Flow 4: Kestrel Agent Chat Bridge (`POST /api/agent/*`)
1. **Browser → Server**: User opens Kestrel panel (⌘/) and asks: *"How exposed am I to semiconductors?"*
2. **Server → Auth**: Verifies user session and retrieves shared proxy secret from `agent-link.json`.
3. **Server → Agent**: Proxies HTTP request to `http://127.0.0.1:8100/v1/threads/th_1/messages` with `X-Agent-Secret`.
4. **Agent → Server**: Kestrel tool loop calls back `GET /api/portfolio` using its GET-only token.
5. **Server → Agent**: FinSight returns verified ground-truth portfolio facts (zero write capability).
6. **Agent → Server**: Kestrel streams reasoning and synthesized answers via Server-Sent Events (SSE).
7. **Server → Browser**: Server streams SSE events to the browser panel with live tool call badges and token cost metrics.

### Flow 5: Agent Lifecycle & Supervisor Boot
1. **Supervisor → Store**: Rotates `agent-link.json` on server startup (creates random 32-byte token and proxy secret).
2. **Supervisor → Agent**: Spawns child process `node agent/src/cli.ts` with output piped to `agent.log`.
3. **Supervisor → Agent**: Probes `GET http://127.0.0.1:8100/v1/health` with exponential backoff until healthy.
4. **Agent → Server**: Agent reports PID and online state to supervisor.
5. **Server → Browser**: `GET /api/agent-status` turns the terminal's **↗ KESTREL** button pill green.

---

## 4. Security & Isolation Architecture

1. **Loopback Only (`127.0.0.1`)**: Neither FinSight nor Kestrel bind to `0.0.0.0`. Remote network interfaces cannot reach the application.
2. **DNS Rebinding Defense**: The server verifies that the incoming `Host` header corresponds to the configured local host.
3. **Zero Secrets in Repo**: All personal portfolios, journals, logs, and keys are stored in `~/FinSightData/` or the macOS Keychain.
4. **Read-Only Agent Sandbox**: Kestrel is cryptographically restricted by FinSight to an allowlist of GET endpoints (`TOKEN_READ_PATHS`). It cannot execute trades, edit files, or move funds.
