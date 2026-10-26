# FinSight Product Requirements Document (PRD)

## 1. Product Vision
FinSight is a personal, private investment terminal and portfolio cockpit designed for disciplined, self-directed investors. It pairs live market data, multi-account portfolio accounting, and technical charting with an embedded, model-agnostic AI research agent (**Kestrel**).

FinSight exists to answer four fundamental portfolio questions at all times:
1. **What changed?** (Facts, data timestamps, and market movements vs. interpretation).
2. **Is action needed?** (Distinguish urgent constraints from optional noise).
3. **What rule supports it?** (Check against user-accepted policy, valuation hurdles, and risk budgets).
4. **What invalidates the decision?** (Observable disproving criteria and review dates).

---

## 2. Core Pillars & Guardrails

### I. The User is the Final Decision-Maker
* The system informs, analyzes, stresses, and checks against rules; it **never** executes trades, moves money, or alters historical records autonomously.
* Recommendations require explicit user acceptance. Silence or inactivity is never treated as consent.

### II. Grounded Math & Anti-Hallucination
* **Zero LLM Arithmetic:** Every portfolio weight, position size, and aggregate return must be calculated by deterministic code tools (`query_positions`, `get_exposures`, `size_position`), never by language models.
* Every market figure must display its retrieval timestamp (`asOf`) and reporting currency (SGD base default).

### III. Radical Privacy & Local-First Security
* **Local Storage:** Holdings, transactions, API keys, chat transcripts, and personal policies are stored locally in `~/FinSightData/` and macOS Keychain. The repository must contain generic code only. Configured remote AI providers receive the context submitted to them; local storage does not mean all inference runs locally.
* **Untrusted Data Boundary:** All web fetches, news feeds, and uploaded files (PDFs/spreadsheets) are treated as untrusted data to defend against indirect prompt injections.

### IV. Three-Tier Memory Architecture
1. **Facts (Live):** Polled live via tools from the terminal; never stored as permanent memory.
2. **Knowledge (Durable):** Versioned Markdown documents (`INVESTMENT_POLICY.md`, `INVESTOR_PROFILE.md`, `DECISION_LOG.md`).
3. **Episodic (History):** SQLite full-text search (`fts_messages` via BM25) for past chat context.

---

## 3. Product Modules

| Module | Core Functionality |
| :--- | :--- |
| **Terminal Core** | Holdings accounting, multi-currency cash, dividend tracking, ledger, and CSV imports. |
| **Chart Engine** | Interactive charts, technical indicators, drawing tools, multi-layout persistence. |
| **Strategy Library** | Sandboxed strategy engines and backtests; unaccepted strategies treated as research only. |
| **Kestrel Agent** | Resilient research companion with pluggable brains (DeepSeek, Claude Haiku, Claude Code, GPT-6 Luna/Sol), tools, and Intelligent UI views. |
| **Intelligent UI** | Native interactive widgets (`render_ui`) for structured stat grids and sortable position tables. |

---

## 4. Roadmap context (execution state is in the backlog)
* **Phase 1 — Core Terminal & Agent Supervisor:** Complete.
* **Phase 2 — Intelligent UI Views & Start Screen Briefing:** Complete.
* **Phase 3 — Reasoning Effort & Cache Optimization:** Active.
* **Phase 4 — External Broker MCP & Multi-Lens Council:** Deferred proposals; explicit selection required.

For technical architecture and API contracts, see [SYSTEM.md](../architecture/SYSTEM.md).
For active and prioritized backlog features, see [BACKLOG.md](../BACKLOG.md).
