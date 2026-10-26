# Kestrel Intelligent UI — design plan

Status: proposal (2026-10-26). Nothing here is built yet.
Adopting it changes `docs/SPEC.md` (a new tool, new panel elements under UI-4, and a
new eval suite), so it needs the owner's approval first. See §12.
Inspiration: OpenAI's Intelligent UI in ChatGPT (2026-10-07). It is a fixed library of
streamable components that the model arranges, plus a compiler that renders them
while the model is still generating. No public API exists, so this is our own design.

## 1. Goal and non-goals

**Goal.** Let Kestrel answer with small interactive views, such as stat tiles, tables,
charts, what-if calculators and checklists, when a visual is clearer than prose. Plain
text stays the default.

**Non-goals.**
- The model never writes HTML, CSS or JS. It picks components and fills in data.
- No component can change state: no trades, ledger edits, policy edits or alerts.
  Buttons can only ask a question or open a FinSight view.
- No new rendering surface outside the Kestrel panel in v1.

## 2. Architecture

```
model ──tool call──▶ render_ui(spec)          (agent/src/tools/ui.ts)
                       │ zod-validate + provenance check
                       ├─▶ tool result to model: { ok, uiId } (tiny)
                       └─▶ bus 'ui.render' { turnId, callId, spec }  ──▶ panel
panel: turns.ts adds a { kind: 'ui' } part; Chat.tsx renders it with
       web/src/features/kestrel/ui/<Component>.tsx
reload: stored tool_call blocks named render_ui are re-rendered from their args
```

Why a tool rather than a fenced block in the text:
- Every brain already supports tools (OpenAI-compatible, Anthropic, DeepSeek, and the
  CLI brain through MCP), so there's no per-provider parsing.
- The registry validates arguments with zod and returns `TOOL_INPUT_INVALID` with a
  readable error, so the model can repair the spec on the next step at no extra cost.
- The spec is stored as part of the existing `tool_call` block, so it needs **no
  store migration and no new `Block` type**. The tradeoff is that history replays the
  spec to the model. Section 8 caps its size.

Tool contract:

```ts
// agent/src/tools/ui.ts
{
  name: 'render_ui',
  description: 'Show an interactive view in the chat when a visual is clearer than text: '
    + 'stat tiles, a table, a chart, a what-if calculator or a checklist. Use plain text '
    + 'when a sentence or two is enough. Data must come from tool results in this turn; '
    + 'otherwise mark it illustration. Do not repeat the view\'s numbers in your prose.',
  input: UiSpec,
  handler: async (spec, ctx) => { checkProvenance(spec, ctx); return { ok: true, uiId }; },
}
```

The engine emits `ui.render` from the same place it emits `tool.finished`, and only
when the result is ok. The panel draws a `render_ui` call as the component, not as a
tool row. A failed call still shows as a normal tool row with the error.

## 3. Block schema (UiSpec v1)

Defined once in zod in `agent/src/tools/ui.ts`. The panel imports the inferred type from
`shared/`, so both sides agree on it, as with the S2 shared portfolio types.

```ts
const Provenance = z.object({
  status: z.enum(['fact', 'proposal', 'illustration']),  // drives the badge
  source: z.enum(['tool', 'user', 'model_estimate']),
  refs: z.array(z.string().max(80)).max(8).default([]), // tool callIds from THIS turn
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).strict();

const Action = z.discriminatedUnion('do', [
  z.object({ do: z.literal('ask'), label: z.string().max(40), prompt: z.string().max(300) }).strict(),
  z.object({ do: z.literal('open_view'), label: z.string().max(40),
             view: z.enum(['symbol', 'ledger', 'strategy', 'watchlist']),
             symbol: z.string().regex(/^[A-Z0-9.^=-]{1,15}$/).optional() }).strict(),
]);

const Base = {
  id: z.string().regex(/^[a-z0-9_-]{1,32}$/),
  title: z.string().max(80).optional(),
  note: z.string().max(400).optional(),        // rendered with the md() safe subset
  provenance: Provenance,
  actions: z.array(Action).max(3).default([]),
};

export const UiSpec = z.object({
  version: z.literal(1),
  title: z.string().max(80).optional(),
  fallback: z.string().min(1).max(2000),       // plain-text equivalent: MCP, copy, a11y, errors
  components: z.array(z.discriminatedUnion('kind', [StatGrid, Table, Chart, Calculator, Checklist])).min(1).max(4),
}).strict();
```

Number formats are shared by all components: `{ format: 'money' | 'pct' | 'num' | 'date', ccy?: ISO-4217 }`.
The panel formats them with the existing `web/src/ui` primitives (`Money`, `Pct`, `Num`), so
values follow the base currency and the UNPEEK blur.

## 4. The first five components

### 4.1 `stat_grid` — KPI tiles
```ts
{ kind: 'stat_grid', ...Base,
  items: [{ label: string≤40, value: number, format, ccy?, delta?: number, deltaFormat?, tone?: 'up'|'down'|'neutral' }] (1–8) }
```
Use for: portfolio snapshot, a position's P&L, FX exposure. Layout: 2–4 columns that
wrap. Delta arrows use `--up` / `--down`.

### 4.2 `table` — comparison or list
```ts
{ kind: 'table', ...Base,
  columns: [{ key: /^[a-z_]{1,24}$/, label: string≤30, format?, align?: 'left'|'right' }] (2–8),
  rows: Record<key, string≤120 | number | null>[] (1–50),
  sortable?: boolean, highlight?: { key, equals } }
```
Use for: peer comparisons, holdings slices, scenario grids. Numeric columns are
right-aligned (same rule as `md.ts` `isNum`). Sorting happens in the panel only.

### 4.3 `chart` — two sources
```ts
{ kind: 'chart', ...Base, source: 'finsight', symbol, range: '1mo'|'6mo'|'1y'|'5y', overlay?: 'sma50'|'sma200' }
{ kind: 'chart', ...Base, source: 'inline', type: 'line'|'bar'|'area',
  series: [{ name≤30, points: [t: string|number, v: number][] (≤500) }] (1–4), yFormat }
```
`source: 'finsight'` is preferred for prices. The **panel** fetches the bars from
FinSight and draws them with the existing chart scripts (`ChartHost`), so the model
can't invent price data. `inline` is for derived series, such as projected savings or
backtest equity, and needs `provenance.refs` pointing at the tool result it came from,
or `status: 'illustration'`.

### 4.4 `calculator` — what-if with sliders
```ts
{ kind: 'calculator', ...Base,
  inputs:  [{ id: /^[a-z][a-z0-9_]{0,15}$/, label≤40, min, max, step, default, format }] (1–6),
  outputs: [{ label≤40, expr: string≤200, format }] (1–6) }
```
Use for: generic what-ifs such as DCA or compounding projections, FX scenario impact,
or dividend income at an assumed yield. **Not** for position sizing, portfolio totals,
weights or exposure. Those come from `size_position`, `query_positions` and
`get_exposures` (SPEC C3, FR-4.10), shown with `stat_grid` or `table` and `refs`. The
handler rejects a calculator whose inputs have `default`s matching a
`size_position` result in the same turn. `expr` is a
tiny arithmetic language evaluated by **our own parser, never `eval`**:
numbers, input ids, `+ - * / ^ ( )`, and `min max abs round floor ceil pow sqrt log exp`.
The parser rejects anything else at validation time (agent side) and again at render
time (panel side). Every output shows its formula in a disclosure ("how is this
calculated?"). Calculators are **always** `status: 'illustration'` (the schema pins it),
with an "Illustrative — not advice" badge, because the arithmetic is the model's, not
FinSight's.

### 4.5 `checklist` — steps or timeline
```ts
{ kind: 'checklist', ...Base, mode: 'check'|'timeline',
  items: [{ title≤80, detail?≤300, at?: string≤24 }] (1–12) }
```
Use for: review procedures, earnings-week prep, "what to check before buying".
Ticked state is per viewer in `localStorage` (key `kestrel-ui:<uiId>:<i>`, wrapped in
try/catch). It is a reading aid only and never written to the agent.

## 5. Streaming

**Phase A (ship first): render when the step finishes.** Adapters only stream text
today (`onText`); tool-call arguments are collected and handed over when the model step
ends. The panel shows a skeleton card ("building view…") on `tool.started` for
`render_ui`, then swaps in the component on `ui.render`. This needs no adapter changes.

**Phase B: progressive rendering.**
1. Add `onToolDelta?(callId, name, argsDelta)` to `StepRequest` (`brains/types.ts`).
   - OpenAI-compatible adapter: forward `delta.tool_calls[].function.arguments` (it
     already collects them).
   - Anthropic adapter: forward `input_json_delta` events.
   - CLI brain: unsupported; it stays on Phase A.
2. For `render_ui` only, the engine emits `ui.partial { turnId, callId, json }` at most
   every 100 ms with the full buffer so far. Never sent for other tools.
3. The panel runs a **tolerant partial-JSON parser** (close open strings, arrays and
   objects) and validates **each component on its own** with the shared zod schema.
   Components that validate render right away; the rest stay as skeletons. Top-level
   `title` renders as soon as it closes.
4. `ui.render` (fully validated by the agent) replaces the partial view. If the final
   validation fails, the partial view is withdrawn and the tool row shows the error.

Put `components` early and `fallback` last in the schema so the visible parts stream
first. The prompt asks for `title` first.

## 6. Safety rules

1. **No markup from the model.** Every string renders as text. Only `note` passes
   through the existing `md()` safe subset (escape first, http(s) links only). No
   `href`, `src`, `style`, colour or class fields exist in the schema.
2. **Strict schema.** zod `.strict()` everywhere, hard length and count caps, total spec
   ≤ 24 KB (checked before parsing), at most 3 `render_ui` calls per turn.
3. **Provenance is checked, not trusted.** `status: 'fact'` needs `source: 'tool'` and
   `refs` that are callIds of successful tool results in the **same turn**
   (`ctx.turnId`). Otherwise the handler rejects it with a repair hint. Badges:
   Fact (with as-of date), Proposal, Illustration.
4. **Portfolio decisions policy.** Anything derived from holdings and implying an
   action is `proposal`. No component says "buy" or "sell" as an instruction, and there
   is no action type that executes anything. `open_view` is limited to four read-only
   views. `ask` puts the prompt in the composer and the user presses Send; it never
   auto-sends.
5. **Untrusted inputs.** Web pages and uploads can steer the model's spec just as they
   can steer its text. The rules above contain that: no links (except via `md` in
   notes), no actions with side effects, no hidden content.
6. **Calculator parser.** Recursive descent, ≤ 200 chars, depth ≤ 16, whitelist of
   functions and input ids. Non-finite results show "—". Fuzz-tested.
7. **Privacy.** Money values use `Money`, so UNPEEK blurs them like the dashboard. Specs
   are audited through the existing `model.response` / tool audit path.
8. **Graceful degradation.** Unknown `kind` or `version`, or a render error inside the
   component's `IslandBoundary`, shows `fallback` as text. MCP clients get only the
   tool result plus `fallback`.

## 7. Prompt guidance (system prompt addition, ~12 lines)

- When to use: comparisons of 3+ items, any time series, adjustable what-ifs, multi-step
  procedures, snapshot KPIs.
- When **not** to: a single number, yes/no, opinions, short explanations, anything
  answerable in two sentences.
- Fetch first, then render: call facts or strategy tools before `render_ui`, and
  reference their callIds. Position sizes, totals and weights are shown as returned by
  `size_position` / `query_positions` / `get_exposures`, never recomputed in a
  calculator.
- One view per answer is usual; at most 3. Keep prose short and don't restate the
  numbers shown in the view.
- Always include `fallback`.

Three short few-shot examples (stat_grid after `get_portfolio`, a calculator for a
DCA projection, a text-only answer). Following FR-7.7, the same guidance goes into
`agent/AGENTS.md` for MCP clients.

## 8. Context cost

Specs stay in history as `tool_call` args. To stop them crowding context
(`chat/context.ts` budgets by bytes):
- the 24 KB cap per spec;
- when replaying to the model, older turns' `render_ui` args are replaced by
  `{ uiId, kind list, fallback }`. This is done in `history()` at replay, and the stored
  copy stays complete for the panel.

## 9. Evaluation

**Deterministic (CI, `npm run verify`):**
- Schema tests: valid and invalid fixtures for each component, caps, `.strict()`
  rejections, provenance rules.
- Expression parser: unit tests plus property and fuzz tests (random tokens never throw
  or run code).
- Partial-JSON parser: every prefix of 50 fixture specs either parses to a valid
  subset or yields nothing, and never crashes.
- E2E (Playwright, mock brain emitting `render_ui`): each component renders, survives
  reload, axe has no serious or critical issues, it's keyboard-operable (sliders,
  sort, checkboxes), UNPEEK blurs money, a failed spec falls back to text, and `ask`
  fills the composer without sending.

**Behavioural (run per brain before enabling it):**

Run as a suite of the existing golden eval (SPEC §12.3), `agent eval --suite ui
[--brain]`. A fixed set of 40 prompts in `agent/test/eval/ui-prompts.json`: 25 where a view should
help (5 per component) and 15 where plain text is right. Each run records:

| Metric | Target to enable a brain |
|---|---|
| Appropriateness: used UI when expected / avoided it when not | ≥ 85% / ≥ 90% |
| First-try schema validity | ≥ 90% (after one repair ≥ 98%) |
| Provenance correctness: every `fact` number matches its referenced tool result (automated diff of values against tool JSON) | 100% |
| Fallback faithful to the view (LLM-judge, 1–5) | ≥ 4.0 avg |
| Clarity / usefulness / completeness (LLM-judge on a screenshot plus the spec, 1–5) | ≥ 4.0 avg |
| Extra latency vs a text-only answer (median) | ≤ +25% |
| Extra cost per answer (median) | ≤ +30% |

The judge sees the user prompt, the screenshot and the tool results, never the
expected answer. Spot-check 10 judgments by hand each run.

**In use:** count `render_ui` per turn, validation failures by error, fallback
renders, and whether users click actions or open the formula disclosure. Logged locally
via the existing audit log only.

## 10. Rollout

| Phase | Scope | Exit check |
|---|---|---|
| 1 | Schema, `render_ui` tool, `stat_grid` + `table`, fallback, render when the step finishes, behind `KESTREL_UI=1` | deterministic tests green; eval run on one brain |
| 2 | `chart` (finsight + inline), `calculator`, `checklist`, actions | eval targets met on Haiku and GPT-6 Luna |
| 3 | Streaming (Phase B) | partial-render E2E; no regressions in text streaming |
| 4 | Turn on by default per brain that meets the targets; others stay text-only | |

The flag is per brain in its manifest (`capabilities.ui: boolean`) so weak tool-callers
never see the tool. A brain that sets it must also pass a `render_ui` round trip added
to the brain contract test kit (FR-10.5).

## 11. Open questions

1. Should `ask` buttons auto-send after all? This plan says no (the user presses Send).
2. Should fully validated specs also be pinned to a "views" list per thread for
   revisiting? This plan defers it.
3. Should the CLI brain (Claude Code) get Phase A rendering through MCP, or stay
   text-only? It needs the MCP result path to carry `uiId` back to the panel.
4. Inline chart data from backtests: should `run_strategy` return a chart-ready series
   so the model doesn't copy numbers by hand?

## 12. Spec changes needed (owner approval)

| SPEC item | Change |
|---|---|
| §4 tools | Add `render_ui` (presentation only, no data access, no side effects). |
| UI-4 | Add "interactive views (render_ui components)" to the panel elements. |
| UI-8 | Extend: component specs are schema-validated; all strings render as text; only `note` uses the markdown subset. |
| C3 / FR-4.10 | Unchanged, and reinforced: calculators are illustration-only and may not size positions or compute portfolio figures. |
| FR-10.5 | Brain contract kit gains a `render_ui` round trip for brains with `capabilities.ui`. |
| §12.3 | Golden eval gains the `ui` suite and the targets in §9. |
