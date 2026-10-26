# Phase 1 live qualification — 2026-10-26

The owner requested all models. DeepSeek Flash and DeepSeek Pro passed and have
`capabilities.ui: true`. New installations still require the global operator gate:
`uiViews: true` in the private agent config, or `KESTREL_UI=1`. Explicit environment
0 disables it. The model picker adds “views” and the welcome offers “Show my
holdings as a table” only when both gates and model availability agree.

| Measure | Flash | Pro | Required |
|---|---:|---:|---:|
| Positive view use | 24/25 (96%) | 24/25 (96%) | >=85% |
| Short-answer restraint | 15/15 | 15/15 | >=90% |
| First-attempt validity | 23/24 (95.8%) | 24/24 | >=90% |
| Valid by one repair | 24/24 | 24/24 | >=98% |
| Accepted source bindings | all match | all match | 100% |
| Median additional latency | -27.2% | -13.8% | <=25% |
| Median additional token cost | -9.8% | +1.3% | <=30% |
| Follow-up after a completed view | pass | pass | pass |

The fixed suite has40 isolated synthetic prompts/model:25 where stats/tables
help,15 where prose is expected. Five representative prompts also run with UI off
for paired cost/latency. A normal follow-up tests provider history after a view
ends a turn without an extra model call. Source fidelity compares every canonical
accepted spec against its recorded source/tool request. Twelve representative
outputs were reviewed for metric/row coverage, units, source/time/limitations and
compactness. Author clarity review: at least4/5; not an independent blind judge.
Four actual model outputs (cards/table for each model) were rendered in the real
panel: keyboard sorting and axe serious/critical checks pass. The results are a
single local run, not a promise of production latency or universal UI use.

The eligible tool surface is the six Phase1 facts tools plus render_ui. No web,
private holdings, private records or real account data were sent. This tests the
presentation contract, not unrestricted research/tool selection or investing
accuracy. The same hard runtime binding rules still apply with the full tool menu.

Two real integration issues were fixed before passing qualification:

- Provider-assigned tool call IDs were not reliably visible to models. Eligible
  results now contain uiSource.ref; the server maps it back to the true call ID.
- A finished view incurred another model call. Optional complete:true ends only an
  accepted UI-only batch; failed views and mixed research batches still continue.

Other API models are **not qualified by this run**. Haiku, GPT-6 Luna and Sol
remain disabled until an operational provider connection and successful live
qualification are available. Local credential/account diagnostics stay outside
the public repository. Claude Code lacks the Phase1 MCP/CLI UI bridge.

The measurements use the production defaults at this revision. Changes to model
options, reasoning settings or adapters need their own compatibility checks;
these figures are not qualifications of every future effort setting.

Reproduce explicitly (normal tests never call providers):

```
node agent/scripts/qualify-ui.ts --live --models deepseek-flash,deepseek-pro --out /absolute/existing/packet
```

Omit --models to test all available API entries. --limit supports diagnostic smoke
runs; incomplete runs cannot qualify. Existing day and turn limits remain in force,
and provider-reported usage is charged to ui_qualification in the normal local
cost ledger. No keys or hidden provider reasoning are exported. Local evidence:
IUIQUAL-001 packet, optimized-eval results/screenshots and visual-proof.log.
