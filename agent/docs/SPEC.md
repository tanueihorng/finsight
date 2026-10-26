# Investment Agent: Functional Specification (SRS)

| | |
|---|---|
| Document | Software Requirements Specification, structured after ISO/IEC/IEEE 29148 |
| Version | 0.1 draft, 2026-10-24 |
| Status | **Draft for user review.** Items tagged **[D-Qn]** are user decisions (decision log kept privately, outside the repo). Items tagged **[P]** are proposals awaiting confirmation (§16). |
| Owner | User (product owner and final decision-maker); Claude (author) |
| Supersedes | Requirements v0.1 (kept privately; this document is authoritative once approved) |

Requirement language follows RFC 2119: **MUST** / **MUST NOT** = mandatory; **SHOULD** = expected unless a reason is recorded; **MAY** = optional.

---

## 1. Introduction

### 1.1 Purpose
This document defines what the Investment Agent must do and how well it must do it. It contains enough detail to build, test and accept the system without further requirement questions. It does not decide internal implementation choices; those go in the phase-3 Architecture Decision Records (ADRs).

### 1.2 Scope
The Investment Agent is a local, single-user AI agent. It:
- talks with the user through a **collapsible chat panel inside FinSight** [D];
- answers using the user's **live portfolio, cash, events, records and strategy library**;
- **runs multi-step tasks on its own** (research, scans, reports) [D];
- works with **any model**: DeepSeek, Haiku, Claude Code, Codex, GLM, … [D].

It never executes trades, moves money, sends messages as the user or edits accepted policy.

### 1.3 Definitions

| Term | Meaning |
|---|---|
| **Brain** | The model that reasons for a turn or task. *API brain* = a model called over HTTP (DeepSeek, Haiku, GLM); *CLI brain* = an agent program run as a subprocess (`claude -p`, `codex exec`) |
| **Tool** | A function the system exposes to a brain, with a name, a description and an input/output schema. The brain requests a call and the system executes it |
| **MCP** | Model Context Protocol: the standard interface that exposes our tools to any MCP-capable client |
| **Thread** | A chat conversation |
| **Turn** | One user message plus everything the system does to answer it |
| **Task** | A durable, budgeted, resumable unit of background work produced by a workflow |
| **Workflow** | A plugin that defines a type of task: playbook, allowed tools, default brain, budget, output schema |
| **Strategy** | A plugin that defines trading or investing rules: a card (prose and metadata) plus an optional mechanical engine |
| **Context pack** | A dated, compact snapshot of the user's financial situation, built by deterministic code |
| **Autonomy level** | L0 answer · L1 background task · L2 scheduled/event-triggered · L3 writes proposals [D-Q7] |
| **Facts / Knowledge / Episodic** | The three memory layers: live data from FinSight / markdown records and research / threads and runs |

### 1.4 References
Discovery plan, decision log and user stories v0.1 (kept privately), `finsight/docs/FinSight-System-Spec.pdf`, the user's policy records.

---

## 2. Overall description

### 2.1 Product perspective (context diagram)

```
                         ┌──────────── user's Mac (loopback only) ─────────────┐
 User ── browser ──► FinSight server :8000 (public repo, Node)                  │
                     │  existing UI + API, PIN session                          │
                     │  NEW: chat panel UI, /api/agent/* proxy,                 │
                     │       GET-only service token, /api/history/batch,        │
                     │       strategy plugin loader                             │
                     │        │ proxy (shared secret)          ▲ GET + token     │
                     │        ▼                                │                 │
                     │  Agent service :8100 (private repo, Node/TS)             │
                     │   chat engine · task queue · workers · brain adapters    │
                     │   tool layer (in-process + MCP server over stdio)        │
                     │   SQLite agent.db · strategy sandbox (child process)     │
                     │        │                      │                          │
                     └────────┼──────────────────────┼──────────────────────────┘
                              ▼                      ▼
                 Model providers (DeepSeek,   Web: Tavily/Brave, any URL,
                 Anthropic, …) and CLI        SEC EDGAR, FRED
                 brains (claude, codex)
```

### 2.2 Product functions (summary)
F1 Chat · F2 Model selector · F3 Facts tools · F4 Strategy library · F5 Background tasks · F6 Web research · F7 Memory and context · F8 Cost control · F9 Audit/observability · F10 Plugin system · F11 Configuration and operations.

### 2.3 Users
One user: the owner. They are technically capable, use the terminal and are the final investment decision-maker. There are no other user classes, and no multi-tenancy.

### 2.4 Operating environment
macOS, Node ≥ 24 (installed: v24.11.1), FinSight running at `127.0.0.1:8000`, data in `~/FinSightData/`. Claude Code is installed. Codex is **not** installed (v1.1 dependency).

### 2.5 Design constraints
- C1 LLM-agnostic: no feature may require one vendor [D].
- C2 Node/TypeScript agent [D-Q1]; private repo `investment/agent/` [D-Q2].
- C3 FinSight is the single owner of portfolio data, calculations and market-data fetching [D-Q3, Q27]. The agent has **read-only** access.
- C4 No personal data, secrets or agent code in the public `finsight` repo [D-Q2].
- C5 Prohibited capabilities (§8.6) apply at every autonomy level.
- C6 The cross-cutting quality attributes in the decision log (scalability, optimisation, best-fit design, plugins, race safety, security) apply to every component.

### 2.6 Assumptions and dependencies
- A1 FinSight is running when facts are needed. Otherwise the agent degrades (FR-3.9).
- A2 Provider APIs (DeepSeek, Anthropic, Tavily, Brave) are reachable and the user holds keys.
- A3 Full personal context may be sent to any provider the user selects [D-privacy].
- A4 **Liabilities (e.g. loans) are not stored in FinSight today.** `get_liabilities` needs a data source (§16, P-12).
- A5 Sector data comes from FinSight `/api/categories`. ETF look-through is **not** available in FinSight today. Exposure answers MUST say when look-through is missing.

---

## 3. System architecture overview

The detailed design comes in the phase-3 ADRs. This section gives each component's responsibilities so that the requirements can be traced to them.

| Component | Responsibility | Owner of |
|---|---|---|
| **Chat panel** (FinSight UI) | Render threads, stream events, model selector, page context, slash commands | Nothing persistent (UI state in localStorage only) |
| **FinSight proxy** | Authenticate (PIN session), check origin, forward `/api/agent/*` with the shared secret, pass SSE through | — |
| **Agent HTTP API** | Validate input and expose threads/tasks/brains/strategies/cost (§5.2) | — |
| **Chat engine** | Run a turn: assemble context, call the brain, run the tool loop, stream events, persist | Threads, messages, events |
| **Task queue + workers** | Durable queue, lease-based claims, budgets, checkpoints, resume | Tasks, task steps |
| **Brain adapters** | Translate the provider-neutral conversation to/from each provider; streaming; usage accounting | — |
| **Tool layer** | Tool registry, input validation, execution, result shaping, caching; exposed in-process and as an MCP server | Tool caches |
| **Strategy runtime** | Discover, validate and sandbox-execute strategy engines; batch scans | Strategy results |
| **Plugin loader** | Discover, validate and version-check manifests for strategies, workflows, brains and search providers | Plugin registry (in memory) |
| **Store** | SQLite access layer: one writer, migrations | `agent.db` |
| **Observability** | Structured logs, traces, cost ledger, redaction | Logs, ledger |

---

## 4. Functional requirements

Each requirement has an ID, a statement, and acceptance criteria (AC) that map to tests in §12.

### FR-1 Chat

| ID | Requirement |
|---|---|
| FR-1.1 | The user MUST be able to create a thread, send a message and receive a streamed reply in the chat panel. |
| FR-1.2 | Each turn MUST run the tool loop (brain → tool calls → results → brain) until the brain produces a final answer or a limit is hit (FR-8). |
| FR-1.3 | The chat MUST stream these events: text deltas, tool call started/finished (name + short summary), citations, completion, errors (§5.3). |
| FR-1.4 | Every number in an answer that refers to user data or the market MUST come from a tool result in the same turn or from the context pack, and MUST be shown with its data timestamp. |
| FR-1.5 | The system MUST NOT present model arithmetic as fact. Derived figures (sums, weights, sizes) MUST come from deterministic tools. |
| FR-1.6 | Missing data (no quote, missing FX, unknown cost, no look-through) MUST be stated as missing. It MUST NOT be estimated silently. |
| FR-1.7 | Messages are append-only. "Regenerate" creates a new assistant message linked to the same user message. Edits never rewrite history [P-3]. |
| FR-1.8 | Threads MUST persist across restarts and be listable, searchable (FR-7.4), renamable and archivable. Deletion requires explicit confirmation. |
| FR-1.9 | Slash commands: `/model <id>`, `/new`, `/tasks`, `/strategies`, `/cost [today\|month]`, `/help`. Unknown commands return help text. |
| FR-1.10 | **Page awareness:** each user message carries the panel's page context (view; chart symbol, timeframe and loaded strategy; selected account or holding). The engine MUST give the brain this as structured context. |
| FR-1.11 | When a request needs multi-step work beyond a turn budget, the brain MAY call `start_task` (FR-5). The chat MUST show task progress and post the result in the originating thread. |
| FR-1.12 | The user MUST be able to stop an in-flight turn. Stopping cancels pending tool calls and persists the partial reply marked "stopped". |
| FR-1.13 | Two concurrent sends to the same thread MUST NOT interleave. The second waits or is rejected with `409` according to the expected thread version (§9). |
| FR-1.14 | Durable facts the user states in chat ("my loan rate is 4.5%") MUST become a **proposal** shown for confirmation. Nothing is written to profile or records without the user's explicit yes (L3 gate; in the MVP proposals are stored but nothing is applied). |

AC: a golden eval passes ≥ 18/20 (§12.3); stream reconnect loses no events; a concurrency test passes for FR-1.13.

### FR-2 Model selector and brains

| ID | Requirement |
|---|---|
| FR-2.1 | The panel MUST show a model selector listing every brain whose manifest is valid and whose credentials resolve. Each entry shows its name, cost tier and capabilities (tools, native search). |
| FR-2.2 | Switching the brain mid-thread MUST keep history. History is stored in a **provider-neutral format** and translated by each adapter [P-4]. |
| FR-2.3 | Adding a brain = adding a manifest (§6.4) + a key reference. No UI or core change. |
| FR-2.4 | v1 brains: DeepSeek (default), Haiku (Anthropic API), Claude Code (`claude -p`) [D-Q5]. v1.1: Codex, GLM. |
| FR-2.5 | **API brains** run inside the agent's tool loop. **CLI brains** take whole turns, with tools served to them over MCP [D-Q6]. |
| FR-2.6 | CLI brains MUST run in an empty scratch working directory, with tools limited to our MCP tools + web, no shell/edit/write, a timeout and a step cap [D-Q24]. |
| FR-2.7 | Each workflow declares a default brain. A per-run override (selector or `--brain`) takes precedence. |
| FR-2.8 | On a provider error the adapter MUST retry transient errors (429/5xx/network) with exponential backoff and jitter (max 3). It MUST NOT retry 4xx validation errors. An optional fallback brain per manifest MAY be used, and the switch MUST be shown to the user. |
| FR-2.9 | Usage (input/output/cached tokens, searches) MUST be recorded for every call. For CLI brains, use the reported usage where available. Otherwise record `null` (never a fabricated estimate). |

### FR-3 Facts tools (portfolio and market)

All facts tools are **read-only** and call FinSight with the GET-only token [D-Q3]. Every result MUST include `asOf` (data timestamp) and `source`.

| ID | Tool | Input | Output | FinSight source |
|---|---|---|---|---|
| FR-3.1 | `get_context_pack` | — | §7.2 snapshot | several, composed |
| FR-3.2 | `get_portfolio` | `account?` | positions: symbol, name, currency, quantity, avgCost, price, marketValue (native + SGD), unrealised P/L, weight | `/api/portfolio` |
| FR-3.3 | `query_positions` | `filter{currency?, sector?, account?, symbols?}`, `sort{field, dir}`, `limit≤100` | filtered rows + totals computed by code | `/api/portfolio`, `/api/categories` |
| FR-3.4 | `get_exposures` | `by: currency\|sector\|account\|asset_type` | weights + `lookThrough: false` flag | `/api/portfolio`, `/api/categories`, `/api/fx-risk` |
| FR-3.5 | `get_cash` | `account?` | cash by account and currency (+ SGD) | `/api/portfolio` |
| FR-3.6 | `get_quote` / `get_history` | `symbols[]` / `symbol, range, interval` | quotes / OHLCV bars | `/api/quote`, `/api/history` |
| FR-3.7 | `get_events` | `days≤90` | earnings, dividends and ex-dates for holdings | `/api/events`, `/api/calendar` |
| FR-3.8 | `get_dividends`, `get_realized`, `get_performance`, `get_ledger`, `get_watchlist`, `get_alerts`, `get_journal` | per endpoint | per endpoint | matching endpoints |
| FR-3.9 | All | — | If FinSight is unreachable, return error `FINSIGHT_DOWN` with a hint. The brain MUST tell the user and MUST NOT answer from stale memory as if it were current. | — |
| FR-3.10 | All | — | Large results MUST be paginated or summarised (≤ 8k tokens per tool result). A truncated result MUST say so. | — |
| FR-3.11 | `get_liabilities` | — | loan principal, rate, etc. | **source TBD** (A4, P-12) |

### FR-4 Strategy library

| ID | Requirement |
|---|---|
| FR-4.1 | Strategies are **plugins**: one folder per strategy holding `manifest.json`, `card.md`, optional `engine.js` and `results/`. Discovery is automatic from two roots: built-ins in the FinSight repo and private plugins in `~/FinSightData/strategies/` [D-Q4]. |
| FR-4.2 | The five existing engines (Pullback, Breakout/VCP, MA 50/200, RSI-2, 200-day/Fib DCA) MUST be migrated into the plugin format **without behaviour change**. Proof: identical trades and stats before and after on the recorded fixtures. |
| FR-4.3 | The chart and the agent MUST call the same engine code. Reimplementation is not allowed [NFR]. |
| FR-4.4 | Strategy ids are versioned (`pullback@1.0.0`). A change to rules or parameters MUST bump the version. Results are stored per version. |
| FR-4.5 | **Status ladder:** idea → backtested → paper → accepted. Only the user sets `accepted`, and doing so appends a decision-log entry. The agent MAY only propose a promotion [D-Q9]. |
| FR-4.6 | `list_strategies()` returns each strategy's id@version, name, kind (mechanical/discretionary), status, timeframe, suitable instruments and headline evidence. |
| FR-4.7 | `get_strategy(id)` returns the card (rules in plain words, parameters, risk model, evidence links, known weaknesses). |
| FR-4.8 | `run_strategy(id, symbol, asOf?)` runs the engine in the sandbox (FR-4.12) on FinSight bars. It returns the current state (no setup / setup / triggered / in trade), trigger, stop, targets, the R definition and historical stats for that symbol. The output MUST match the chart for the same symbol, date and version. |
| FR-4.9 | `scan_strategies(ids[] \| "all", scope: holdings\|watchlist\|symbols[])` runs M×N as a batch, using one `/api/history/batch` request and shared indicator computation [D-Q27]. It returns a ranked table of live setups. |
| FR-4.10 | `size_position(strategy, symbol, entry, stop, riskPct?)` computes the size from **actual cash**, the current position, the strategy's risk rule and concentration flags. It shows all inputs and the formula. It returns warnings (exceeds cash, creates concentration > a placeholder limit, earnings inside the expected holding window). The policy limits are **placeholders until accepted**, and the output MUST say so. |
| FR-4.11 | Every strategy answer MUST state the status and headline backtest result. Strategies that aren't accepted MUST be labelled "research, not an instruction". |
| FR-4.12 | Engines run in a child process under the Node permission model: read access to their own folder only, no network, no file writes, no child processes. JSON over IPC, 10 s timeout, memory cap [D-Q21]. |
| FR-4.13 | **Conformance suite** runs on load and in CI for every strategy: manifest schema, card completeness, no look-ahead (signal at t is unchanged when bars after t are removed), determinism (same input gives the same output), sandbox compliance, result reproducibility. Failing strategies are listed as `invalid` with reasons and are not runnable. |
| FR-4.14 | A discretionary strategy (no engine) MUST be usable as a checklist. The agent MUST NOT produce mechanical signals for it. |
| FR-4.15 | All mechanical strategies MUST report the same metric set (R/trade or %/trade, win rate, max drawdown, trades, vs buy-and-hold) on a declared universe and cost model, so they can be compared. |

### FR-5 Background tasks and workflows

| ID | Requirement |
|---|---|
| FR-5.1 | A task is created from chat (`start_task`), from the API (`POST /v1/tasks`) or, later, by a trigger (L2). Each carries a workflow@version, inputs, brain, autonomy, budget and an idempotency key. |
| FR-5.2 | The queue is durable (SQLite). Workers claim tasks atomically with a lease and heartbeat. A dead worker's lease expires and the task becomes claimable again [D-Q20]. |
| FR-5.3 | Task state machine: `queued → running → (succeeded \| failed \| cancelled \| paused_budget)`; `paused_budget → queued` on resume. All transitions go through one guarded function. Any other transition is an error. |
| FR-5.4 | Each step (brain call or tool call) is checkpointed as it completes. `resume` continues from the last completed step. Read-only tools are safe to re-run, and non-idempotent tools (future) MUST carry idempotency keys. |
| FR-5.5 | Output MUST validate against the workflow's output schema. On failure the brain gets one repair attempt, then the task fails with the validation error. |
| FR-5.6 | Concurrency cap (default 3 running tasks) and per-provider rate limits [D-Q19]. |
| FR-5.7 | Tasks MUST be cancellable. Cancellation stops further steps and keeps completed checkpoints. |
| FR-5.8 | **MVP workflows:** `ask` (interactive turn), `strategy-scan` (all or chosen strategies × holdings, giving a setups report). Next: `news-brief` (= NEWS-001), `earnings-prep`, `thesis-check`. |
| FR-5.9 | A workflow can use only the tools in its manifest allowlist (least privilege). |
| FR-5.10 | MVP autonomy: L0 + L1 only [D-Q7]. L2 triggers and L3 proposal writes are specified in §15 as future. |

### FR-6 Web research

| ID | Requirement |
|---|---|
| FR-6.1 | `web_search(query, recency?, domains?)` goes through a pluggable search interface. Default Tavily, fallback Brave [D-Q12]. It returns title, URL, snippet, published date (if known) and retrieval time. |
| FR-6.2 | `fetch_url(url)` fetches locally and extracts readable text (HTML) or text (PDF), with a ~15k character cap, and returns the final URL after redirects [D-Q13]. |
| FR-6.3 | **SSRF guard:** reject non-http(s) URLs. Resolve DNS and reject loopback, private, link-local, CGNAT, multicast and cloud-metadata ranges (v4 and v6). Re-check on **every redirect** and pin the resolved IP for the connection. Cap at 5 redirects, 10 MB, 20 s. Allow only listed content types [D-Q25]. |
| FR-6.4 | `edgar_filings(ticker, forms?, since?)`, `edgar_financials(ticker, concepts?)` (XBRL company facts) and `fred_series(id, range)` [D-Q14]. EDGAR requests MUST send a descriptive User-Agent with a contact address and respect SEC fair-access rate limits. |
| FR-6.5 | Every web-derived fact in an answer MUST carry its URL, retrieval date and source class (primary/secondary/unverified) [D-Q15]. |
| FR-6.6 | Fetched content is wrapped as untrusted data. Instructions inside it MUST be ignored and flagged to the user [D-Q16]. |
| FR-6.7 | Budgets per task: ≤ 10 searches, ≤ 15 fetches. Search cache 24 h, page cache by URL (respecting `Cache-Control`, with a maximum of 24 h) [D-Q17]. |
| FR-6.8 | Our search tools are offered to every brain. Native search (Claude Code, Codex, Haiku) is allowed but MUST meet FR-6.5 [D-Q18]. |

### FR-7 Memory and context

| ID | Requirement |
|---|---|
| FR-7.1 | **Facts** are always fetched live through tools. They MUST NOT be cached in long-term memory as truth. |
| FR-7.2 | **Knowledge** = markdown files (policy, profile, decision log, theses, research reports, strategy cards), read through `get_policy`, `get_profile`, `get_decisions(n)` and `search_memory`. Policy answers MUST distinguish *accepted* from *proposal*. |
| FR-7.3 | **Episodic** = threads, tasks and runs in SQLite. |
| FR-7.4 | `search_memory(query, scope: notes\|threads\|all, limit)` uses SQLite FTS5 with BM25 ranking and returns passages with source paths or links. No embeddings in the MVP. Embeddings are added only if evals show retrieval failures. |
| FR-7.5 | **Context assembly per brain call**, in this order (cache-friendly): ① stable system prompt + tool menu (byte-stable for prompt caching) ② context pack (refreshed when > 15 min old or on a new thread) ③ thread summary (if the thread is long) ④ recent turns ⑤ page context ⑥ current message. |
| FR-7.6 | When the token count of history exceeds a configurable threshold (default 60 % of the brain's context or 50k tokens, whichever is lower), older turns are summarised by the cheapest configured brain. The summary is stored and the raw history is kept. |
| FR-7.7 | The instruction file `AGENTS.md` in the agent repo (+ a `CLAUDE.md` pointer) holds the same rules for interactive Claude Code and Codex sessions. Prompts MUST be plain markdown with no vendor-only syntax. |

### FR-8 Cost and budgets

| ID | Requirement |
|---|---|
| FR-8.1 | A cost ledger records every billable event: model tokens by type, searches and paid API calls, with price-table version, task, thread, workflow and brain. |
| FR-8.2 | Defaults: US$0.25 per task, US$2 per day for API brains. When the cap is reached, new API-brain work pauses with a clear message. CLI brains are capped by steps and time [D-Q10]. |
| FR-8.3 | Turn limits (defaults): ≤ 12 tool-loop steps, ≤ 120 s, ≤ US$0.05 per chat turn. Hitting a limit ends the turn with what was found plus "limit reached; run as task?". |
| FR-8.4 | `/cost` shows spend by day/month × brain × workflow. Prices come from brain manifests and are versioned. |
| FR-8.5 | A budget warning event fires at 80 % of any cap. |

### FR-9 Audit and observability

| ID | Requirement |
|---|---|
| FR-9.1 | Every turn and task produces a **trace**: ordered steps with brain, model, tool name, arguments, result summary (truncated), tokens, cost, latency and errors [D-Q29]. |
| FR-9.2 | Logs are structured JSON (one line per event) with `traceId`, `threadId` and `taskId`. |
| FR-9.3 | A redaction layer strips secrets (keys, tokens, PIN, Authorization headers) before any log or trace write. A test MUST prove that seeded secrets never appear in logs or `agent.db`. |
| FR-9.4 | The panel offers a run viewer (trace of the current turn/task) and `/cost`. |
| FR-9.5 | Tool calls arriving over MCP (from interactive Claude Code/Codex sessions) are also logged, tagged with the client name. |

### FR-10 Plugin system

| ID | Requirement |
|---|---|
| FR-10.1 | Four plugin kinds: `strategy`, `workflow`, `brain`, `search`. Each has a JSON-Schema-validated manifest with `apiVersion`, `kind`, `id`, `version` (semver) and `permissions` [D-Q26]. |
| FR-10.2 | The loader rejects manifests that are invalid, have an incompatible `apiVersion` or request permissions their kind doesn't allow. Rejections are visible via `/strategies` and `GET /v1/plugins` with reasons. |
| FR-10.3 | Plugin changes are picked up through file watching or `agent reload`, without restarting the service. In-flight tasks keep the version they started with. |
| FR-10.4 | Breaking contract changes bump `apiVersion`. The previous version stays supported for one release. |
| FR-10.5 | Each plugin kind has a **contract test kit** that every plugin must pass (strategy conformance FR-4.13; workflow: schema + evals; brain: tool-call round trip + streaming + usage; search: result shape + errors). |

### FR-11 Configuration and operations

| ID | Requirement |
|---|---|
| FR-11.1 | Config is `~/FinSightData/agent/config.json`, validated against a schema at startup. An invalid config fails fast with a precise error. |
| FR-11.2 | Secrets are read from the macOS Keychain, with a 0600 env-file fallback. Config holds only key *references* [D-Q23]. |
| FR-11.3 | CLI: `agent start\|stop\|status`, `agent run <workflow> [--brain] [--input k=v]`, `agent tasks`, `agent resume <id>`, `agent eval [--brain]`, `agent reload`, `agent token rotate`, `agent doctor` (checks FinSight, keys, plugins, DB). |
| FR-11.4 | Schema migrations are versioned and applied at startup inside a transaction. A backup copy of `agent.db` is made before each migration. |
| FR-11.5 | `agent.db` lives in `~/FinSightData/agent/`, so it is included in the user's existing data backup scope. |

---

## 5. External interface requirements

### 5.1 User interface: chat panel (FinSight)

| ID | Requirement |
|---|---|
| UI-1 | A toggle button in the FinSight header + shortcut (`⌘/` proposed [P-9]) opens and collapses a right-side panel on every view. |
| UI-2 | The panel resizes (drag edge; min 320 px, max 50 % of the viewport). Open/closed state and width are remembered. On narrow viewports (< 768 px) it becomes a full-screen sheet. |
| UI-3 | The layout reflows so chart controls are never covered. |
| UI-4 | Elements: thread list (collapsible), message list, composer, model selector, stop button, task cards with progress, citation chips, tool-call disclosure rows, "Agent offline" state with start command. |
| UI-5 | Keyboard: Enter sends, Shift+Enter adds a newline, Esc stops or closes, ↑ edits the last unsent draft. |
| UI-6 | Follows the FinSight light/dark theme. WCAG 2.2 AA contrast. The live region announces new messages. |
| UI-7 | The panel MUST NOT block FinSight. If the agent is offline or slow, the rest of the app is unaffected. |
| UI-8 | Rendered model output is sanitised (markdown → safe HTML; no raw HTML, no scripts, links open with `rel="noopener noreferrer"`). |

### 5.2 Agent HTTP API (loopback `:8100`, reached only via FinSight `/api/agent/*`)

All requests need the proxy secret header; JSON bodies are validated by schema; errors use `{error: {code, message, details?}}`.

| Method & path | Purpose | Notes |
|---|---|---|
| `GET /v1/health` | liveness + dependency status | used by panel and `agent doctor` |
| `GET /v1/brains` | selector entries | only brains whose credentials resolve |
| `GET /v1/plugins` | all plugins with valid/invalid state | |
| `POST /v1/threads` · `GET /v1/threads` · `GET /v1/threads/:id` · `PATCH /v1/threads/:id` | thread CRUD (rename/archive) | delete needs `confirm: true` |
| `POST /v1/threads/:id/messages` | send a message | body: `content, brain?, pageContext?, idempotencyKey, expectedVersion` → `202 {turnId}` or `409` |
| `GET /v1/threads/:id/events` | **SSE** stream | supports `Last-Event-ID` replay [D-Q28] |
| `POST /v1/turns/:id/stop` | stop a turn | |
| `POST /v1/tasks` · `GET /v1/tasks` · `GET /v1/tasks/:id` | create/list/get | create is idempotent on `idempotencyKey` |
| `POST /v1/tasks/:id/cancel` · `POST /v1/tasks/:id/resume` | control | |
| `GET /v1/strategies` · `GET /v1/strategies/:id` | library | |
| `GET /v1/runs/:traceId` | trace viewer | |
| `GET /v1/cost?period=day\|month` | spend | |
| `GET /v1/proposals` · `POST /v1/proposals/:id/accept\|reject` | L3 (stored in MVP, applied later) | accept requires explicit user action in UI |

### 5.3 SSE event types

`turn.started`, `message.delta {text}`, `tool.started {name, argsSummary}`, `tool.finished {name, ok, resultSummary, ms}`, `citation {url, title, retrievedAt, class}`, `turn.finished {usage, cost}`, `turn.stopped`, `turn.failed {code}`, `task.created {taskId}`, `task.progress {step, of?, note}`, `task.finished {taskId, resultRef}`, `budget.warning {scope, pct}`, `brain.fallback {from, to}`, `proposal.created {id}`. Every event has a monotonically increasing `id` per thread.

### 5.4 MCP interface
The tool layer runs as an MCP server over **stdio** for Claude Code/Codex (local, no network port). It exposes the tools from §4 under the same names and schemas as in-process. Tool descriptions are the single source used for MCP, for the OpenAI-compatible function format and for the Anthropic tool format. Adapters are generated from the registry, never hand-copied.

### 5.5 FinSight changes (public repo, generic, data-free)

| ID | Change |
|---|---|
| FS-1 | **Service token:** a GET-only bearer token, scoped to an allowlist of read endpoints and stored 0600 in DATA_DIR. It is rotatable, and any non-GET request with the token returns 403. |
| FS-2 | `GET /api/history/batch?symbols=&range=&interval=`: one request, uses FinSight's existing cache, enforces a symbol limit (e.g. 200) |
| FS-3 | **Strategy plugin loader:** serve built-in + private plugin engines to the chart from both roots and list manifests via `/api/strategies`. The current `public/strategies.js` and `strategy.js` are migrated without behaviour change. |
| FS-4 | `/api/agent/*` proxy: requires the PIN session, checks the Origin/Referer, adds the shared secret, streams SSE without buffering, timeouts, returns 503 "agent offline" when the agent is down |
| FS-5 | Chat panel UI module (generic, no personal data, no keys) |
| FS-6 | All changes come with tests. FinSight's existing suite (96 tests) stays green. |

### 5.6 Provider interfaces
- **OpenAI-compatible chat completions** with tool calling + streaming (DeepSeek, GLM, others).
- **Anthropic Messages API** via the official SDK (Haiku), using prompt caching for the stable prefix and the server-side web search tool only if the user enables it in the brain manifest.
- **CLI:** `claude -p` with `--allowedTools` restricted to our MCP tools + web and a structured (JSON) output mode; `codex exec` in its read-only sandbox (v1.1).
- **Search:** Tavily, Brave. **Data:** SEC EDGAR, FRED (FRED key reused from FinSight config if present).

---

## 6. Data requirements

### 6.1 SQLite `agent.db` (WAL mode, single writer) [D-Q8, Q20]

| Table | Key columns | Notes |
|---|---|---|
| `schema_migrations` | version, applied_at | |
| `threads` | id, title, version (int, optimistic lock), default_brain, archived, created_at, updated_at, summary, summary_upto_seq | |
| `messages` | id, thread_id, seq, role (user/assistant/tool), content_json (**provider-neutral blocks**), brain, parent_id (regenerate), turn_id, created_at | append-only; unique(thread_id, seq) |
| `events` | id (autoincrement), thread_id, type, payload_json, created_at | SSE replay; pruned after 30 days |
| `turns` | id, thread_id, status, brain, started_at, finished_at, trace_id, stop_reason | |
| `tasks` | id, idempotency_key (unique), thread_id?, workflow, workflow_version, inputs_json, brain, autonomy, budget_json, status, attempt, lease_owner, lease_expires_at, created_at, started_at, finished_at, result_ref, error_json | claim = atomic `UPDATE … WHERE status='queued' OR (status='running' AND lease_expires_at<now)` |
| `task_steps` | task_id, seq, kind (brain/tool), input_hash, output_json, usage_json, status, started_at, finished_at | append-only checkpoints; unique(task_id, seq) |
| `traces` / `trace_steps` | trace_id, step, kind, name, args_json (redacted), result_summary, tokens, cost_usd, ms, error | |
| `cost_ledger` | id, ts, brain, model, kind (input/output/cache_read/cache_write/search/api), units, unit_price, price_version, usd, task_id?, turn_id?, workflow | |
| `cache_search` / `cache_fetch` | key (hash), value_json, fetched_at, expires_at | |
| `proposals` | id, kind (profile/thesis/decision/strategy_status), target, diff_json, source_turn, status (pending/accepted/rejected), decided_at | applying a proposal is a separate, user-initiated action |
| `fts_notes` / `fts_messages` | FTS5 virtual tables | rebuilt incrementally on file change / message insert |

### 6.2 Provider-neutral message content [P-4]
Blocks: `text`, `tool_call {id, name, args}`, `tool_result {call_id, ok, content, asOf?, source?}`, `citation {url, title, retrievedAt, class}`, `notice {kind}`. Adapters translate to and from each provider's format. Provider-specific artefacts (e.g. thinking blocks) are stored in an opaque `provider_extra` field and resent only to the same provider. DeepSeek reasoning replay additionally matches the brain id, model and API origin. This state is not user-visible text or cross-provider context.

### 6.3 Strategy manifest (`manifest.json`) [P-6]
```json
{
  "apiVersion": 1, "kind": "strategy",
  "id": "pullback", "version": "1.0.0", "name": "EMA pullback",
  "type": "mechanical", "status": "backtested",
  "engine": "engine.js",
  "inputs": { "timeframe": "1d", "minBars": 250, "indicators": ["ema9", "ema21", "ema50", "atr14"] },
  "params": { "riskModel": "R", "entry": "stop", "costBps": 10, "slipBps": 5 },
  "instruments": ["us_equity", "etf"],
  "evidence": [{ "path": "results/2026-10-15-ndx.json", "metric": "R_per_trade", "value": -0.16,
                 "universe": "NDX (survivorship-biased)", "costModel": "10bps+5bps", "date": "2026-10-15" }],
  "permissions": []
}
```
Engine contract: `module.exports = { signal(bars, i, params), exit(bars, i, pos, params), meta }`, pure and deterministic, using only `bars[0..i]`. The runtime owns the simulator, costs and metrics, so strategies can't diverge on accounting.

### 6.4 Workflow manifest [P-7]
`{apiVersion, kind:"workflow", id, version, playbook:"playbook.md", tools:[allowlist], defaultBrain, autonomy:"L1", budget:{steps, usd, seconds, searches, fetches}, outputSchema:"output.schema.json", evals:"evals/"}`

### 6.5 Brain manifest [P-8]
`{apiVersion, kind:"brain", id, label, transport:"openai-compatible"|"anthropic"|"cli", model, baseUrl?, command?, keyRef?, pricing:{inputPerM, outputPerM, cacheReadPerM?, perSearch?, version}, capabilities:{tools, streaming, nativeSearch, contextTokens}, costTier:"$"|"$$"|"$$$", limits:{rpm?, tpm?}, fallback?}`

### 6.6 File layout
```
investment/agent/                 private repo
  src/ (api, chat, tasks, brains, tools, strategy-runtime, plugins, store, obs)
  plugins/workflows/ ask/ strategy-scan/ …     plugins/brains/ deepseek/ haiku/ claude-code/
  plugins/search/ tavily/ brave/
  evals/  test/  docs/ (SPEC.md, adr/, threat-model.md)  AGENTS.md  CLAUDE.md
finsight/strategies/<id>/          public built-in strategy plugins
~/FinSightData/strategies/<id>/    private strategy plugins (never committed)
~/FinSightData/agent/              agent.db, config.json, token (0600), logs/
```

### 6.7 Retention
Events: 30 days. Traces: 180 days. Messages, tasks and cost ledger: kept until the user deletes them. Caches expire at TTL. All of these are configurable.

---

## 7. Behavioural specifications

### 7.1 Turn sequence (API brain)
1. Validate the request; check `expectedVersion` (409 on mismatch); take the per-thread turn lock.
2. Persist the user message → emit `turn.started`.
3. Assemble context (FR-7.5) → call the brain (streaming).
4. Tool call(s) → validate args by schema → execute (parallel when the brain emits several, max 4) → persist → emit `tool.*` → feed results back.
5. Repeat until final text or a limit (FR-8.3) → persist the assistant message → `turn.finished` with usage/cost → release the lock.

CLI brain: steps 3–4 are delegated to the subprocess with our MCP server attached. We capture streamed output and tool events where the CLI exposes them, and the final message.

### 7.2 Context pack contents [P-5]
`asOf`; NAV (SGD) and by account; cash by currency; liabilities (if source exists); top 15 positions with weight, currency and sector; currency split; sector split (with `lookThrough:false`); events in the next 14 days; active alerts; policy status line (version + "limits are proposals"); open tasks. Budget ≤ 3k tokens. Built only by deterministic code.

### 7.3 Strategy scan (workflow `strategy-scan`)
Inputs: strategies (default all valid mechanical), scope (default holdings), asOf (default last completed bar). Steps: batch bars → sandboxed engines in parallel (worker pool) → rank live setups by state, then R-multiple quality, then position weight → for the top N, `size_position` + event check → report (schema: table + per-setup card + caveats + data dates). Cost: deterministic part has zero model tokens; the brain writes only the narrative.

---

## 8. Non-functional requirements

### 8.1 Performance and optimisation

| ID | Target |
|---|---|
| NFR-P1 | Agent overhead before the first provider byte: p95 ≤ 150 ms (excluding FinSight call time) |
| NFR-P2 | Context pack build ≤ 500 ms p95 with a warm FinSight cache |
| NFR-P3 | Strategy scan 20 strategies × 100 symbols ≤ 60 s with a warm bar cache, on the user's Mac |
| NFR-P4 | Panel open/collapse ≤ 100 ms. No layout shift on the chart |
| NFR-P5 | Prompt-cache-friendly ordering (FR-7.5). Cache hit ratio is tracked per brain where the provider reports it |
| NFR-P6 | No N+1 calls to FinSight: batch endpoints are used for multi-symbol work |
| NFR-P7 | Idle CPU ≈ 0. No background polling while no tasks are queued (event-driven) |

### 8.2 Scalability
NFR-S1: Strategies, workflows, brains and search providers scale by adding plugins, with zero core edits. NFR-S2: Worker count is configurable. Workers are stateless apart from the DB, so more processes can share the queue. NFR-S3: Tested to 100 strategies × 500 symbols in a nightly benchmark (non-blocking). NFR-S4: Contracts (HTTP API, manifests, neutral messages) are versioned, so components can later move to separate processes or hosts without breaking clients.

### 8.3 Reliability
NFR-R1: A crash mid-task loses at most the in-flight step. NFR-R2: A crash mid-turn leaves a persisted partial message marked `interrupted`. NFR-R3: When FinSight or a provider is down, the failure is shown clearly and nothing is fabricated. NFR-R4: DB integrity check on startup, and a backup before each migration.

### 8.4 Maintainability
TypeScript strict mode; lint + format in CI; module boundaries enforced (no cross-imports outside public interfaces); ≥ 85 % line coverage on core modules (store, tasks, tools, adapters, sandbox); an ADR for every significant decision; conventional commits.

### 8.5 Portability
macOS is primary. Nothing uses macOS-only features except the Keychain, which sits behind a secret-store interface with an env-file fallback.

### 8.6 Prohibited capabilities (all autonomy levels)
The system MUST NOT: place orders or trades; move, transfer or convert funds; connect to broker or bank accounts for writes; send emails or messages on the user's behalf; modify FinSight data; modify accepted policy or the decision log except by appending a user-accepted entry; publish anything; or install software. There are no tools for these, and the tool registry rejects any plugin that declares such permissions.

---

## 9. Concurrency model [D-Q19, Q20]

| Shared resource | Owner / control |
|---|---|
| `agent.db` writes | One writer connection (serialised queue); WAL lets readers run concurrently; `busy_timeout` set |
| Thread | Optimistic `version`; a per-thread in-process turn lock; `409` on a stale `expectedVersion` |
| Task claim | Single atomic `UPDATE … RETURNING`; lease 60 s, heartbeat every 15 s; expired lease → reclaimable; `attempt` incremented, max 3 |
| Task creation | Unique `idempotency_key` → returns the existing task |
| Files (proposals, notes, cards written by tools later) | Write to a temp file + `rename` (atomic); advisory lock file per path; content hash checked before overwrite |
| Plugin registry | Immutable snapshot swapped atomically on reload; in-flight work holds its snapshot |
| Caches | Insert-or-ignore by key; single-flight for concurrent identical fetches |
| FinSight data | Read-only for the agent; FinSight remains the single writer |
| Bar cache | FinSight-owned [D-Q27] |
| Cost caps | Checked and reserved atomically before a billable call; reconciled after |

Required tests: N workers racing for a claim (exactly one wins), a worker killed mid-lease (task resumes once), double-submit with the same idempotency key, concurrent sends to one thread, plugin reload during a scan, cap reservation under parallel calls.

---

## 10. Security requirements and threat model (summary; full STRIDE in `threat-model.md`, phase 3)

**Assets:** portfolio and financial data; API keys; FinSight PIN/session; service token; proxy secret; integrity of answers.
**Trust boundaries:** browser ↔ FinSight · FinSight ↔ agent · agent ↔ providers · agent ↔ web · agent ↔ strategy plugins · agent ↔ CLI brains · agent ↔ MCP clients.

| Threat | Control | Test |
|---|---|---|
| Other local process or web page calls the agent | Bind 127.0.0.1; Host allowlist (anti DNS rebinding); proxy-only secret; no CORS [D-Q22] | request without secret / wrong Host → 403 |
| CSRF via FinSight proxy | PIN session cookie `SameSite=Strict`; Origin check; JSON content-type required | cross-origin POST rejected |
| Token misuse | GET-only, endpoint allowlist, rotatable, 0600 | token POST → 403 |
| Prompt injection from web/news | Untrusted wrapping; no write/send tools; future writes need confirmation; injection eval set [D-Q16] | injected page doesn't change behaviour; flag raised |
| SSRF via `fetch_url` | FR-6.3 | requests to 127.0.0.1, 10/8, 169.254.169.254, IPv6 ULA, redirect-to-private → blocked |
| Malicious or buggy strategy plugin | Sandbox FR-4.12; manifest permission check; timeout and memory cap | plugin tries fs read outside, net, spawn → denied |
| CLI brain overreach | Scratch cwd, tool allowlist, no shell/edit [D-Q24] | attempt to run Bash → refused |
| Secret leakage | Keychain; redaction; secret scan pre-commit and in CI; secrets never in prompts [D-Q23] | seeded secrets absent from logs/DB/prompts |
| XSS in panel from model output | Sanitised markdown rendering UI-8 | script/HTML payloads neutralised |
| Supply chain | Lockfile; minimal dependencies; `npm audit` in CI; pinned versions; no postinstall scripts allowed except an allowlist | CI gate |
| Public-repo data leak | FinSight changes are generic; pre-push scan for personal data patterns | CI gate |
| Cost abuse / runaway loop | Caps FR-8; step limits; daily cap pauses queue | loop test stops at the limit |

---

## 11. Error handling

| Code | Situation | Behaviour |
|---|---|---|
| `FINSIGHT_DOWN` | FinSight unreachable | Tool error; brain tells the user; panel hint |
| `FINSIGHT_AUTH` | token invalid | `agent doctor` hint; no retries |
| `PROVIDER_RATE_LIMIT` / `PROVIDER_ERROR` | 429 / 5xx | backoff retry ×3, then optional fallback brain (shown) or fail |
| `PROVIDER_INVALID` | 4xx | fail turn with message; no retry |
| `BUDGET_EXCEEDED` | cap hit | stop gracefully, partial result, offer task/raise cap |
| `TOOL_INPUT_INVALID` | schema failure | return error to brain (it may correct); counted as a step |
| `TOOL_TIMEOUT` | tool > limit | error to brain; step recorded |
| `PLUGIN_INVALID` | manifest/conformance fail | plugin unavailable; reason listed |
| `SANDBOX_VIOLATION` | engine breaks permissions | engine killed; strategy marked invalid until fixed |
| `SSRF_BLOCKED` | disallowed URL | error to brain; logged |
| `CONFLICT` | thread version / duplicate | 409 / existing resource returned |
| `OUTPUT_SCHEMA_INVALID` | task output invalid | one repair attempt, then fail |

---

## 12. Verification and validation

### 12.1 Test levels
Unit · contract (per plugin kind, FR-10.5) · integration (agent ↔ FinSight on a **synthetic store** via `FINSIGHT_DATA_DIR`, recorded bars) · end-to-end (browser panel against synthetic FinSight) · concurrency (§9) · security (§10) · performance benchmarks (§8.1) · evals (§12.3).

### 12.2 Gates
Every merge: unit + contract + integration + concurrency + security + lint + type-check + secret scan + FinSight suite green. Evals run on demand and before each release, because they cost money. Benchmarks run nightly or on demand.

### 12.3 Evaluation suite
- **Golden set:** 20 questions on the synthetic portfolio with exact expected values (tolerance per item) + 5 of the user's own real questions [P-11].
- **Scoring:** numeric match; citation present; data date present; no unsupported numbers (each answer number is checked against the tool results in its trace).
- **Behaviour cases:** FinSight down, missing FX, a trade request (must decline), strategy without engine, prompt-injected page, ambiguous question (must ask or state an assumption), budget hit.
- **Report per brain:** score, tokens, cost, p50/p95 latency. Stored per run for regression comparison.

### 12.4 Traceability (excerpt; full matrix generated in phase 3)

| User story | Requirements | Tests |
|---|---|---|
| US-1 Ask portfolio | FR-1, FR-3, FR-7.5 | eval golden set; FINSIGHT_DOWN test |
| US-2 Apply strategies | FR-4.6–4.11, FR-7.2 | strategy tool contract; chart-parity test; sizing tests |
| US-3 Add strategy | FR-4.1, 4.13, FR-10 | conformance kit; invalid-plugin test |
| US-4 Swap model | FR-2 | brain contract kit; cross-brain eval |
| US-5 Audit | FR-9 | trace completeness; redaction test |
| US-13 Autonomous tasks | FR-5 | state machine, lease, resume, cancel tests |
| US-14 Brain per task | FR-2.5–2.7 | CLI brain contract test |
| US-15/16 Chat panel | FR-1, UI-1–8, FS-4/5 | E2E panel tests; SSE replay |
| Web search (Q11–18) | FR-6 | SSRF suite; citation checks; cache tests |

---

## 13. Release plan (vertical slices)

Every slice ends runnable and demoable. **Definition of done:** acceptance criteria met; tests and gates green; docs and ADRs updated; harness `STATE.md` updated; user demo and acceptance.

| # | Slice | Delivers | Exit criteria |
|---|---|---|---|
| 0 | Foundations | private repo, TS toolchain, CI gates, secret scan, threat model, ADRs 1–n, synthetic store fixture | CI green on an empty skeleton; threat model reviewed |
| 1 | FinSight enablers | FS-1 token, FS-2 batch history, FS-3 strategy plugin migration (no behaviour change), FS-6 tests | FinSight suite + new tests green; chart unchanged (parity test) |
| 2 | Facts tools + MCP | tool registry, FR-3 tools, MCP stdio server | Claude Code can answer portfolio questions via MCP on the synthetic store |
| 3 | Chat engine + DeepSeek | store, threads, turn loop, neutral messages, SSE, cost ledger, traces, API | `curl` chat works; eval v0 ≥ 15/20 with DeepSeek |
| 4 | FinSight chat panel | FS-4 proxy, FS-5 panel, model selector, page context | E2E tests; user tries it on the synthetic store, then real data |
| 5 | Strategy runtime | sandbox, conformance kit, `list/get/run/scan/size` | parity with chart; sandbox escape tests blocked |
| 6 | Tasks L1 + strategy-scan | queue, leases, checkpoints, resume, workflow plugin, `start_task` | concurrency suite green; scan report on holdings |
| 7 | Web research | search plugins, fetch + SSRF guard, EDGAR, FRED, caching, citations | SSRF + injection suites green |
| 8 | More brains + release | Haiku, Claude Code brain, cross-brain eval, security review, docs | **v0.1**: eval ≥ 18/20 on ≥ 2 brains; security review passed |
| 9+ | Next | Codex, GLM, news-brief (NEWS-001), earnings-prep, thesis-check, L2 triggers, L3 proposals, terminal chat | per slice |

---

## 14. Out of scope (v0.x)
Trade execution; broker/bank write connections; multi-user or hosted deployment; mobile app; embeddings/vector DB (until evals justify them); fine-tuning; automatic policy changes; publishing.

## 15. Future requirements (specified, not built in MVP)
- **L2 triggers:** earnings within N days, FinSight alert fired, new strategy card, new filing for a holding. Triggers enqueue workflows; at most one trigger per event key per day (idempotent).
- **L3 proposals:** apply accepted proposals to records with an audit entry; every write after web reads needs explicit confirmation.
- **Terminal chat** on the same API.
- **Redaction switch** per provider (NFR from REQUIREMENTS v0.1).

## 16. Open items: proposals awaiting user confirmation (grilling round 4)

| ID | Proposal | Section |
|---|---|---|
| P-1 | SQLite driver: **better-sqlite3** (mature, synchronous, bundled FTS5), behind a store interface. Built-in `node:sqlite` works here but is still marked experimental in Node 24 | §6.1 |
| P-2 | Agent service port **8100**, loopback | §5.2 |
| P-3 | Append-only messages; regenerate = sibling message; no history edits | FR-1.7 |
| P-4 | Provider-neutral message format stored; adapters translate; provider extras stay opaque | §6.2 |
| P-5 | Context pack contents and ≤ 3k-token budget, refreshed at 15 min | §7.2 |
| P-6 | Strategy manifest + engine contract; runtime owns simulator/costs/metrics | §6.3 |
| P-7 | Workflow manifest with a tool allowlist | §6.4 |
| P-8 | Brain manifest incl. pricing, capabilities and fallback | §6.5 |
| P-9 | Panel shortcut `⌘/`; right-side panel, 320 px to 50 % | UI-1/2 |
| P-10 | Turn limits: 12 steps / 120 s / US$0.05 | FR-8.3 |
| P-11 | Eval set: Claude drafts 20 synthetic questions; the user adds 5 real ones | §12.3 |
| P-12 | Liabilities source: add a small manual "liabilities" section to FinSight (generic feature, data in DATA_DIR) **or** read Finance HQ | FR-3.11 |
| P-13 | Release slices 0–8 in the order above | §13 |

---

## 19. v0.2 additions (2026-10-24, user requests)

| ID | Requirement | Status |
|---|---|---|
| FR-12 Skills | Agent Skills format (`SKILL.md`: front matter `name`, `description`; markdown body). Bundled skills in `agent/skills/`, user-installed in `<home>/skills/` (an installed skill overrides a bundled one of the same name). Only name + description go in the system prompt; `use_skill` / `read_skill_file` load content on demand; `/skill-name` in chat preloads it. `agent skills add <github-folder-url>` installs text files only (≤500 KB). Skills cannot run scripts and get only the read-only tools. Invalid skills are listed with reasons and never loaded. Hot reload on file change. | built |
| FR-13 Attachments | Upload ≤5 files per message, ≤15 MB each, via ⊕, paste or drop. Types are detected by content: PNG/JPEG/GIF/WebP; PDF/DOCX/TXT/MD/CSV/JSON. Text is extracted locally (unpdf, mammoth) and preserved in full as UNTRUSTED data. Inline previews share a conservative capacity budget for the selected model; list_attachments, read_attachment and search_attachments give paginated access to all extracted text in the current chat. Legacy capped extracts are re-extracted locally from the preserved original where possible; unrecoverable truncation is disclosed. Images go only to vision models (manifest `capabilities.vision`: Haiku; Claude Code reads them via a scoped `Read(./**)`); other models get a note to switch. Stored 0600 under `<home>/uploads/`. | built |
| FR-14 Interaction log | One JSONL file per day under `<home>/logs/` (0600, redacted, fields capped at 100 KB, 14-day retention). It records agent API requests, turn start/end, full model requests and responses, tool calls and results, FinSight requests, CLI-brain events, uploads and errors with stacks. Each line carries `turnId`/`threadId` (propagated with AsyncLocalStorage). It can be read with `agent logs [turnId] [--kind k]`, the per-answer **trace** button, and `/logs` (recent errors). | built |
| FR-15 Demo mode | `finsight/start-demo.command` or `npm run demo` runs FinSight on :8003 and the agent on :8103 against a made-up portfolio in `~/FinSightDemo` (seeded once; `--reset` reseeds), with demo policy records. It refuses to use the real FinSightData folder. Demo PIN 2468, shown in the terminal. It uses the 127.0.0.1 origin, so browser storage stays apart from the personal app. | built |
| UI-9 Agent identity | The assistant is named **Kestrel** (configurable `assistantName`). | built |
| UI-10 Terminal-style chat | Modelled on Claude Code: `>` user prompts; ⏺ reply and tool bullets with ⎿ result lines; an animated status line (rising green candles then a gold $, `<verb>… (12s · ↓ ~N tokens · esc to interrupt)`); brand mark ↗ whose verb reflects the running tool; a bordered prompt box with a `/` menu (skills + commands, arrow keys, Tab/Enter); attachment chips; model and context toggles in the footer; per-answer cost, time, copy and trace. Esc interrupts, and never closes the panel while text is typed. The panel boots only after the PIN unlock. | built |

## 17. Approval

| Role | Name | Decision | Date |
|---|---|---|---|
| Product owner | User | pending | |

## 18. Change log

| Version | Date | Change |
|---|---|---|
| 0.1 | 2026-10-24 | First full draft from discovery, requirements v0.1 and grilling rounds 1–3 |
| 0.2 | 2026-10-24 | §19: skills, attachments, interaction log, demo mode, Kestrel identity, terminal-style chat UI |

## Context repair implementation note — 2026-10-26

The fixed 160k-character history cut and 60k inline document limit are replaced by deterministic model-capacity bounds. Current implementation conservatively estimates text tokens using serialized UTF-8 bytes (including expanded documents, tool schemas, provider state and system prompt), reserves output and 10% capacity headroom, retains complete recent user/tool exchanges and explicitly reports older-turn/document omissions. The current turn is never silently dropped: an unfit turn fails before its provider request. Full raw history remains append-only and searchable through search_memory. This repair does not implement FR-7.6's separate model-generated summarization proposal or introduce paid compaction calls.

Document previews allocate half of the available history budget across unique uploaded files; paging/search can retrieve omitted passages, with file IDs scoped to the current chat. Full text extraction removes the older 200k-character storage cutoff. Existing upload byte limits remain unchanged. Text context reserves are conservative estimates, not exact provider tokenization guarantees. Image payloads are not charged as serialized base64: each image reserves a fixed 16,384-token estimate (actual vision tokens depend on provider preprocessing/resolution). Long-context price tiers for Haiku 5.5 and Luna are included in cost accounting; configured model defaults and existing spend/time/step limits are unchanged.

### Review corrections — 2026-10-26

Provider-only empty messages are removed after foreign metadata is stripped, while same-brain reasoning-only messages remain available for replay. Extraction metadata records attempted failures as version 2/failed, including a failed legacy repair, so model steps do not repeatedly run parsers. A new upload explicitly retries extraction. Global attachment search uses nextCursor {id, offset}; scalar offsets require an explicit document id. Cursor IDs are validated against the current chat, and offsets reset to 0 when moving to another document.

## Intelligent UI Phase 1 amendment — 2026-10-26

Owner requested implementation of the reviewed plan. Adds the presentation-only
`render_ui` API chat tool and stat/table elements under UI-4. UI-8 now includes
strict shared-schema validation, server-bound source figures and escaped strings.
C3/FR-4.10 remain unchanged: no new portfolio arithmetic, financial actions or
record edits. Accepted canonical snapshots persist separately from raw model
requests and reload only through authenticated thread responses. Snapshot data
times and limitations remain visible; UNPEEK hides new snapshots and redacts copy.

Availability requires both `KESTREL_UI=1` and per-brain `capabilities.ui`; all bundled
brains remain off. MCP/CLI, charts, calculators, actions and progressive rendering
are deferred. Deterministic mock round-trip/regression coverage is implemented;
FR-10.5 live qualification and the proposed §12.3 paid UI eval suite remain pending,
so this amendment does not assert production rollout acceptance. See
`INTELLIGENT-UI.md` for the implemented contract, limits and rollout criteria.
