# FinSight AI Agent Guidelines

> Instructions for coding agents (Claude Code, Codex, Antigravity, Cursor) working inside `finsight/`.

---

## 1. Product Backlog & Docs-as-Code Protocol

To maintain architectural integrity and prevent task fragmentation across runs:

1. **Requirements and execution:**
   * Read [docs/README.md](docs/README.md), then [docs/BACKLOG.md](docs/BACKLOG.md) and the selected requirement.
   * The product backlog owns feature requirements and spec IDs. In the investment workspace,
     `harness/queue.json` owns scheduling, blockers and verified completion, while `harness/STATE.md`
     identifies the active checkout. User instructions override queue order; record the reason.
   * Link feature specs to execution task IDs. Existing engineering tasks may use their task contract;
     do not invent a feature spec for routine fixes or documentation work.
   * Keep ideas explicitly deferred until selected. If records disagree, inspect the current request,
     checkout and evidence before updating either; a roadmap label never grants authority.

2. **When the User Brainstorms New Features:**
   * Do not dump unformatted notes into logs or changelogs.
   * Write an explicit feature specification to `docs/features/FEAT-XXX-<slug>.md`.
   * Register the new entry in `docs/BACKLOG.md` under the deferred/ideas section until explicitly selected.
3. **When Completing Features:**
   * Update the status in `docs/BACKLOG.md`.
   * Update the workspace task and handoff when present. Record integrated changes under `CHANGELOG.md`
     with actual commit/evidence hashes; distinguish implemented, verified, merged and deployed.

---

## 2. Hard Boundaries & Safety Rules

1. **No Personal Data in the Repo:**
   * The repo is strictly generic open-source code.
   * Personal holdings, API keys, PIN credentials, tokens (`agent-link.json`), and markdown records (`INVESTMENT_POLICY.md`, `INVESTOR_PROFILE.md`) live exclusively in `~/FinSightData/`.
2. **Never Execute Live Trades (ADR-001):**
   * The agent has zero direct trade execution authority. Order recommendations must be structured as staged tickets awaiting human action.
3. **No LLM Arithmetic:**
   * All figures, returns, weights, and sizing must come from deterministic tool execution (`query_positions`, `get_exposures`, `size_position`).
4. **Read-Only Toward the User's World:**
   * The agent cannot contact anyone or change FinSight data or the user's records. Durable facts the user states go to `propose_record_update` (a proposal only).

---

## 3. Engineering Quality Gates

* **Node.js:** Node ≥ 24 with native TypeScript execution (erasable syntax only).
* **Checks:** `npm run agent:test` (typecheck, tests, and secret scan) must pass before committing.
* **Agent Spec First:** Read `agent/docs/SPEC.md` before changing the agent. Changes that contradict it need the user's approval.

---

## 4. External MCP Client Protocol (`claude mcp add finsight`)

Register with `claude mcp add finsight -- node <finsight>/agent/src/cli.ts mcp`. For Codex, add the same command under `[mcp_servers.finsight]` in `~/.codex/config.toml`.

When external AI assistants or tools connect to FinSight's tool registry over MCP (`node agent/src/cli.ts mcp`):
- **Numbers come exclusively from tool calls:** All totals, allocations, and sizes must be retrieved via `query_positions`, `get_exposures`, and `size_position`. Never perform LLM mental arithmetic.
- **Data Timestamps:** Always cite `asOf` or `retrievedAt`. Explicitly report missing or unverified data.
- **Strategy Evidence:** Signals come only from `run_strategy` and `scan_strategies`. Label non-accepted strategies as research only.
- **Untrusted Web Data:** Cite source URLs and retrieval dates for web facts. Adhere strictly to ADR-001 (zero live trade execution authority; propose updates only via `propose_record_update`).
