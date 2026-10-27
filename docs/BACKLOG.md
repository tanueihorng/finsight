# FinSight Product Backlog

> Product requirements index for FinSight and Kestrel. Execution scheduling, blockers and verified completion live in the investment workspace harness when present.
> Maintained by both human developers and AI coding agents (Claude Code, Codex, Antigravity).

---

## Merged implementation — 2026-10-27

Completed and verified on **2026-10-27 SGT** in `feature/open-features`.
Merged into main in `d9ee5c8` after local source review and full integration verification. Deployment/restart remains pending.
Verification: **213 unit, 111 agent and 253 browser tests passed**; one existing live-fixture test skipped.
Evidence in the investment workspace: `harness/runs/20261026T171956Z-IBKRTRADES-001-3d89b74e/REPORT.md`.
Chat deletion spacing follow-up: `harness/runs/20261026T172308Z-CHATDELETE-001-06bb7ec1/SPACING-FIX.md`.

| Spec | Completed feature | Execution task | Status |
|---|---|---|---|
| [FEAT-003](features/FEAT-003-kestrel-chat-deletion.md) | Chat deletion, `/delete`, `/clear` and bulk clear | `CHATDELETE-001` | Merged — verified |
| [FEAT-005](features/FEAT-005-prompt-cache-optimization.md) | Prompt-cache optimization with synthetic measurement | `PROMPTCACHE-001` | Merged — verified |
| [FEAT-006](features/FEAT-006-new-symbol-trade-sheet.md) | New-symbol purchases through the trade sheet | `TRADENEW-001` | Merged — verified |
| [FEAT-007](features/FEAT-007-account-transfers.md) | Account transfers preserving lots, FX and undo | `TRADEXFER-001` | Merged — verified |
| [FEAT-008](features/FEAT-008-ibkr-trade-import.md) | IBKR fill preview and duplicate detection | `IBKRTRADES-001` | Merged — verified |

The earlier panel redesign remains `KESTRELUI-001` / `SEARCHUI-001` in the workspace queue.
Several UI pieces are already integrated; reconcile its remaining acceptance criteria before starting
or closing it. This documentation cleanup does not certify completion.

## Selected work in progress

| Feature | Execution | Status |
|---|---|---|
| In-chat stock price charts, source-bound to historical close prices | `CHATCHART-001` | Verified; included in the merge containing CHARTSHIP-001; deployment and live-provider chart qualification pending |
| Smarter visual selection, richer charts, exposure views and safe navigation/alert drafts | `UIUPGRADE-001` | Integrated on main at `dc8a7c9`; demo activated; broader model qualification remains pending |
| Demo defaults to supported Intelligent UI views | `DEMOPARITY-001` | Integrated on main at `dc8a7c9`; explicit settings and model gates remain effective |

## Deferred proposals

| Spec | Proposal | Execution relationship | Gate |
|---|---|---|---|
| [FEAT-001](features/FEAT-001-ibkr-mcp-integration.md) | IBKR MCP integration and live sync | Deferred architecture captured alongside `MULTIAGENT-001`; distinct from CSV import | Explicit user selection and verified design |
| [FEAT-002](features/FEAT-002-investment-council-lenses.md) | Investment lenses and council | `MULTIAGENT-001` blocked/deferred | Explicit user selection; no delegation currently authorized |

---

## 🧊 Ideas & Icebox (Brainstorming)

Exploratory concepts under review; requires an RFC/spec before moving to the Backlog.

| ID | Concept | Description |
| :--- | :--- | :--- |
| **IDEA-001** | Portfolio PDF Memo Export | One-click export of portfolio state, thesis reviews, and Kestrel notes as a clean PDF memo. |
| **IDEA-002** | Look-Through ETF Exposure | Automated fund holdings scraper (using SEC N-PORT / 13F) to resolve underlying tech/semis exposure in ETFs like VOO/QQQM. |
| **IDEA-003** | Multi-Broker Aggregation | Extending the MCP Client architecture to support Alpaca and Webull alongside IBKR. |
| **IDEA-004** | Voice Input for Kestrel | Web Speech API integration in the composer for dictating research prompts. |

---

## Integrated milestones (deployment tracked separately)

| ID | Feature | Completion Date | Evidence / Release |
| :--- | :--- | :--- | :--- |
| **CORE-001** | Kestrel Research Agent Core | 2026-10-24 | Initial release with DeepSeek, Haiku, Claude Code brains, 35 tools. |
| **IUI-001** | Intelligent UI Views | 2026-10-26 | Interactive cards and data tables via `render_ui`. |
| **START-001**| Kestrel Briefing Start Screen | 2026-10-26 | Intraday charts, mover tiles, and dynamic jump list. |
| **KEFFORT-001**| Thinking Effort Control | 2026-10-26 | Slider integrated at `0221396`, then replaced by the pill menu at `a73e6da`. |

---

## Planning contract

[AGENTS.md](../AGENTS.md) contains coding instructions; this page indexes requirements.
In the investment workspace, the harness queue owns execution order, dependency/blocker state,
stop conditions and verified completion. The current user request overrides queue order.
Feature specs describe intended behavior; unchecked criteria and draft ideas do not authorize work.

Link selected features to their execution IDs. Update the relevant spec/backlog and workspace
packet/queue at completion, using evidence from the actual checkout. Record integrated changes
in [CHANGELOG.md](../CHANGELOG.md), distinguishing verification, merge and deployment.
Standalone clones use this backlog and explicit user requests without depending on workspace files.


Modal layering correction (MODALLAYER-001, 2026-10-27): verified in serving main checkout and committed on main at `5f2dda1` and reconciled into feature/open-features. Setup exit controls remain above Kestrel. Routine bug fix; no new feature scope.

Integration evidence in the investment workspace: `harness/runs/20261026T180610Z-FEATURESHIP-001-b6b72115/REPORT.md`. The final source includes the deferred-autofocus repair and static cache shellv52.

Canonical and symlinked-worktree build artifacts are now reproducible through esbuild dependency identity preservation. Both build checks pass60 files and the normalized bundle passes the full integration suite. Deployment/restart remains separate.
