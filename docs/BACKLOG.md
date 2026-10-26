# FinSight Product Backlog

> Product requirements index for FinSight and Kestrel. Execution scheduling, blockers and verified completion live in the investment workspace harness when present.
> Maintained by both human developers and AI coding agents (Claude Code, Codex, Antigravity).

---

## Selected work

Implementation is owned by the existing feature session in `feature/open-features`.
These requirements are selected; verification and integration must be read from that session's evidence.
Workspace queue entries remain ready until their acceptance criteria are verified. Do not start duplicate work.

| Spec | Requirement | Execution task | State |
|---|---|---|---|
| [FEAT-003](features/FEAT-003-kestrel-chat-deletion.md) | Chat deletion controls | `CHATDELETE-001` | Selected; isolated implementation |
| [FEAT-005](features/FEAT-005-prompt-cache-optimization.md) | Stable prompt prefix and attachment deduplication | `PROMPTCACHE-001` | Selected; isolated implementation |
| [FEAT-006](features/FEAT-006-new-symbol-trade-sheet.md) | + ADD through the trade sheet | `TRADENEW-001` | Selected; isolated implementation |
| [FEAT-007](features/FEAT-007-account-transfers.md) | Account transfers | `TRADEXFER-001` | Selected; isolated implementation |
| [FEAT-008](features/FEAT-008-ibkr-trade-import.md) | IBKR CSV trade import | `IBKRTRADES-001` | Selected; isolated implementation |

The earlier panel redesign remains `KESTRELUI-001` / `SEARCHUI-001` in the workspace queue.
Several UI pieces are already integrated; reconcile its remaining acceptance criteria before starting
or closing it. This documentation cleanup does not certify completion.

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
