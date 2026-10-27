# Kestrel Intelligent UI

Status: Phase 1 implementation in `feature/kestrel-verified-views`, 2026-10-26.
The owner requested implementation after review. The first release is deliberately
limited to verified stat cards and tables. The global operator setting defaults **off for personal installations** and **on in demo mode**, unless explicitly overridden. DeepSeek Flash/Pro and GPT-6 Luna are enabled following live synthetic qualification; GPT-6 Sol remains disabled after the Responses transport qualification; see UI-QUALIFICATION.md. Source-bound price charts are implemented in CHATCHART-001; other later phases remain a roadmap.

## What Phase 1 does

An API brain may request a fixed stat grid, sortable table, exposure breakdown or historical closing-price chart when several figures
or rows would be clearer than prose. The model chooses source fields and layout;
the server supplies every displayed value, label, currency, data time, scope,
limitation and plain text equivalent. No model-supplied HTML, CSS, JS, numbers,
formulas, labels, links or actions are accepted. No portfolio state changes.

```
completed facts (earlier model step)
  -> per-turn source ledger
  -> render_ui request with field bindings
  -> strict schema + field/semantic allowlist + byte/attempt caps
  -> server-generated canonical snapshot in SQLite ui_views
  -> ui.render event -> lazy React renderer
reload -> accepted ui_views rows, never raw tool_call arguments
```

A view is a **historical snapshot**, not live data or a claim that a market quote
is current. Native price/cash currencies and reporting currencies stay distinct.
Changing the dashboard's base currency does not reinterpret a saved view.

## Request contract

One Zod declaration in `src/ui/schema.ts`, types re-exported by `shared/ui.ts`.
Both the agent and browser validate the same canonical schema. Zod is a root build
dev dependency and a separate agent runtime dependency, pinned to the same version.
The build explicitly resolves the root copy, giving identical output whether the
agent dependencies are installed or absent. No install is needed to serve the
committed browser output. The renderer and validator load lazily.

```json
{
  "version": 1,
  "components": [
    {
      "id": "overview",
      "kind": "stat_grid",
      "sourceCallId": "ui_source_1",
      "fields": ["/summary/netWorth", "/summary/cash"]
    },
    {
      "id": "holdings",
      "kind": "table",
      "sourceCallId": "ui_source_1",
      "rowsPath": "/positions",
      "fields": ["/symbol", "/marketValue", "/weightPct"],
      "limit": 10
    }
  ]
}
```

For this example `ui_source_1` must be the uiSource.ref printed inside a successful
get_portfolio result from an earlier completed step of this turn. Provider-generated
protocol call IDs are not a reliable model-visible reference. The engine adds the
short ref only after all calls in a batch finish and maps it to the true tool ID
for canonical provenance. A model cannot invent an accepted reference. Same-batch calls cannot refer to each other's results.
Failed, truncated/non-JSON, foreign-turn and unsupported tool results are rejected.
No filesystem paths or web-document values can become facts through this tool.

Supported sources:

| Tool | Stats | Table rows |
|---|---|---|
| get_portfolio | /summary/netWorth, securitiesValue, cash, totalCost, unrealized, realized, positions | /positions, /cash |
| query_positions | /totals/marketValue, weightPct, unrealized | /rows |
| get_cash | /totalBase | /cash |
| get_exposures | /total | /rows |
| get_accounts | none | /accounts |
| get_quote | none | /quotes |

Each path in the stats column abbreviates siblings under the same prefix.
Table fields are relative pointers such as `/symbol` and `/marketValue`.
The field allowlist in `tools/ui.ts` also pins the label and unit semantics.
Missing values show `—`, never an invented zero. Nonfinite figures are rejected.
Tiny nonzero quotes/quantities retain visible precision. Reported account identity
takes precedence over request context; where a tool does not report it, the view
explicitly labels the requested account rather than claiming a reported identity.
Net worth includes the existing liabilities caveat; exposures retain the no ETF
look-through caveat; filtered position totals explicitly cover returned rows only.

Optional complete:true ends the turn after a successfully accepted UI-only batch
when the model says the view and preceding explanation fully answer the request.
It never skips repair after rejection or ends a mixed research batch early. This
avoids an unnecessary final model call; ordinary text answers are unchanged.

Caps: four components; eight stats/columns each; fifty rows per table (default
twenty); unique component ids and fields; 24 KiB serialized UTF-8 request and
canonical spec; three attempts per turn, including invalid requests. Large views
must narrow their request. The generated text equivalent is included in the tool
result and therefore costs context tokens; repairs are ordinary billable model
steps, not free. No history compaction is claimed: existing whole-turn context
selection and overflow safeguards remain in force, including provider state.

## Price charts (CHATCHART-001)

For an explicit chart request, the model calls `get_history` with `includeBars:true` and `chartOnly:true`, then references that completed result in a `price_chart` component. The server validates the source, symbol, currency and ordered finite prices; the model supplies no data values. At most 150 actual bars are evenly sampled across the requested range, with the count disclosed, and retained as a snapshot. The chart provides keyboard-operable date inspection and a text equivalent. Values are historical close prices, not a live quote. A missing currency, insufficient data, malformed data or unavailable source produces a rejection and prose fallback. Existing UI gates and privacy behavior apply. Synthetic end-to-end tests do not establish live model-provider chart compliance.

## View selection, exposure, and safe actions (UIUPGRADE-001)

Natural requests such as “show me NVDA” are guided toward a price chart, while explicit text-only, table and card requests take precedence. Opt-in natural selection evaluation uses `NATURAL_UI_CASES` with synthetic data; a small run is not model qualification. Exposure charts bind group names, currency, values and weights exclusively to a completed `get_exposures` result. They state the all-account scope and sector ETF look-through limitation. The existing sortable table supports comparisons.

Chart range buttons filter only the existing saved snapshot; they do not fetch more data. Pointer movement and the keyboard slider inspect source points. Buttons can open the full chart, open the ledger, or prepare an editable price alert using the selected historical close. Preparing does not submit an alert or request notification permission. An already open alert draft is not overwritten. The user must review and press SET to save an alert; no financial action is created by `render_ui`.

## Persistence and delivery

Migration 2 adds `ui_views`, unique on `(turn_id, call_id)`. Only a validated,
server-bound snapshot is inserted. Raw assistant tool calls remain in append-only
history for provider replay/audit but are never interpreted as accepted views.
Deleting a thread deletes its snapshots. Existing database migration backups apply.

The engine emits `ui.render {turnId, callId, view}` after successful tool completion.
The authenticated thread GET returns `uiViews` separately, avoiding the existing
400-character tool-result truncation. Replayed events replace the corresponding
part by call id. A model change does not reconstruct or reinterpret saved snapshots.
Lock closes the active event stream; unlock opens one fresh stream from the last
accepted event id. Events from a closed/replaced stream, another chat or while
locked are ignored. This intentionally replaces the previous keep-stream-open
behavior, preserving history while preventing event loss on unlock.

## Browser behavior

Fixed React components escape every string. Tables have captions, column headers,
keyboard-operable sorting, numeric comparisons, aria-sort, and a labeled focusable
scroll region. Sorting affects displayed rows only, with counts shown explicitly.
Cards wrap in narrow panels; tables scroll locally when needed.

UNPEEK removes the entire snapshot, including table text and the text equivalent,
from the rendered DOM, and redacts its copied text. Formatting is generated from
source currencies rather than mutable dashboard settings. Copy answer includes
the server-generated text equivalent. Unknown versions/kinds produce a safe
unavailable notice; a component render error uses its validated text equivalent.
Chunk load errors are contained by an individual panel boundary.

This does not change the pre-existing privacy behavior of ordinary prose or tool
trace logs. View specs are sensitive chat data, stored in the existing private
agent home and audited under the existing logging policy.

## Gates and qualification

Both a global operator setting (`uiViews: true` in the private agent config, or
`KESTREL_UI=1`) and the selected API brain's `capabilities.ui: true` are required.
An explicit KESTREL_UI environment value overrides the config; 0 disables it.
DeepSeek Flash/Pro and GPT-6 Luna have capabilities.ui enabled after qualification; all other
bundled manifests remain disabled. Direct tool invocation also checks the gate.
MCP/CLI does not advertise the tool because it lacks the thread/turn UI bridge.
Turning the environment flag off prevents new views; accepted historical snapshots
remain readable. No adapter, model default, reasoning mode or price changes.

Deterministic tests cover binding/formatting, rejection, caps, gates, same-batch
races, old-turn references, restart and API reload, deletion, duplicate replay,
privacy/copy, keyboard sorting, narrow panels, unsupported views and accessibility.
They use synthetic tools and mock brains, not paid providers or personal holdings.

Before enabling another brain, run a separately authorized live evaluation against
fixed synthetic cases: appropriate view use and text-only restraint, tool/schema
validity (including repair), source fidelity, clarity, extra latency and extra cost.
Keep the original proposal's qualification targets: 85% appropriate use, 90%
restraint, 90% first-try validity and 98% after repair, 100% bound figure fidelity,
4/5 clarity, median additional latency <=25% and cost <=30%. The explicit opt-in scripts/qualify-ui.ts runs 40 synthetic cases, five paired
text baselines and a follow-up using the six eligible facts tools plus render_ui.
It uses existing credentials and records estimated token cost in the normal ledger,
with day/turn caps intact. No paid LLM judge or private holdings are used.
UI-QUALIFICATION.md records the actual qualified models and remaining blockers.

## Later phases

1. Checklist reading aids; explicitly illustrative calculators
   with a real expression parser and an enforceable portfolio-calculation boundary.
   Read-only navigation or composer-fill actions require explicit contracts.
2. Progressive argument streaming with unverified previews kept distinct from final
   accepted facts. No badge/action can become trusted on partial JSON alone.
3. CLI/MCP bridge, provider-aware history compaction and production qualification.
4. Enable qualified brains by default after the owner reviews live evidence.

The review rejected the original ideas of raw-call reload, model-copied numbers
with merely valid refs, same-batch source access, calculator safety by matching
input defaults, and neutral-only compaction that bypasses Anthropic provider state.
Those are not implementation shortcuts for later phases.
