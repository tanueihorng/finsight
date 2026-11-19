# Changelog

This records integrated changes with actual Git references. A merge does not certify deployment.
The earlier draft with unverified release numbers is preserved in `docs/archive/20261027-CHANGELOG-draft.md`.

## Council research handoff correction — 2026-10-29

- Handle an oversized batch of allowed research requests without discarding an entire specialist assessment. Execute at most two tools, return explicit not-executed results for excess calls, and preserve gaps in the final assessment. Validate the whole batch against role permissions before executing any tool. Fixed provider-call and spending limits remain unchanged.

## Council personal release — 2026-10-29

- Investment council and lenses (`c387f52`): independent Business & Growth, Macro & Valuation and Portfolio Risk assessments, a challenge round and Kestrel chair. Read-only tools, durable cost reservations, cancellation, partial results and persisted replay.
- Chat presentation (`84c6c0c`): one council board with actual-event specialist/chair motion and a distinct synthesis, responsive layout, reduced-motion support and UNPEEK privacy. Standalone synthetic preview is separate.
- Merged locally at `d06cabf` and activated in personal FinSight on localhost:8001. Live agent advertises council enabled; all30 served manifest assets match the canonical build.262 browser checks plus3 real-backend council checks passed, with one existing live-fixture skip;216 unit and130 agent plus secret scan passed. Generic installations remain default off. Council qualification covers DeepSeek Flash with thinking off; the small synthetic evaluation did not establish superiority over Balanced or investment efficacy.

## Unreleased

- Verification loops and faster CI (VERIFY-001, branch `feat/verification-loops`; not merged). Based on the Claude Code team's and Lauren Tan's writing on agent verification.
  - Ledger property tests (`test/ledger-properties.test.ts`, 0.2 s): random dated buy/sell sequences, number spellings, CSV round trips, failed replace imports and unknown accounts. All six fail on the code before AUDITFIX-002 and pass on 21 seeds now.
  - Kestrel answer number check (FEAT-029, SPEC FR-1.15): figures in a chat answer that match no tool result or data snapshot are shown as unverified. No model call.
  - `npm run verify:diff` replays an API session against `origin/main` (1.2 s); `compare-servers.mjs` no longer reports macOS `/private` paths as differences.
  - `/verify` skill and feature map (`.claude/skills/verify/`) with `scripts/verify-server.ts`, an isolated seeded server that refuses the personal, default and demo ports. `REVIEW.md` lists diff-triggered review checks from SWEEP-002; AGENTS.md gains verification rules.
  - CI: quant Python pinned to 3.12 (numpy was compiled from source for 3 min each run); browser shards balanced by run time; seven browser tests use the fake clock instead of 16–31 s real waits, with the same failures caught under mutation.
  - Agent tests ignore provider keys in the developer's shell.
- Ledger and import integrity fixes from the SWEEP-002 audit (AUDITFIX-002, branch `fix/ledger-import-integrity`; not merged).
  - A replacement import is all or nothing. If any row fails, the account is restored as it was and the error names the failed rows. An additive import still keeps the good rows.
  - A dated sale draws only on shares bought by its date, with one day of slack, and is costed from those lots. A sale needing later purchases is rejected. Fully sold lots are removed, so the ledger can't edit or delete a buy that was sold.
  - Sale prices must be finite and nonnegative, and buys reject infinite quantities or prices.
  - CSV and IBKR position imports read numbers whole: thousands separators (`1,234` was 1), scientific notation (`1e3` was 13), and currency marks. Anything else drops the row instead of salvaging digits.
  - A named account that doesn't exist returns `404 Unknown account` instead of another account's positions, transactions, cash or dividends. `index.html` now reads the error body of its early requests so a removed saved account can't hold a connection open. Service-worker shell is `v62`.
  - Verified: 12 new regression tests from the audit's examples; 364 app tests, typecheck, web build check, and 305 agent tests with secret scan pass. Browser suite: 306 passed, 1 skipped (the fixture-dependent UI qualification test).
- Chart VWAP, pivots and the per-session volume profile now start each day in the exchange's time zone instead of the browser's (`62b4c89`, on `feat/kestrel-research-tools`, PR #4; not merged). Part of [FEAT-027](docs/features/FEAT-027-modern-web-platform-ui.md) release 1.
  - The bug: in Singapore, the US session (22:30 to 05:00 SGT) crosses local midnight. VWAP restarted at 11:00 ET and each afternoon was joined to the next morning. Live AAPL 5-minute data over 5 days gave 6 VWAP sessions for 5 trading days.
  - The fix: history meta now carries the exchange time zone as `timeZone`. If the feed doesn't name one, the chart uses UTC.
  - Verified:
    - New indicator tests cover the Singapore split, daylight saving, Asia/Kolkata and SGX.
    - Typecheck, 278 unit tests (run with `TZ=Asia/Singapore`), 275 agent tests with secret scan, and the web build check pass.
    - On a live test instance in SGT, the chart's VWAP reset only at 09:30 ET.
    - On the same live AAPL data, pivot levels changed and session profiles started only at 09:30 ET, giving 5 profiles for 5 trading days.
    - Browser suite: 294 passed, 2 failed, 1 skipped. Neither failure came from this fix.
      - The `390x844-light` detail-panel baseline had been missed when `50f0f9b` re-captured the others. It is re-captured in `b8c7378`, and all four visual tests pass twice in a row.
      - C3 "net worth breakdown" timed out once. It did not fail again in 26 later runs: 20 on its own, 1 with the A–C specs, and 5 replays of the exact 26 files that ran before it. It normally takes about 1 s. During the failing run, a second FinSight server and browser-pane chart work were running on the same machine. No code change was made because no cause was found.
      - Full browser suite rerun at `20039d5` with nothing else running: 296 passed, 1 skipped (`UIQUAL`, needs `UI_QUAL_DIR`), 0 failed, in 9.5 min against 17.4 min for the loaded run. C3 took 0.9 s.

- `AUDITFIX-001` research and paper approval fixes (`5bd0629`, integrated 2026-11-12). SEC pacing uses elapsed time and supports cancellation. DCF refuses invalid share counts, stale cash flow and ambiguous capex signs. Form 4 retains each joint filer’s roles. Interrupted paper approvals reconcile the original order with Alpaca and stay unconfirmed when the broker cannot confirm it.

- `SANDBOX-001` Portfolio Sandbox ([FEAT-020](docs/features/FEAT-020-portfolio-sandbox.md)), merged into local `main` on 2026-11-11 (`449d717`, `55bb9b4`). Open it from Positions to preview ordered draft trades against a pinned account and currency. The comparison shows cash, fees and concentration, flags oversells and funding shortfalls, and validates incomplete price and cash overrides. Previewing leaves the portfolio and ledger untouched.

- `QUANT-001` Quant Engine and Quant Lab ([FEAT-014](docs/features/FEAT-014-quant-engine.md)), merged on GitHub in PR #3 on 2026-11-11; not deployed to the personal app.
  - Portfolio backtests replay in a sandboxed Python worker with cash, slots, costs, dividends from the adjusted close and a reconciled ledger (`88d2b28`). Runs are saved with their bars and data and code fingerprints, and can be reproduced exactly. Fixed robustness checks: time holdout, period consistency, universe halves, single-name removal, cost stress and a block bootstrap.
  - Quant Lab workbench with run, results, checks and compare views (`328b26e`).
  - Review fixes (`e193d8a`, `d980bb9`, `bf7fb0b`): checks are saved only when the run reproduces and the baseline matches, compare needs identical data and code, backtests use USD only, price-only fallback looks only at the test window, older weakly checked studies are hidden, and a dividend gap is told apart from no adjusted close.
  - Verified: 40 Python tests; the independent checks match a reference model and vectorbt on 1500 generated portfolios; mutation 517/527 with the 10 survivors reviewed; agent 302 with secret scan; browser suite 302 with one existing phone screenshot failure; a live public-price run reproduced exactly.
- `BOOKRACE-001`, from branch `fix/book-race-fanout` (`1f8beba`), merged into local `main` 2026-11-14; not pushed or deployed. Per-request book pinning in `server.ts` was already on `main` (`9f35500`); this branch adds the `withLock` book, alert-check pinning and the fan-out bounds.
  - **Book-switch race fixed:** each HTTP request, and the background alert check, now runs against the REAL/PAPER book chosen when it arrived, and `withLock` keeps the book a change was requested in. Before, switching the book while a buy awaited its quote or FX, or while its body was still being read, wrote REAL data into the PAPER book. That got past PAPER's read-only rule, and the undo step was split across both books.
  - **Bounded fan-out:** `/api/quote` and `/api/categories` de-duplicate their symbols and accept at most 200 (HTTP 400 beyond). `getQuotes` and `getCategories` keep at most 6 Yahoo requests in flight, as `/api/history/batch` already did.
  - Covered by regression tests in `test/bookrace.test.ts` and `test/fanout.test.ts`.
- `PROCESSTOOLS-001` ([FEAT-015](docs/features/FEAT-015-process-tools.md)), on branch `feat/process-tools` (includes `GUARDRAILS-001`), rebased onto `main` 2026-11-17; PR open, not merged or deployed. **Returns After Costs** (price/FX/realized/dividends/withholding; broker fees shown as unknown; fund expense ratios shown, not double-counted), **VS FAIR** positions column (price vs the thesis range, only when one exists), **Cost Basis Review** (reasoned flags, marks, weekly price-range check, SET COST through lots with undo), **Event Radar** (earnings/ex-div/FOMC with thesis and guardrail prompts), **Weekly Digest** (generated and saved only on request; no schedule or delivery) and **Backtester** (built-in engines with costs, out-of-sample split, buy-and-hold comparison; owner-recorded paper status with forward-only tracking; never orders, never "accepted"). New data files in the data dir: `cost-review.json`, `strategy-status.json`, `digests/`.

- `GUARDRAILS-001` ([FEAT-017](docs/features/FEAT-017-process-panels.md)), on branch `feat/policy-guardrails`; not merged, pushed or deployed. Three read-only process panels: **Policy Guardrails** (whole-book exposures against owner-entered limits, all unset by default, proposed unless marked accepted), **Thesis Tracker** (per-holding thesis per policy §6 with review dates and dated checks) and **Decision Log** (read-only view of DECISION_LOG.md separating decisions from executions). Data in `guardrails.json` / `theses.json` under the data dir; the log is never written.

- Council specialists that answer without researching but list missing evidence are asked once to search (`508444b`, merged locally; not pushed). Live TSM rerun 2026-11-03 on the demo: 7/7 stages, US$0.0833, 107 s. Macro searched unprompted and Growth searched after the follow-up (4 searches; the TSMC investor-relations page returned HTTP 403). No P/E was computed from the 2024 trailing data. The chair still gave no computed range because forward estimates conflicted across sources.

- `valuation_metrics` no longer computes P/E, earnings yield or price-to-sales from trailing figures that ended more than 18 months ago; the figures are still reported with a gap. Found in a live TSM Council run on 2026-11-02 (demo, 7/7 stages, US$0.0465): SEC data held only TSMC's FY2024 20-F, giving a P/E of 59.6 on 22-month-old EPS. The chair flagged it as stale. No specialist requested web search or other research tools in that run. Merged locally; not pushed.

- `COUNCILQUALITY-001` follow-ups, merged locally into `main` 2026-11-03; not pushed or deployed. A frozen TSM-ENTRY replay (demo turn of 2026-10-31, fictional portfolio) now runs in the agent tests: its false account-scope warnings are gone because a claim's scope covers its counterevidence and "proposed" marks a limit, while the real 12.54%/15.63% mixed-basis pairing is still caught. `valuation_metrics` converts foreign-currency EPS and revenue to USD at the spot rate from FinSight's quote path, reports the rate and marks EPS, P/E and earnings yield approximate (refused without a rate). ADR ratios added for BABA, NTES, TM, SONY, SHEL, INFY, UL, ARM and TCOM from their 20-F covers; dual-class PDD, BIDU and JD left out. Verified: 224 agent with secret scan, 267 unit, typecheck; browser suite not rerun (no web changes).

- Kestrel limits are user-editable (merged locally at `aa373b7`).
  - Click the "Today" spend in the chat list, or type `/limits`, to edit:
    - the daily cap and the per-reply and per-council cost ceilings
    - steps and time per reply
    - web searches and pages read per reply
    - council research calls and answer length
  - Changes save to the agent's `config.json` and apply from the next reply; Kestrel's own token cannot change them.
  - Higher defaults: US$0.25 per reply (was 0.05), US$5 per day (was 2), 25 steps (was 12), 300 s (was 120), 20 searches (was 10), 25 pages (was 15), 8 council research calls (was a fixed 4).
- The holdings ticker's buttons now have accessible names that include their visible text. Visual baselines were re-captured after the ticker moved the page by a sub-pixel.

- `PAPER-001` ([FEAT-012](docs/features/FEAT-012-paper-trading.md)), merged locally at `aa373b7`; not pushed.
  - A PAPER book next to the real one, switched on the lock screen or in the top bar. The real book is untouched.
  - Alpaca paper only: the user's own paper keys, and live keys are refused. The book mirrors Alpaca fills and updates live through `trade_updates` and SSE.
  - A trade desk with a chart linked to the order ticket, fills and open limit orders drawn on the chart, and positions, orders, history and Kestrel tabs.
  - Security review fixes (merged locally at `bc26969`): one order per approved ticket under double clicks; in ask mode Kestrel cancels only its own orders; Kestrel's orders are serialized so limits hold under concurrent calls; browser writes under `/api/` must be same-origin (another localhost port shares the cookie); news links limited to http(s); non-finite limit prices refused.
  - The desk also helps research before an order (merged locally at `bc26969`): a watchlist column with search, a Watch toggle, key stats (ranges, volume, market cap, P/E, earnings, dividend yield), a News tab, and two-way symbol linking with the terminal. All of it shows before keys are entered.
  - Kestrel can place paper orders through new tools. The user chooses ask-first or autonomous and sets optional limits.
  - Verified offline against a fake broker; a live run with real paper keys is pending.

- `COUNCILQUALITY-001` TSM ADR audit fixes, merged locally into `main` at `11f7f04` on 2026-11-02 (`1c5104e`, merge `125a1b5`); not pushed or deployed. The same merge exempts a percentage named as a limit, cap or threshold from the account-scope check (audit item 5) and fixes a date-dependent web fee-cap test. Verified: 267 unit, 219 agent, 291 browser checks passed with one existing skip. An isolated live TSM review completed 7/7 stages, cited the 2026-10-15 6-K results and guidance, and reported an ADR-basis market cap of about US$2.11tn; P/E was refused (TWD EPS); research stayed partial. Business and Macro Council specialists can use web search and page fetch within the existing search/fetch counts, with each request reserved in the Council turn and daily budgets; Risk cannot. Foreign private issuers are read through 6-K results releases and the latest 20-F instead of 8-Ks, with the form used recorded. `valuation_metrics` applies the ADR ratio (TSM: 5 ordinary shares per ADR) or refuses market cap and P/E with an explicit gap; mixed-currency multiples are refused. Stages that do not complete record their cause; budget refusals state the reservation, free amount and cap. The Risk card no longer says "Assessment missing" when only the challenge was refused. Full page opened with the terminal scrolled stays within the viewport and returns to the same scroll position. Spending caps are unchanged.

- `DISCOVER-001` ([FEAT-010](docs/features/FEAT-010-market-discover.md)), merged locally at `cefd2ff` (`5727d97`, `67cf0b0`); not pushed or deployed: Discover panel and read-only `GET /api/discover`. **Your symbols** ranks gainers and losers among held and watched symbols (regular session vs previous close), with exclusions, stale flags and exchange-local earnings dates. **US market** shows Yahoo's Day Gainers / Day Losers screens (top 25, Yahoo's criteria). **IPOs** shows Nasdaq's US IPO calendar, with tentative expected dates, deals priced in the last 14 days, and Nasdaq and SEC links. Both new sources are key-less, unofficial and US-only. A live run against real data is recorded in the spec.

- Personal Council upgrade, 2026-10-31: `a186117` adds a separate Council budget; `5bb31bf` handles a matching issuer name and ticker; `c3ce194` uses the model context bound. Activated from the retained `feature/council-quality` worktree. A live AMD review completed all seven stages, but research remains partial and qualitative support needs review; completion is not investment qualification. Details remain in the private workspace run packet.

- Council challenge packets preserve canonical tool data as structured JSON and include all specialist assessments and cited evidence. Optional Council-specific spending and output limits allow a fuller review without changing ordinary chat limits. Budget-refusal traces include reservation and available-budget details; live-provider research-quality confirmation remains pending.

- `COUNCILQUALITY-001`: isolated integration `53c6709` combines GitHub main `f215b4cd` with the local observability snapshot and council-quality work. Unavailable sources and unverified qualitative claims prevent a ready research status. Concurrent daily budget reservations wait for in-flight calls before refusing work. These changes are not deployed; the AMD turn-budget issue and full research qualification remain open.

- Council specialists may request four research tools in their single research batch (previously two); model output is capped at 2,000 tokens per call or the model maximum, whichever is lower. Up to four evidence-backed findings may be returned. Time and spending caps are unchanged.

- Council no longer has a global model-call-count cap, per user request. Fixed phases, one repair per phase, the existing time and spending caps, and research-tool bounds remain. Duplicate figure warnings across a specialist’s phases are displayed once.

- `KESTRELUX-001` ([FEAT-009](docs/features/FEAT-009-kestrel-terminal-redesign.md)), on `claude/chatbot-ui-concepts-b7a075`, not merged:
  - Colour tokens with dark mode pixel-unchanged, plus light mode (`data-mode`, ◐ top-bar button, APPEARANCE control, a darker light variant per accent, contrast-checked).
  - Kestrel full page (`⌘⇧/`), a capsule while a hidden run continues, and a busy ASK button and top-bar sweep.
  - Clickable briefing tiles, a tool log card, a streaming caret, and a full-page workspace column for views, alongside the Council toggle and reply settings from PR 2.
  - Council Cards and Chain of thought views on one UNPEEK-safe view model, with the switch saved and `⌘.` to toggle.
  - No agent or API change.

- Council review fixes: resolve and verify requested subjects before research; carry the selected lens and bounded conversation context; label portfolio weight bases and flag unresolved figure checks in the report and UI. Subject resolution adds a model call. Figure checks do not establish source entailment or full investment research readiness.

- Isolate the standalone and demo launchers in separate data directories and agent ports, and reject agent configurations that redirect them to another data directory. Show Kestrel's name and connection errors, and keep its chat rail available in the dock. These changes do not migrate existing data.

- `UIUPGRADE-001` (`dc8a7c9`): natural view-selection guidance, source-bound exposure charts, snapshot chart range and pointer controls, and user-invoked navigation or unsaved alert drafts. Live model qualification remains limited to the recorded synthetic sample.
- `DEMOPARITY-001` (`dc8a7c9`): demo defaults supported Intelligent UI on, respecting explicit overrides and model capability gates; the demo data guard also resolves symlinked paths before any reset.

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


### Council subject routing — 2026-10-29 (local preview)

- `4e1aa3b`: explicit companies in the question determine council research; names/tickers are verified through instrument lookup and matching quotes before specialists. Attached charts are optional context. Comparisons and saved subject references are supported; ambiguity and outages cannot substitute an unrelated chart.
-145 agent tests plus secret scan,216 app unit tests, typechecks and4 real-backend browser checks pass. Deployed to the isolated PR1 preview (UI9cd2414 + backend4e1aa3b); PR1 is unmerged and personal services are unchanged. Comprehensive council research quality remains open.
