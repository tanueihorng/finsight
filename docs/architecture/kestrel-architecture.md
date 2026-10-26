# Kestrel AI Agent · System Architecture

> Supporting architecture illustration: [kestrel-architecture.html](kestrel-architecture.html). Read [SYSTEM.md](SYSTEM.md) and the source for current behavior; this diagram is not an execution or safety guarantee.

**↗ Kestrel** is FinSight's built-in investment research agent (`agent/`). It runs as a local, supervised Node.js/TypeScript daemon on `127.0.0.1:8100`. Kestrel allows users to research their live portfolio, evaluate trade risk, retrieve SEC EDGAR filings, and scan for trading strategy setups using any AI model (DeepSeek, Claude Haiku, Claude Code CLI, or OpenAI-compatible models).

Kestrel is strictly **read-only**: it **cannot** trade, move capital, or modify portfolio records.

---

## 1. System Topology & Component Model

```
┌────────────────────────────────────── Kestrel Service (:8100) ──────────────────────────────────────┐
│                                                                                                     │
│   FinSight Host Proxy (Port 8000)                                                                   │
│   ┌────────────────────────────────────────────────────────┐                                        │
│   │ FinSight Terminal · Chat Panel (⌘/) · SSE Client       │                                        │
│   └───────────────────────────┬────────────────────────────┘                                        │
│                               │ HTTP + X-Agent-Secret                                               │
│                               ▼                                                                     │
│   Kestrel API Gateway (:8100 Loopback, Node/TS)                                                     │
│   ┌────────────────────────────────────────────────────────┐                                        │
│   │ HTTP Server & Route Dispatcher (api/server.ts)         │                                        │
│   │ ├── Zod Input Validation & Idempotency Store           │                                        │
│   │ ├── SSE Event Bus (chat/bus.ts)                        │                                        │
│   │ └── Security Gate (Proxy Secret + No-Origin Check)     │                                        │
│   └──────────┬───────────────────┬───────────────────┬─────┘                                        │
│              │                   │                   │                                              │
│              ▼                   ▼                   ▼                                              │
│      ┌───────────────┐   ┌───────────────┐   ┌────────────────┐                                     │
│      │ Chat Engine   │   │ Skills Engine │   │ SQLite Store   │                                     │
│      │ Context Pack  │   │ SKILL.md      │   │ agent.db (WAL) │                                     │
│      │ Tool Loop     │   │ Playbooks     │   │ Traces & Costs │                                     │
│      └───────┬───────┘   └───────────────┘   └────────────────┘                                     │
│              │                                                                                      │
│       ┌──────┴──────────────────────┬──────────────────────────────┐                                │
│       ▼                             ▼                              ▼                                │
│  ┌────────────────────────┐  ┌────────────────────────┐  ┌────────────────────────┐                 │
│  │ Brain Adapters         │  │ 38 Read-Only Tools     │  │ macOS Keychain         │                 │
│  │ DeepSeek · Claude · CLI│  │ Facts · Web · SEC XBRL │  │ finsight-agent         │                 │
│  └────────────────────────┘  └────────────────────────┘  └────────────────────────┘                 │
└─────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Component Breakdown

| Node ID | Component | Role | Description |
|---|---|---|---|
| `host` | **FinSight Host / UI** | `user` | The host terminal interface. Embeds Kestrel as a slide-out panel (⌘/) or dockable widget. Communicates via authenticated reverse proxy (`/api/agent/*`) and consumes Server-Sent Events (SSE). |
| `gateway` | **Agent HTTP API** | `orch` | Native Node HTTP server (`agent/src/api/server.ts`). Requires `X-Agent-Secret` matching `agent-link.json`, validates payloads with Zod, enforces anti-DNS rebinding, and rejects direct browser requests. |
| `engine` | **Chat Engine & Loop** | `compute` | Orchestrates autonomous research turns (`chat/engine.ts`). Enforces max step limits (default 8), per-turn budgets ($0.05), ground-truth context packs, and tool execution loops. |
| `skills` | **Skills Engine** | `seed` | Loads prompt playbooks (`agent/skills/*/SKILL.md`). Injects deterministic rules for playbooks like `/pre-trade-check`, `/position-review`, and `/earnings-review`. |
| `tools` | **Tool Registry (38)** | `embed` | Catalog of 38 read-only investment tools (`tools/registry.ts`). Covers portfolio facts, strategy backtests, SEC EDGAR scraping, and web search. Also exposed over stdio as an MCP server. |
| `brains` | **Model Adapters (Brains)** | `compute` | Pluggable brain layer. Supports DeepSeek Chat/Reasoner, Claude 3.5 Haiku, Claude Code CLI subprocess (`claude -p`), and OpenAI GPT-6 Luna/Sol models. |
| `finsight_api` | **FinSight Core API** | `ext` | Loopback connection to FinSight port 8000 using the restricted read-only agent token. Supplies live holdings, sector weights, dividends, and cash balances. |
| `web_sec` | **Web & SEC EDGAR** | `ext` | External research integration. Features SEC EDGAR XBRL company filing retrieval, Tavily/Brave search, and NetGuard SSRF-protected web fetching. |
| `store` | **SQLite Store (`agent.db`)** | `vector` | Local SQLite database running in WAL mode (`~/FinSightData/agent/agent.db`). Stores thread histories, execution traces, token costs, proposals, and full-text search indexes. |
| `keychain` | **macOS Keychain** | `vector` | Secure OS credential storage (service: `finsight-agent`). Stores `DEEPSEEK_API_KEY`, `ANTHROPIC_API_KEY`, and `TAVILY_API_KEY` so zero secrets touch repository files. |

---

## 2. Deployment Modes

Kestrel supports brain swapping without changing tool or memory layers:

1. **DeepSeek Brain (`deepseek`)**:
   - Default, cost-effective API brain using DeepSeek Flash or DeepSeek V4 Pro (`api.deepseek.com`).
   - Deep reasoning capabilities at ~$0.0003 - $0.0008 per turn.
   - Pairs with Tavily or DeepSeek Web Search.
2. **Claude Brain (`claude`)**:
   - Anthropic API integration (`claude-3-5-haiku`) or local Claude Code CLI (`claude -p`).
   - Supports image/chart attachment analysis (vision input) and complex multi-step reasoning.
   - Pairs with Tavily, Brave, or direct web page reading.

---

## 3. Interactive Data Flows

### Flow 1: Standard Research Turn (`POST /v1/.../messages`)
1. **Host → Gateway**: User submits a question from the panel with page context (active symbol NVDA, view).
2. **Gateway → Store**: Validates idempotency key, records user message to SQLite, and loads thread history.
3. **Gateway → Keychain**: Retrieves model API key from macOS Keychain service `finsight-agent`.
4. **Gateway → Engine**: Initializes turn with 8-step safety ceiling and $0.05 spend budget.
5. **Engine → Brains**: Submits prompt, conversation history, and 38 tool schemas to the model.
6. **Brains → Engine**: Model recognizes it needs facts and emits a tool call: `get_portfolio(symbol="NVDA")`.
7. **Engine → Tools**: Validates parameters with Zod and executes the tool.
8. **Tools → FinSight Core API**: Calls `GET /api/portfolio` over loopback with the GET-only token.
9. **FinSight Core API → Tools**: Delivers live holding quantities (70 shares), cost basis ($124.57), and cash.
10. **Tools → Engine**: Formats tool result with explicit retrieval timestamp for citation.
11. **Engine → Brains**: Submits tool output back to model for synthesis.
12. **Brains → Engine**: Streams completed markdown answer tokens citing exact portfolio facts.
13. **Engine → Store**: Records turn token usage, duration (ms), execution trace, and audit logs.
14. **Gateway → Host**: SSE stream delivers answer to UI and emits `turn.finish` with cost summary.

### Flow 2: Pre-Trade Check Skill (`/pre-trade-check`)
1. **Host → Gateway**: User executes slash command `/pre-trade-check symbol=NVDA action=buy quantity=25`.
2. **Gateway → Skills**: Loads `agent/skills/pre-trade-check/SKILL.md` instruction playbook.
3. **Skills → Engine**: Injects 4 mandatory policy constraints (sizing, cash deficit, concentration, earnings blackout).
4. **Engine → Tools**: Concurrently invokes `get_portfolio`, `get_cash`, and `get_events`.
5. **Tools → FinSight Core API**: Fetches available cash ($1,700), portfolio total ($28,435), and earnings date (23 days away).
6. **FinSight Core API → Tools**: Calculates purchase cost ($3,562.50) against cash ($1,700.00), noting $1,862.50 deficit.
7. **Tools → Engine**: Supplies audited figures to the reasoning loop.
8. **Engine → Host**: Streams formatted safety checklist flagging cash deficit and single-stock concentration breach (42% vs 20% cap).

### Flow 3: SEC EDGAR Research (`get_sec_filing`)
1. **Host → Gateway**: User requests regulatory insight: *"What did NVDA disclose about export controls in their latest 10-Q?"*
2. **Gateway → Engine**: Initiates research turn with regulatory tool access.
3. **Engine → Tools**: Model triggers `get_sec_filing(ticker="NVDA", form="10-Q", section="Item 1A")`.
4. **Tools → Web & SEC EDGAR**: `netguard.ts` verifies URL safety (SSRF guard), then queries `data.sec.gov`.
5. **Web & SEC EDGAR → Tools**: SEC EDGAR returns raw 10-Q corporate submission (Accession #0001045810-26-000045).
6. **Tools → Engine**: Strips HTML boilerplate and extracts relevant risk factor paragraphs.
7. **Engine → Brains**: Feeds normalized disclosures to model for comparative analysis against prior quarters.
8. **Brains → Host**: Streams response directly citing the official SEC accession number and filing date.

### Flow 4: Trade Proposal & Confirmation (L3 Autonomy)
1. **Host → Gateway**: User asks: *"Trim my NVDA position by 15 shares to lock in profits."*
2. **Gateway → Engine**: Model recognizes trading intent. Under Kestrel's safety rules, it **cannot execute trades**.
3. **Engine → Tools**: Calls `propose_trade(action="SELL", symbol="NVDA", quantity=15)`.
4. **Tools → Store**: Persists proposal to SQLite `proposals` table with status `pending`. No change is made to portfolio.
5. **Store → Engine**: Returns proposal ID `prop_7719a`.
6. **Engine → Host**: Delivers interactive proposal card in the chat UI with [Accept] and [Reject] buttons.
7. **Host → Gateway**: User reviews the card and explicitly clicks [Accept].
8. **Gateway → Store**: Updates proposal status to `accepted` in the audit log.

### Flow 5: MCP Tool Call Protocol (stdio)
1. **Host → Tools**: External MCP client (Claude Code CLI or Codex) connects to Kestrel via stdio.
2. **Tools → Host**: Returns full JSON schema for all 38 investment tools.
3. **Host → Tools**: Client issues `tools/call` for `get_portfolio`.
4. **Tools → FinSight Core API**: Queries FinSight port 8000 using the read-only agent token.
5. **FinSight Core API → Tools**: Returns live holding data.
6. **Tools → Host**: Writes standard JSON-RPC 2.0 MCP response to stdout.

---

## 4. Security & Safety Invariants

1. **Read-Only Invariant**: Kestrel has no tool or API route to buy, sell, transfer funds, or mutate files.
2. **SSRF Guard (`netguard.ts`)**: Outbound requests are validated against private IP ranges (`10.0.0.0/8`, `192.168.0.0/16`, `127.0.0.0/8`) and link-local addresses, preventing cloud metadata exfiltration or LAN scanning.
3. **Spend Limits**: Each turn is constrained by a strict token budget (default $0.05) and maximum step count (8) to eliminate runaway model loops.
4. **Auditability**: Every prompt, tool execution, and token cost is logged to `~/FinSightData/agent/logs/YYYY-MM-DD.jsonl` with 14-day local retention.
