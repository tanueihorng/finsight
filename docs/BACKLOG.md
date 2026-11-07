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

The Kestrel panel redesign and search-provider picker (`KESTRELUI-001` / `SEARCHUI-001`) were reconciled and verified on 2026-10-28. The existing design was already integrated; this revision includes a docked-rail correction. The full browser rerun passed 259 tests with one skipped. See `harness/runs/20261028T033406Z-KESTRELUI-001-b6b7fc11/RUN.md` in the investment workspace.

## Selected work in progress

| Feature | Execution | Status |
|---|---|---|
| [FEAT-018](features/FEAT-018-etf-look-through.md) ETF look-through, overlapping issuer exposure and single-issuer stress | `LOOKTHROUGH-001` | User selected 2026-11-11. First slice committed on `feat/etf-look-through` and rebased onto `main` 2026-11-17; PR open, not merged or deployed: local dated snapshot import, `/api/exposure`, Analytics LOOK-THROUGH panel (stacked source bars, user-chosen layout B) and what-if on reconciled totals; synthetic fixtures only, no provider. Live issuer data and the Kestrel tool remain open. |
| In-chat stock price charts, source-bound to historical close prices | `CHATCHART-001` | Verified; included in the merge containing CHARTSHIP-001; deployment and live-provider chart qualification pending |
| Smarter visual selection, richer charts, exposure views and safe navigation/alert drafts | `UIUPGRADE-001` | Integrated on main at `dc8a7c9`; demo activated; broader model qualification remains pending |
| Demo defaults to supported Intelligent UI views | `DEMOPARITY-001` | Integrated on main at `dc8a7c9`; explicit settings and model gates remain effective |
| Council research reliability and source grounding ([FEAT-002](features/FEAT-002-investment-council-lenses.md)) | `COUNCILQUALITY-001` | TSM ADR fixes and figure-check limit exemption merged locally into `main` at `11f7f04` (2026-11-02). 2026-11-03: frozen TSM replay, spot-FX EPS/revenue conversion and nine more filing-sourced ADR ratios merged locally. Still open: live web-search use and the equal-source Balanced comparison. Earlier on feature/council-quality: subject routing, evidence planning, denominator checks, traces and honest partial status implemented; TSM ADR audit fixes (Council web search, 6-K/20-F retrieval, ADR-ratio valuation, stage causes, full-page scroll) on `fix/council-tsm-audit`, not merged; primary fund evidence, qualitative verification and equal-source evaluation remain pending |

| Kestrel research tools: SEC Form 4 insider trades, FINRA short interest, technical indicators, DCF / reverse DCF, peer comparison; Council evidence items (key-less part of [FEAT-011](features/FEAT-011-agent-data-sources.md)) | `KESTRELTOOLS-001` | On branch `feat/kestrel-research-tools`, uncommitted; self-review fixes and independent review (approve; docs conditions met, nits fixed) 2026-11-08; agent 249/249, isolated live chat + two Councils US$0.214; spec FR-3.13/FR-3.14 |
| [FEAT-014](features/FEAT-014-quant-engine.md) Quant Engine: Python portfolio replay and metrics, `backtest_portfolio` tool, total-return history | `QUANT-001` | Milestones 1 to 4 (engine, saved runs, robustness checks, Quant Lab) merged into `main` on GitHub in PR #3 on 2026-11-11, after three independent reviews; not deployed to the personal app. Later milestones in the spec are not selected |
| [FEAT-014](features/FEAT-014-process-panels.md) Process panels: policy guardrails, thesis tracker, decision log view | `GUARDRAILS-001` | In progress on `feat/policy-guardrails`, not merged; guardrails implemented and browser-checked on fictional data |
| [FEAT-014](features/FEAT-014-process-panels.md) Process panels: policy guardrails, thesis tracker, decision log view | `GUARDRAILS-001` | Implemented on `feat/policy-guardrails`, not merged or deployed; all three panels unit-tested and browser-checked on fictional data |
| [FEAT-015](features/FEAT-015-process-tools.md) Process tools: returns after costs, valuation column, cost-basis review, event radar, weekly digest (on demand), backtester with paper promotion; clean-up audit | `PROCESSTOOLS-001` | Implemented on `feat/process-tools` (stacked on FEAT-014), not merged or deployed; unit-tested and browser-checked on fictional data; Kestrel integration deferred |
| [FEAT-012](features/FEAT-012-paper-trading.md) Paper trading mode: REAL/PAPER books, Alpaca paper orders, trade desk with chart, Kestrel paper orders with ask/auto approval and optional limits | `PAPER-001` | On branch `feat/paper-trading`, not merged; verified offline against a fake broker and live on 2026-11-03 with the user's Alpaca paper keys (Kestrel ticket, user approval, real fill) |
| [FEAT-010](features/FEAT-010-market-discover.md) Market Discover: movers and earnings among holdings + watchlist, US market movers (Yahoo screens), US IPO calendar (Nasdaq) | `DISCOVER-001` | Merged locally into `main` at `cefd2ff` (commits `5727d97`, `67cf0b0`); not pushed or deployed; live run 2026-10-31 recorded in the spec; defaults await owner review; SG/HK and licensed providers deferred |
| [FEAT-009](features/FEAT-009-kestrel-terminal-redesign.md) Kestrel terminal redesign: panel states, light mode, start screen, conversation, council Cards / Chain of thought | `KESTRELUX-001` | Merged on GitHub in PR #1; local integration into the council-quality checkout in progress |

## Council delivered — 2026-10-29

[FEAT-002](features/FEAT-002-investment-council-lenses.md) / `MULTIAGENT-001`: merged locally in `d06cabf` and activated in personal FinSight. The actual agent advertises council enabled, DeepSeek Flash is available, and all30 manifest assets match the rebuilt checkout. Current verification:262 browser checks and3 real-backend council checks passed; one existing live-fixture check skipped. Also216 unit,130 agent plus secret scan, typechecks and build consistency passed. Generic installations remain default off. Council uses DeepSeek Flash with thinking off; no investment-performance advantage is established. No remote push in this release.

## Context routing enhancement — 2026-10-29

`CONTEXT-001` / [FEAT-002](features/FEAT-002-investment-council-lenses.md): implemented locally in `4e1aa3b`; isolated PR1 preview uses its backend fix. Explicit question subjects drive verified instrument/quote retrieval before specialists. Chart context stays optional, references and comparisons are supported, and ambiguity/outages cannot silently substitute another company. Verified145 agent + secret scan,216 app unit tests, typechecks and4 real-backend browser tests. PR1 remains unmerged; broader `COUNCILQUALITY-001` stays open.

## Deferred proposals

| Spec | Proposal | Execution relationship | Gate |
|---|---|---|---|
| [FEAT-001](features/FEAT-001-ibkr-mcp-integration.md) | IBKR MCP integration and live sync | Deferred architecture captured alongside `MULTIAGENT-001`; distinct from CSV import | Explicit user selection and verified design |
| [FEAT-028](features/FEAT-028-ibkr-flex-sync.md) | IBKR Flex Query sync: fetch trades, dividends and balances with a read-only Flex token, preview and confirm through the FEAT-008 import, match by IBKR execution ID | Reuses FEAT-008; feeds FEAT-021; covers the read-only sync part of FEAT-001. Do not copy Sure's AGPL client | Explicit selection. Synthetic XML and a fake Flex server first; real account is a separate owner action |
| [FEAT-011](features/FEAT-011-agent-data-sources.md) | Agent data sources: insider/13F/congress/short interest, news, fundamentals cross-check, GDELT, EDGAR MCP servers (no sentiment) | None yet; feeds the paper-trading agent | Explicit user selection |
| [FEAT-016](features/FEAT-016-evidence-bound-memory.md) | Evidence-bound Kestrel memory and session handoff | Assessment and proposal only; reconcile feature numbering across branches | Explicit user selection, agent spec reconciliation and verified design |
| [FEAT-019](features/FEAT-019-thesis-change-review.md) | On-demand thesis change review with filing evidence and a saved baseline | Extends the thesis tracker and event radar | Explicit selection. Integrated workflow depends on the process panels |
| [FEAT-021](features/FEAT-021-broker-statement-reconciliation.md) | Read-only IBKR statement comparison for position and cash differences | Builds on FEAT-008 | Explicit selection. Start with synthetic statements and matching cutoffs |
| [FEAT-022](features/FEAT-022-historical-stress-replay.md) | Replay a fixed portfolio and a Sandbox draft through the same historical window | Builds on FEAT-020 and existing history retrieval | Explicit selection. Start with one USD account and frozen synthetic prices |
| [FEAT-023](features/FEAT-023-portfolio-checkpoints.md) | Save and compare portfolio snapshots to explain changes in cash, holdings and weights | Uses account snapshots | Explicit selection. Start with one account and native currency |
| [FEAT-024](features/FEAT-024-kestrel-image-optimization.md) | Resize and recompress chat images once at upload; vision brains get the small copy, the original is kept | From the [agent capability evaluation](architecture/agent-capability-eval.md) (criteria 13, 15). Large images likely fail on Claude brains (not reproduced) | Explicit selection. Recommended first of the agent gaps. Paid checks need approval |
| [SPEC FR-5](../agent/docs/SPEC.md) | Durable background task queue: leases, per-step checkpoints, resume and cancel | Specified in the agent SPEC, never built. From the [agent capability evaluation](architecture/agent-capability-eval.md) (criterion 3) | Only together with background or scheduled tasks (SPEC §15 L2 triggers). Needed by FEAT-026 release 2 |
| [FEAT-025](features/FEAT-025-kestrel-done-check.md) | Done check: before answering, check the draft against the question and the evidence, fill one gap or name what is missing, and label the answer Complete / Partial / Couldn't verify | Brings the Council's readiness idea to ordinary chat | Explicit selection. Cheapest of the agent improvements; no new data or permissions |
| [FEAT-026](features/FEAT-026-watches-and-news-alerts.md) | Watches the user saves: earnings ahead, new filings, valuation thresholds, sell-condition checks and major-news alerts, notifying once per event with evidence. Never trades or changes records | Release 1 extends FinSight alerts. Release 2 needs `GUARDRAILS-001` and SPEC FR-5. Release 3 needs a FEAT-011 news source | Explicit selection. Start with release 1 (code-checked, no model cost) |
| [FEAT-027](features/FEAT-027-modern-web-platform-ui.md) | Use built-in browser features for the UI: native `<dialog>` and popovers instead of the custom modal focus code, colour scheme tied to light/dark mode, standard scrollbars, CSP. Also fixes VWAP, pivots and the volume profile resetting at the browser's midnight instead of the exchange's | From a 2026-11-16 audit against Chrome's Modern Web Guidance | Explicit selection. Decide the browser support policy first. Release 1 (day-boundary fix) is a correctness fix and comes first |

Agent capability evaluation, 2026-11-15: Kestrel was checked against a 31-item agent-framework checklist (22 built, 4 partial, 2 missing, 3 not needed). Results, reasons and a learning guide to how the agent is built are in [agent-capability-eval.md](architecture/agent-capability-eval.md). FEAT-024 and the SPEC FR-5 row came from it; FEAT-025 and FEAT-026 came from the follow-up discussion about goals and acting on the user's behalf.

---

## 🧊 Ideas & Icebox (Brainstorming)

Exploratory concepts under review; requires an RFC/spec before moving to the Backlog.

| ID | Concept | Description |
| :--- | :--- | :--- |
| **IDEA-001** | Portfolio PDF Memo Export | One-click export of portfolio state, thesis reviews, and Kestrel notes as a clean PDF memo. |
| **IDEA-002** | Look-Through ETF Exposure | Expanded in [FEAT-018](features/FEAT-018-etf-look-through.md). |
| **IDEA-003** | Multi-Broker Aggregation | Extending the MCP Client architecture to support Alpaca and Webull alongside IBKR. |
| **IDEA-004** | Voice Input for Kestrel | Web Speech API integration in the composer for dictating research prompts. |

---

## Integrated milestones (deployment tracked separately)

| ID | Feature | Completion Date | Evidence / Release |
| :--- | :--- | :--- | :--- |
| **AUDITFIX-001** | Research validation, SEC pacing and [paper approval recovery](features/FEAT-012-paper-trading.md) | 2026-11-12 | Integrated from `5bd0629`. Verified with app and agent tests, Chromium and a fake broker. |
| **SANDBOX-001** | [Portfolio Sandbox (FEAT-020)](features/FEAT-020-portfolio-sandbox.md) | 2026-11-11 | Merged into local `main` at `3ae8879` with verified preview and override validation (`449d717`, `55bb9b4`). Deployment pending. |
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


## Context routing delivered in isolated preview — 2026-10-29

`CONTEXT-001`: code4e1aa3b/docs861e937 in feature/investment-council; preview8004 uses PR1 UI9cd2414 plus this backend. Explicit question companies override optional chart context; names/comparisons, matching quotes and reference/ambiguity handling verified.145 agent + secret scan,216 unit,typechecks/build64 and4 real-backend browser tests pass. Live AMD/TSM synthetic check passed routing at ledgerUS$0.011918256. No PR merge/push or personal deployment. Preserve separate observability edits and reconcile before integration. COUNCILQUALITY-001 remains open. Workspace evidence: harness/runs/20261029T085519Z-CONTEXT-001-eee356cb/REPORT.md.


### Council answer quality and depth — recorded2026-10-29

`COUNCILQUALITY-001` remains priority1/open. User-requested detailed issue capture
adds AMD-DEPTH-01: correct company routing still yielded quote-only analysis,
no specialist research, unsupported trend/valuation claims, prose arithmetic,
repeated specialist contributions and an overconfident completion label.
Acceptance requires actual bounded evidence collection, useful supported
business/valuation/risk/portfolio detail and separate research-readiness states.
The existing workspace council quality contract holds evidence and regressions;
this is backlog capture, not another implementation or release claim.
