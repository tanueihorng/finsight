# Investment council: implementation and rollout

Selected by the user 2026-10-28; personal production activation authorized
2026-10-29 after review of the local implementation and synthetic pilot.
This is an explicit foreground workflow. Generic installations remain default
off; personal activation uses council=true. Qualification covers DeepSeek Flash
with thinking off. No investment-performance advantage has been established.
See the dated rollout record below; earlier proposal sections are historical.

## Modules

- `chat/council-contract.ts`: versioned lenses and validated assessment/evidence contracts.
- `chat/council.ts`: provider-neutral bounded orchestration; no database or UI imports.
- `chat/council-service.ts`: existing SQLite events/messages, durable cost reservations and traces.
- ChatEngine: feature admission, thread lock, deadline/stop, final conversational envelope.
- Frontend: existing lens picker/state plus CouncilActivity and replay reducers.

## Execution contract

API brains only; native paid search and CLI brains are rejected. Three initial
analysts (Business & Growth, Macro & Valuation, Portfolio Risk), concurrency two,
one challenge call per analyst and one separate chair. Up to two tool requests
and one follow-up model call per initial analyst: at most ten model calls total.
A turn must permit at least ten steps. No recursive delegation, automatic council
routing, retries, attachments or restart/resume. Text questions must state their
scope. Simple questions keep the normal single-agent route.

Growth/macro can read quotes, histories and SEC filings/financials; risk can read
exposures, positions, cash and policy. Paid web search/fetch are excluded in this
first implementation. Every tool is checked both in offered schemas and at
execution. Context is bounded at 60k serialized bytes; oversized packets fail
explicitly rather than silently dropping evidence. Core rules remain shared;
missing policy, valuations and sources remain gaps rather than assumed facts.

Initial assessments have separate histories, without peer conclusions. Later
roles may receive newly gathered evidence. The challenge round receives initial
findings; the chair receives both rounds. Structured validation establishes
shape and reference integrity, not factual truth or source entailment.

## Accounting and cancellation

Provider calls reserve conservative input/output cost before dispatch in both
turn and daily budgets. A quarter of the turn ceiling is held for synthesis.
Daily ledger reservations persist before dispatch and reconcile on known usage.
Unknown usage/failure retains the reserved amount (kind council-reserved), not a
claim of measured spend. No other API reply is admitted while a council runs;
a council is rejected while another turn runs. Budget caps may reject a model
whose maximum output cannot fit. These are conservative limits, not an invoice.

Cancellation aborts the full tree; late provider results cannot complete a run.
Persisted notices/events reconstruct child status by stable ID. On reload with
no active parent, formerly running children are labelled interrupted/stopped.
Automatic restart and duplicate paid-call replay are unsupported.

## Rollout gates still required

Mock/unit/integration and browser tests must pass. Before activation, evaluate
on identical synthetic evidence/questions against Balanced single-agent output,
checking unsupported claims, stale data, missing policy, shared sources and a
correct minority. Record accuracy, gaps, contradictions, clarity, latency and
measured costs. Define an explicit live-trial spending ceiling for approval.
A zero-provider mock test cannot establish investment usefulness.

Set council=true in isolated agent config or KESTREL_COUNCIL=1 only for deliberate
trial activation. Removing the setting disables new council/lens requests while
retaining historical labels and findings. No broker actions, portfolio writes,
policy acceptance or monitoring are added.

## Proposed bounded live trial (not authorized or executed)

Six synthetic cases: unsupported bullish claim; stale quote; missing accepted
policy; three analysts citing the same source; correct minority against a
misleading majority; portfolio overlap with a missing valuation input.

For each case hold the evidence/question fixed across Balanced, a relevant
single lens, a single-call simulated council, and the real council. Label the
simulated variant honestly. Proposed ceiling US$2 total, maximum US$0.05 per
review, using one configured API model. A preflight budget check must cover the
entire comparison; stop after two budget/admission failures rather than raising
limits. The evaluator and implementation author are the same unless separately
authorized; do not label the review independent or blind.

Hard gates: zero invented evidence IDs, zero unsupported material numeric
claims, no treating missing policy as accepted, no majority vote substituted for
evidence, and all six cases explicitly identify their planted material gap.
Compare each answer with the fixture's expected facts. Retain the council only
if it improves material gap/contradiction handling on at least two cases without
regressing on another hard gate. Record per-case latency and measured cost;
these six cases establish only a pilot result, not investment efficacy.

Production activation, a wider trial, extra providers or personal-data use
require a separate rollout decision after results are available.

## Production hardening — 2026-10-28

Production is the requested endpoint, not the earlier experimental slice. The
initial pilot's failure and absence of demonstrated superiority remain recorded
in the workspace LIVE-PILOT-RESULT.md; a rerun does not erase them. The second
reliability trial is recorded separately. Broader rollout remains subject to
review of the evidence, not a change of label.

Completed malformed output may receive one schema repair, within a hard maximum
of12 total dispatched calls and the existing time/cost caps. Refusal, truncation
and uncertain transport failures are never silently retried. Single JSON fences
are accepted; arbitrary surrounding prose is not scraped. Invalid IDs still fail.
Per-call output is bounded at1200 tokens without changing normal chat defaults.
Only DeepSeek Flash with thinking off is a live-tested council configuration;
other real models/efforts are rejected before mutation. Test-only injected mock
brains exercise lifecycle cases without credentials or provider traffic.

A separate Playwright configuration exercises the real API, ChatEngine and
SQLite store with a deterministic brain and disposable FinSight data. It covers
captured quote evidence, reload/replay, cancellation and failed-specialist partial
synthesis. It never uses the personal data directory or calls a provider.

## Council chat presentation — 2026-10-29

CouncilBoard groups all actual specialist phases within one conversation panel.
Active roles have distinct kinetic forms; connection traces and the chair's
synthesis state are driven by run events. Completed/queued roles do not loop
activity motion. Failed or missing phases remain explicit rather than acquiring
completion checkmarks. Motion pauses outside the viewport or in a hidden tab;
reduced-motion keeps the same readable states without animation.

The chair result presents validated claims, uncertainty, evidence gaps and
invalidation, with the complete original report/source references available in a
disclosure. UNPEEK removes findings from the DOM and copies a privacy placeholder
instead of the underlying report. Keyboard controls, narrow stacking and
WCAG2A/AA checks are exercised against the real API/engine with a test brain.

`node scripts/build-council-preview.mjs <output.html>` produces a standalone
synthetic state preview. Its scripted display states and illustrative costs are
not evidence of live model activity or investment usefulness. The production
chat consumes actual backend events. The preview is not a production entrypoint.

## Personal release decision — 2026-10-29

User requested the integrated council in their live personal FinSight app after
reviewing the motion preview and being told that the feature branch was not yet
merged or activated. Local merge, rebuild and personal enablement are authorized.
Source implementation: c387f52; motion/chat integration: 84c6c0c. The chat uses
real persisted activity events; the standalone preview remains synthetic.

The six-case reliability rerun completed 6/6. The earlier pilot completed 5/6
and did not demonstrate superiority to Balanced, which caught all six planted
gaps faster and more cheaply. Total prior manifest-priced synthetic evaluation
cost was US$0.108869796, with zero unknown usage reservations. These small,
same-author tests establish limited reliability evidence, not investment efficacy.

Council remains user-invoked via the Council button, /committee or /debate;
there is no automatic routing. Select DeepSeek Flash and thinking off. Existing
turn/day limits apply, and every provider call reserves its maximum estimated
cost before dispatch. Replies can take longer and cost more than a single reply.
Disable new runs by setting council=false and restarting the personal agent;
historical conversations remain readable.

### Activation verified

Merged locally into main at d06cabf. Personal FinSight on localhost:8001 and
Kestrel on loopback8100 started from the canonical checkout with council=true.
Health passed; the agent advertises council enabled and DeepSeek Flash available.
All30 served manifest assets match the canonical build; canonical and feature
checkout builds match all64 static files. Current full verification:262 browser
checks plus3 real-backend council checks passed, one existing live-fixture skip;
216 unit,130 agent plus secret scan, typechecks and build consistency passed.
Personal PIN and financial files and chat record counts were preserved. No new
paid provider call or personal synthetic conversation was created for activation.
Enter the existing PIN, open Kestrel, choose DeepSeek Flash with thinking off,
and use Council or /committee. The localhost8866 HTML remains a synthetic preview.

## Research batch handling correction — 2026-10-29

A user-requested live Chrome smoke exposed initial specialists failing when a
provider returned more than the permitted two tool calls in one batch. The
runtime now tells each role its one-batch/two-call budget, validates every
requested tool against the role allowlist before execution, executes at most
two calls, and returns explicit not-executed errors for excess allowed calls.
Every requested tool-call ID receives a protocol result. Skipped calls add no
evidence. The existing final assessment call must disclose missing research;
step, output, time and spending limits are unchanged. Forbidden calls still
fail the role, including forbidden calls beyond the execution cap.
