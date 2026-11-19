# FinSight AI Agent Guidelines

> Instructions for coding agents (Claude Code, Codex, Antigravity, Cursor) working inside `finsight/`.

> **Picking up from another session or account?** Read [docs/HANDOFF.md](docs/HANDOFF.md) first. It holds the current state, the first checks to run, and how CI and branch protection work.

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
2. **No LLM Arithmetic:**
   * All figures, returns, weights, and sizing must come from deterministic tool execution (`query_positions`, `get_exposures`, `size_position`).
3. **Read-Only Toward the User's World:**
   * The agent cannot contact anyone or change FinSight data or the user's records. Durable facts the user states go to `propose_record_update` (a proposal only).

---

## 3. Engineering Quality Gates

* **Node.js:** Node ≥ 24 with native TypeScript execution (erasable syntax only).
* **Checks:** `npm run agent:test` (typecheck, tests, and secret scan) must pass before committing.
* **Python quant worker:** After changing `agent/quant/`, run `npm run quant:test` (first `uv sync --project agent/quant`) and `npm run quant:verify`. Portfolio replay and metrics live there.
* **Agent Spec First:** Read `agent/docs/SPEC.md` before changing the agent. Changes that contradict it need the user's approval.

### Verification

A change is done when there is evidence it works, not when the code is written.

* **Run it.** For anything a user can see, use the `/verify` skill (`.claude/skills/verify/`): an isolated server with synthetic data, driven through the feature map. Never verify against the personal app on port 8001.
* **Review against [REVIEW.md](REVIEW.md).** Check only the items whose trigger matches the diff.
* **Ledger and import rules are properties.** A new rule about lots, sales, imports, number parsing or accounts goes in `test/ledger-properties.test.ts` as a rule that holds for every input. Keep a single-example test only as a regression for a reported case.
* **Refactors:** `npm run verify:diff` compares the API against `origin/main`.
* **Three rounds, then stop.** If checks still fail after three fix attempts, stop and report what fails and why.
* **Flaky tests:** no sleeps, no reruns until green, no weakened assertions. Find the cause or delete the test and record why.
* **Say what was verified.** End each commit message with `Verified:` and the checks run (for example `Verified: npm test, e2e PILOT-1, /verify`), or `Verified: none` and the reason.
* **Keep checks lean.** Before adding a CI step or a slow test, check whether an existing one already covers it. Remove checks that a type, lint rule or other test now enforces.

---

## 4. External MCP Client Protocol (`claude mcp add finsight`)

Register with `claude mcp add finsight -- node <finsight>/agent/src/cli.ts mcp`. For Codex, add the same command under `[mcp_servers.finsight]` in `~/.codex/config.toml`.

When external AI assistants or tools connect to FinSight's tool registry over MCP (`node agent/src/cli.ts mcp`):
- **Numbers come exclusively from tool calls:** All totals, allocations, and sizes must be retrieved via `query_positions`, `get_exposures`, and `size_position`. Never perform LLM mental arithmetic.
- **Data Timestamps:** Always cite `asOf` or `retrievedAt`. Explicitly report missing or unverified data.
- **Strategy Evidence:** Signals come only from `run_strategy` and `scan_strategies`, and portfolio backtest figures only from `backtest_portfolio`, `get_quant_run` and `validate_quant_run`. Label non-accepted strategies as research only.
- **Untrusted Web Data:** Cite source URLs and retrieval dates for web facts. Propose record updates only via `propose_record_update`.
