# Kestrel Intelligent UI

Status: Phase 1 implementation in `feature/kestrel-verified-views`, 2026-10-26.
The owner requested implementation after review. The first release is deliberately
limited to verified stat cards and tables. It remains **off by default** pending
live provider qualification. The rest of the original proposal remains a roadmap.

## What Phase 1 does

An API brain may request a fixed stat grid or sortable table when several figures
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
      "sourceCallId": "p1",
      "fields": ["/summary/netWorth", "/summary/cash"]
    },
    {
      "id": "holdings",
      "kind": "table",
      "sourceCallId": "p1",
      "rowsPath": "/positions",
      "fields": ["/symbol", "/marketValue", "/weightPct"],
      "limit": 10
    }
  ]
}
```

For this example `p1` must be a successful `get_portfolio` call from an earlier
completed step of this turn. Same-batch calls cannot refer to each other's results.
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

Caps: four components; eight stats/columns each; fifty rows per table (default
twenty); unique component ids and fields; 24 KiB serialized UTF-8 request and
canonical spec; three attempts per turn, including invalid requests. Large views
must narrow their request. The generated text equivalent is included in the tool
result and therefore costs context tokens; repairs are ordinary billable model
steps, not free. No history compaction is claimed: existing whole-turn context
selection and overflow safeguards remain in force, including provider state.

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

Both `KESTREL_UI=1` and the selected API brain's `capabilities.ui: true` are required.
All bundled manifests stay disabled. Direct tool invocation also checks the gate.
MCP/CLI does not advertise the tool because it lacks the thread/turn UI bridge.
Turning the environment flag off prevents new views; accepted historical snapshots
remain readable. No adapter, model default, reasoning mode or price changes.

Deterministic tests cover binding/formatting, rejection, caps, gates, same-batch
races, old-turn references, restart and API reload, deletion, duplicate replay,
privacy/copy, keyboard sorting, narrow panels, unsupported views and accessibility.
They use synthetic tools and mock brains, not paid providers or personal holdings.

Before enabling a real brain, run a separately authorized live evaluation against
fixed synthetic cases: appropriate view use and text-only restraint, tool/schema
validity (including repair), source fidelity, clarity, extra latency and extra cost.
Keep the original proposal's qualification targets: 85% appropriate use, 90%
restraint, 90% first-try validity and 98% after repair, 100% bound figure fidelity,
4/5 clarity, median additional latency <=25% and cost <=30%. No live qualification
or automated LLM-judge suite is included or claimed by this gated implementation.

## Later phases

1. Source-bound charts; checklist reading aids; explicitly illustrative calculators
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
