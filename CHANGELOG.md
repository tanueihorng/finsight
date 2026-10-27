# Changelog

This records integrated changes with actual Git references. A merge does not certify deployment.
The earlier draft with unverified release numbers is preserved in `docs/archive/20261027-CHANGELOG-draft.md`.

## Unreleased

- `UIUPGRADE-001`: natural view-selection guidance, source-bound exposure charts, snapshot chart range and pointer controls, and user-invoked navigation or unsaved alert drafts. Live model qualification remains limited to the recorded synthetic sample.
- `DEMOPARITY-001`: demo defaults supported Intelligent UI on, respecting explicit overrides and model capability gates; the demo data guard also resolves symlinked paths before any reset.

- In-chat price charts (`CHATCHART-001`): source-bound historical closes, keyboard date inspection, saved snapshots and privacy hiding. Synthetic tests cover source binding and the chart interface. Live provider chart compliance and deployment remain separate.

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
- Implementation commit `22b0436`; main modal fix `5f2dda1`. Final integration verification passed:213 unit,111 agent + secret scan,253 browser;1 existing live-fixture skip. No service restart or portfolio mutation.

- Integration review repair: delayed modal autofocus now preserves existing keyboard focus. Deterministic paused-clock regression reproduces the old failure; accessibility/modal/cache upgrade checks cover the repair. Integrated static bundle uses shellv51 because main already used50 for the earlier modal hotfix.


### Merged feature delivery — 2026-10-27

- Five selected features and both UI fixes merged into main at `d9ee5c8`; source review additionally repaired a delayed-autofocus race (`a9da04e`) with a paused-clock regression.
- Final checks:213 unit tests,111 agent tests + secret scan,253 browser tests;1 existing live UI qualification fixture skipped. Build consistency60 files.44 focused modal/accessibility/SW checks also pass.
- Shellv51 separates the merged bundle from the earlier modal-only cache. Services have not been restarted; no portfolio data, credentials or accepted policy changed.


### Build reproducibility correction — 2026-10-27

- Preserve dependency symlink identities in esbuild so canonical and worktree builds produce the same chunk hashes and source maps. Both checkout checks pass60 files;61 artifacts including index are byte-identical.
- Shellv52 isolates the normalized bundle. The corrected bundle passes213 unit,111 agent + secret scan,253 browser checks, with1 existing live-fixture skip.
- Corrects the post-merge build mismatch in the first publication; no application/backend behavior or financial records changed by this build correction.
