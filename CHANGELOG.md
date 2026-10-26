# Changelog

This records integrated changes with actual Git references. A merge does not certify deployment.
The earlier draft with unverified release numbers is preserved in `docs/archive/20261027-CHANGELOG-draft.md`.

## Unreleased

- 2026-10-27: backlog marks FEAT-003/005/006/007/008 complete and verified in `feature/open-features`; 213 unit, 111 agent and 247 browser tests passed, with one existing live-fixture skip. Implementation committed in `22b0436`; user selected integration and push. Deployment remains separate. Evidence: workspace `harness/runs/20261026T171956Z-IBKRTRADES-001-3d89b74e/REPORT.md`.


- Documentation: add a navigation index, product/execution planning contract, selected feature links,
  current architecture routing and restored setup/API entrypoints. Preserve historical references.
- Clarify that deferred broker/council proposals grant no implementation, delegation or trade authority.

## Integrated on main — 2026-10-26

- Root agent instructions consolidated at `b8d6a01`.
- Thinking effort pill menu replaces the slider at `a73e6da`; the slider was integrated at `0221396`.
- Responses UI qualification update at `2d92e3d` (provider/effort qualifications have their own evidence).
- Briefing start screen at `0b6dc84`.

The five selected chat/import/transfer/trade-sheet/cache features have verification reports in an isolated
checkout (implementation `22b0436`) and are selected for integration. Their product specs are requirements, not a claim that these features have shipped.


### Modal layering correction — 2026-10-27

Setup and other application dialogs now stay above Kestrel and expanded charts while confirmations remain above them. Static cache shellv50. MODALLAYER-001 verified:40 browser tests on main,3 regressions on the feature checkout,build60 in both. User selected commit/merge/push; deployment remains separate.


### Five selected features and UI fixes — 2026-10-27

- Chat header/recent/slash/bulk deletion, history-preserving `/clear`, and separated date/delete controls.
- Atomic account transfers retain lot dates, cost and FX, paired ledger entries and undo; combined portfolio performance stays unchanged.
- IBKR stock/ETF fill preview, duplicate matching and stale-preview protection. Unsafe historical backfills and oversells fail explicitly.
- + ADD and setup manual entry use the trade sheet with symbol search, quote autofill, dated lots, account choice and undo.
- Stable system-prompt prefix and persisted nullable provider-cache counters. Synthetic DeepSeek cross-date reuse increased from0/825 to640/800 tokens; no guaranteed daily savings.
- Shared setup/application dialogs remain above Kestrel and expanded charts, below confirmations.
- Implementation commit `22b0436`; main modal fix `5f2dda1`. Candidate integration checks in progress. No service restart or portfolio mutation.

- Integration review repair: delayed modal autofocus now preserves existing keyboard focus. Deterministic paused-clock regression reproduces the old failure; accessibility/modal/cache upgrade checks cover the repair. Integrated static bundle uses shellv51 because main already used50 for the earlier modal hotfix.
