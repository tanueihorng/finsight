# FEAT-002: Investment Lenses & Council Mode

- **ID:** FEAT-002
- **Status:** Merged and verified; personal activation completed 2026-10-29; generic default off
- **Priority:** High
- **Related Tasks:** `MULTIAGENT-001`

> Draft requirements below are proposals, not accepted implementation or execution authority. Broker endpoints, authentication, routing and model behavior require verification when this work is explicitly selected. Current read-only rules remain in force.

---

## 1. Summary
Allow the user to evaluate investment ideas through diverse analytical perspectives without compromising safety guardrails. Implements two complementary modes:
1. **Single-Lens Mode:** Switchable analytical personas (Growth/VC, Speculative/Catalyst, Hedge Fund, Macro/Central Bank, Institutional Risk Officer).
2. **Investment Council Mode:** A multi-perspective debate skill (`/committee`) that automatically convenes 3 analysts (Growth, Macro, Risk) and a synthesis Chair in a structured report.

---

## 2. Requirements & Acceptance Criteria

### A. Architectural Guardrails
- [ ] Base system prompt rules remain **100% frozen** across all lenses: no LLM arithmetic, untrusted data wrapping, read-only boundaries, and SGD reporting.
- [ ] Lenses alter *research emphasis and valuation frameworks*, never user policy limits, accepted rules, or portfolio holdings.

### B. Single-Lens Mode
- [ ] Provide 5 core lenses:
  * **Balanced / CRO (Default):** Capital preservation, concentration check, downside stress, policy conformance.
  * **Growth / VC:** TAM expansion, unit economics, gross margin durability, product moats, secular tailwinds.
  * **Speculative / Catalyst:** Near-term catalysts, asymmetric risk/reward, dilution, strict invalidation points.
  * **Hedge Fund / Special Situations:** Variant perception, positioning/crowding, hedge viability, downside floor.
  * **Macro / Central Bank:** Monetary policy cycles, yield curve sensitivity, liquidity conditions, inflation impact.
- [ ] Toggleable via chat command (`/lens growth`) or an accessible UI dropdown.
- [ ] The active lens is recorded immutably with the turn in SQLite so past answers preserve historical context.

### C. Council Mode (The "Investment Committee" Pattern)
- [ ] Triggered via `/committee <symbol>` or `/debate <symbol>`.
- [ ] Generates a single, highly structured debate report:
  1. **Bull Case (Growth):** The secular upside and expansion thesis.
  2. **Macro View (Central Bank):** Rate sensitivity and economic cycle fit.
  3. **Risk Defense (Risk Officer):** Actual portfolio concentration impact, correlation with existing holdings, and invalidation triggers.
  4. **Chair Synthesis:** Clear trade-off matrix for the user as the final decision-maker.
- [ ] Fixed delegation budget (no infinite recursive multi-agent loops; aggregate token cost capped within turn limits).


## Implementation scope approved 2026-10-28

User approved three specialists (Business & Growth, Macro & Valuation, Portfolio
Risk), a separate chair, single lenses, bounded execution and synthetic testing
before live-trial approval. See [runtime and rollout contract](../../agent/docs/COUNCIL.md).
The earlier draft is retained above; this dated scope refines it. No forced bull
case, no automatic invocation and no claim of independent source confirmation.
Live comparative evaluation, model usefulness and production activation remain
unverified. No paid trials have been run for this implementation.

## Release decision — 2026-10-29

User authorized release into personal FinSight after review of the actual-event
chat integration and synthetic motion preview. Implemented in c387f52 and
84c6c0c; personal activation is tracked separately in the workspace release
packet. The earlier evaluation-pending statements above are historical. Live
reliability rerun completed 6/6 synthetic cases; the original 5/6 pilot and no
demonstrated superiority to Balanced remain limitations. DeepSeek Flash with
thinking off is the qualified council configuration. No automatic invocation,
trade authority or investment-performance claim is added.

Personal activation verified after local merge d06cabf: live council feature
flag and DeepSeek Flash availability checked, with30 served manifest assets
matching the canonical build.262 ordinary browser checks and3 real-backend
council checks passed (one existing live-fixture skip). See COUNCIL.md for scope.


### Context routing follow-up — 2026-10-29

`CONTEXT-001`, implementation `4e1aa3b`: a bounded, accounted intent step resolves
explicit company names/tickers and comparisons through market instrument search;
matching quotes are required before specialists. Chart context is optional.
Persisted scope supports clear follow-ups and replay; uncertain identity or
unavailable data produces clarification/gaps rather than chart substitution.
Verified145 agent checks,216 app unit checks, typechecks and4 real-backend browser
checks. Isolated PR1 preview receives the fix; no PR merge or personal deployment
is implied. Full financial consistency, mandatory primary research and source
entailment remain in COUNCILQUALITY-001.
## Research-quality follow-up — captured 2026-10-29

Execution:COUNCILQUALITY-001, priority1, ready to implement later. The original
MULTIAGENT-001 runtime/UI delivery remains recorded; execution success does not
certify research quality. A live response audit found mixed percentage
denominators, inconsistent fund-bucket interpretation, weak causal/liquidity
claims and insufficient issuer/macro evidence. This follow-up requires:

- Typed deterministic metrics with explicit denominator/currency/scope/as-of.
- Instrument-aware primary-source evidence collection within existing limits.
- Reconciled fund taxonomy and look-through with explicit unknown coverage.
- Claim-to-passage/metric checks and substantive specialist challenges.
- Separate execution and research-readiness states in chat and saved replay.
- Frozen synthetic regressions and comparison with Balanced on equal sources.

The investment workspace contains the detailed contract in
`harness/backlog/COUNCIL-RESEARCH-QUALITY.md` and private audit evidence. Generic
source/test fixtures must not copy personal snapshots. This is to-do capture,
not implementation, a completed fix, paid-evaluation approval or deployment.

### Subject/context precedence — refinement2026-10-29

COUNCILQUALITY-001 must resolve/persist research subjects from explicit user
company/ticker requests before using selected chart context. An AMD question
with a TSM chart must retrieve AMD evidence; “this stock” may resolve to the
chart when clear, comparisons preserve all subjects, and material ambiguity
requires clarification. Match returned instrument/issuer identifiers to the
resolved request and require bounded evidence retrieval/coverage checks. The
visible chart need not change. Prompt wording and the model merely reporting
missing AMD evidence are insufficient; add deterministic routing/coverage
regressions plus failed-source/cancellation/budget cases. Implementation pending.

### Preview chain audit — 2026-10-29

The recorded AMD and TSM preview chains exposed avoidable missing research,
unsupported inferences from a single quote or unrealized gain, repeated claims
in challenge rounds, and ambiguity over a securities-only position weight.
COUNCILQUALITY-001 must test actual evidence retrieval and instruction
fulfilment, source support across all stages, substantive challenges, conditional
entry frameworks versus personalized recommendations, and honest research status.
Compare Council with Balanced under equal source access; the earlier limited
pilot did not demonstrate superiority. The detailed regressions and evidence
are in the investment workspace council quality contract. Implementation pending.

### Trace observability — 2026-10-29

The user wants model and tool call traces that make council outputs diagnosable
and support iterative improvement. Extend COUNCILQUALITY-001 with correlated,
versioned role/phase/call traces, actual evidence and failures, usage and costs,
privacy-safe inspection and replay, and sanitized regression cases. The displayed
chain is reported structured output, not a guarantee of private model reasoning.
Trace availability alone does not establish answer quality. Implementation pending.


### Context routing slice delivered — 2026-10-29

CONTEXT-001 is verified in feature/investment-council (4e1aa3b; docs861e937) and isolated PR1 preview8004. Question subjects drive verified identity/quote retrieval; chart context stays optional. Scope/coverage persist; names, comparisons, references, wrong quotes and cancellation covered.145 agent,216 unit,4 real-backend browser checks pass. Live AMD with TSM attached resolved/fetched AMD. Broader financial consistency, primary research and source-entailment work stays open under COUNCILQUALITY-001. Main/personal integration must preserve and reconcile concurrent observability changes; no merge/push implied.


### Answer quality and analytical depth — recorded2026-10-29

User explicitly requested detailed capture of the remaining quality/depth issue.
COUNCILQUALITY-001 now includes regression AMD-DEPTH-01: after correct AMD
resolution with TSM attached, all phases complete using only a shared quote;
specialists skip available research, repeat price-range observations, derive
numbers in prose and make unsupported trend/valuation claims. “Review complete”
still overstates evidence readiness. Require bounded retrieval, substantive
business/valuation/risk/portfolio analysis, source-supported claims, deterministic
metrics, meaningful challenges and truthful research status/replay. Measure
answer depth and usefulness, not length. Detailed evidence and failure cases:
`harness/backlog/COUNCIL-RESEARCH-QUALITY.md`, “Post-routing AMD quality and depth”
in the investment workspace. Context routing is delivered; this quality fix
remains open alongside the separately tracked observability implementation.
