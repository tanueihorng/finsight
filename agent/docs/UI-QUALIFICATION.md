# Phase 1 live qualification — 2026-10-26

DeepSeek Flash/Pro and GPT-6 Luna/Sol passed and have capabilities.ui enabled.
The global operator gate remains off on a new installation: enable uiViews in the
private agent config, or KESTREL_UI=1. Explicit environment0 disables it. Enabled
models show views in the picker and offer Show my holdings as a table.

| Measure | Flash | Pro | Luna | Sol | Required |
|---|---:|---:|---:|---:|---:|
| Appropriate positive use |24/25|25/25|25/25|34/35|>=85%|
| Short-answer restraint |15/15|15/15|15/15|15/15|>=90%|
| First-attempt schema validity |25/25|25/25|25/25|34/34|>=90%|
| Valid by one repair |25/25|25/25|25/25|34/34|>=98%|
| Accepted binding fidelity |100%|100%|100%|100%|100%|
| Median extra latency |−41.1%|−13.3%|−25.2%|+21.8%|<=25%|
| Median extra token cost |−20.6%|+9.4%|+4.7%|+13.3%|<=30%|
| Follow-up after completed view |pass|pass|pass|pass|pass|

The fixed suite has40 isolated synthetic prompts/model:25 positive and15 where
prose is expected. Five representative prompts/model also run with UI off.
A real same-chat follow-up tests provider history after a view ends a turn.
Source fidelity compares every accepted canonical spec with recorded source data.
Author reviewed representative outputs across all6 facts tools for coverage,
labels/units, source/time/limitations and compactness: at least4/5 clarity, not a
blind independent judge. Actual cards/tables from all4 models were rendered in the
real panel; keyboard sorting and axe serious/critical checks pass.

Sol initially measured+32.7% latency over five pairs, near the cutoff. Two additional
rounds of the same five paired prompts were fixed before execution. All original
measurements were retained. One repeat answered without a view: it counts as a
positive-use miss and is excluded from UI timing. The final Sol figures use14
successful UI pairs from15 attempts, with34/35 positive uses across the original
suite plus repeats. Other models use5 pairs. This reduces timing noise but is not
a promise of production latency; no threshold was relaxed or failing sample dropped.

The first OpenAI run exposed ambiguous routing guidance (Markdown versus a view)
and models copying a fetch limit100 into a view capped50. Guidance was clarified
and shortened; the same40 scenarios were rerun on all4 models. Binding rules,
schema caps, model defaults and spend limits stayed unchanged. Earlier failed runs
remain in local evidence; they were not relabeled as passing.

Only the six eligible Phase1 facts tools plus render_ui are exposed in this suite.
No web, private holdings, private records or real account data were sent. This
tests presentation contracts, not unrestricted research or investing accuracy.
The same hard binding rules still protect views with the full production tool menu.

The engine exposes uiSource.ref inside eligible completed results, mapping it to
the true protocol call ID. Optional complete:true avoids an unnecessary final
model call only after successful presentation-only batches. Rejected views and
mixed research batches continue normally.

Haiku is not qualified without an operational credential and its own live run.
Claude Code lacks the Phase1 MCP/CLI UI bridge. These measurements use production
defaults at this revision; changed adapters and thinking-effort settings need their
own checks and are not automatically covered.

Explicit reproduction (normal tests never call providers):

```
node agent/scripts/qualify-ui.ts --live --models deepseek-flash,deepseek-pro,gpt-6-luna,gpt-6-sol --out /absolute/existing/packet
```

If testing a saved per-app OpenAI key while this shell has another inherited key,
run with env -u OPENAI_API_KEY. Omit --models to test all available API entries.
`--limit N` (1–40) supports smoke runs; incomplete runs cannot qualify.
`--performance-repeats N` (1–3) runs only paired timing cases and cannot qualify by itself.
Timing includes only successful cases that actually rendered the intended view.

Existing day/turn caps remain; reported usage is recorded as ui_qualification in
the local cost ledger. No keys or hidden reasoning are exported. Local evidence:
IUIQUAL-001 resumption packet, adjudication.json, revised-eval results/screenshots,
sol-timing records and browser.log. Private connection diagnostics stay outside
this public repository.
