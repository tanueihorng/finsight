# Kestrel agent: capability evaluation

Evaluated 2026-11-15 against `main` at `0ba2672`. The criteria come from a
checklist of common agent-framework features that the owner shared. Each one
is scored against the actual code, not the spec.

**Verdicts:** **Have** (built and tested) · **Partial** (part of it, or built
for one path) · **Missing, build** (worth adding) · **Not needed** (doesn't fit
a single-user, local agent).

## Summary

| Verdict | Count | Criteria |
|---|---|---|
| Have | 22 | 1, 2, 4, 5, 6, 7, 8, 10, 11, 14, 16, 19, 20, 22, 23, 24, 25, 26, 27, 29, 30, 31 |
| Partial | 4 | 3, 9, 12, 21 |
| Missing, build | 2 | 13, 15 (one fix: images) |
| Not needed | 3 | 17, 18, 28 |

Numbers follow the order of the original list. The list named "hallucinated
tool rejection" twice; it is scored once (criterion 31), so there are 31
criteria. The sections below group them by topic.

**The one gap worth building now is image handling** (criteria 13 and 15).
Uploads allow images up to 15 MB, and they go to the model unchanged, re-read
and re-encoded on every step of a turn. Anthropic's API limits each image to
about 5 MB, so a large screenshot or phone photo will likely fail on the
Claude brains. This is from reading the code and was not reproduced. Fix:
shrink and recompress images once, at upload.

Everything else either exists or isn't needed for how Kestrel is used.
Durable background execution (3) becomes necessary only if you build the
scheduled or background tasks in SPEC FR-5 and §15.

## How an agent is built: the six layers

Kestrel is a useful map for learning, because each layer is a separate file.

1. **The loop** (`agent/src/chat/engine.ts`, `runApi`). Send messages to the
   model. If it asks for tools, run them, add the results, and ask again. Stop
   when it answers without tool calls or a limit is hit.
2. **The model adapter** (`agent/src/brains/`). One interface (`ApiBrain.step`)
   hides each provider's format. Adding a model means adding a manifest.
3. **The tools** (`agent/src/tools/registry.ts`). Each tool is a name, a
   description, an input schema and a handler. The schema is checked before
   the handler runs.
4. **Memory and context** (`agent/src/store/db.ts`, `agent/src/chat/context.ts`).
   Everything is saved to SQLite, and each call picks what fits in the
   model's context window.
5. **Safety and limits** (spending reservations, step, time and cost caps, book
   pinning, untrusted-data labels). This is what makes an agent trustworthy
   rather than merely capable.
6. **Delivery** (`agent/src/api/server.ts`, `agent/src/chat/bus.ts`,
   `agent/src/mcp/server.ts`). Stream progress to the UI and expose the tools
   to other clients.

Most framework checklists, including this one, are layers 1–3 and 6. Kestrel's
own strength is layer 5, which those checklists mostly leave out.

## The 31 criteria

### Core loop

**1. Agentic loop orchestration — Have.** The model-and-tools cycle, repeated
until there's an answer.
Kestrel: `runApi` in `chat/engine.ts`. Each step is saved, traced and costed.
When a limit is near, it sends a "write your final answer" nudge and offers no
tools, so the user always gets an answer rather than a cut-off.

**2. Provider abstraction — Have.** One way to call many model vendors.
Kestrel: `brains/types.ts` defines `ApiBrain` (step by step) and `CliBrain`
(the whole turn, for Claude Code). Four transports: OpenAI-compatible
(DeepSeek), OpenAI Responses, Anthropic and the Claude Code CLI. Messages are
stored in a neutral block format and converted per provider.

**3. Durable execution — Partial (not needed yet).** A run survives a crash
and resumes where it stopped.
Kestrel: every step is written to SQLite as it completes, but a turn running
during a crash is marked `interrupted` at startup (`recoverTurns`), not
resumed. For a chat reply, asking again is fine. The spec's background task
queue (FR-5: leases, checkpoints, resume) is specified but not built. Build it
only together with background or scheduled tasks.

**4. Tool call validation — Have.** Check the model's tool arguments before
running anything.
Kestrel: `ToolRegistry.execute` parses every call with its zod schema. Bad
arguments return `TOOL_INPUT_INVALID` with a readable explanation, so the
model can correct itself. The same schema generates the provider and MCP
definitions, so they can't drift apart.

**5. Stop conditions — Have.** Clear rules for when the loop ends.
Kestrel: no tool calls in the reply; the step, time or cost limit (followed by
one final answer); not enough budget left for the next call (it stops without
paying); the user pressing stop; output truncated or refused (saved as a
notice); and `render_ui` marked complete.

**6. Multi-agent turn coordination — Have.** Several agents working on one
request without colliding.
Kestrel: the Council (`chat/council.ts`). Specialists give independent first
assessments, two at a time, then one challenge round, then a chair decides.
One shared budget reserves money before each call. Only one Council or API
reply runs at a time.

**7. Durable thread state — Have.** Conversations survive restarts and
concurrent edits.
Kestrel: SQLite in WAL mode with threads, messages, turns and events. Each
thread has a version number to catch conflicting edits, sends carry an
idempotency key so a double-click doesn't run twice, and only one reply runs
per chat.

**8. Message hierarchy — Have.** A clear order of authority: system rules over
user over tool output.
Kestrel: the system prompt is split into a stable part and a dated part, so
providers can cache the stable part. Analytical lenses are labelled
"subordinate to core rules". Attachments and web pages are labelled as
untrusted data, not instructions. Internal notices are turned into short,
labelled text before the model sees them.

**9. Sub-agents — Partial (fine as is).** The main agent hands a piece of work
to a helper agent with its own context. (The checklist's "sub-prompts" most
likely means this.)
Kestrel: Council specialists are sub-agents, each with its own context and
evidence. Ordinary chat has no "delegate this" tool. Not worth adding: a
single research turn rarely needs it, and it multiplies cost.

**10. Context window management — Have.** Fit the right history into the
model's limit.
Kestrel: `chat/context.ts` counts bytes (deliberately overestimating tokens),
keeps whole user turns together, never separates a tool call from its result,
and drops the oldest turns first with a note telling the model to use
`search_memory`. Documents get half the budget, shared between them. It
doesn't summarise old turns; dropping and searching is simpler and loses
nothing.

**20. Work block groupings — Have.** Grouping a turn's text, tool calls and
results so they can be shown and replayed together. (This is how "work block
groupings" is read here.)
Kestrel: messages belong to a turn, trace steps are numbered per step and
call, and the panel shows each turn's tools as a group.

### Tools

**11. Parallel tool execution — Have.** Several tool calls from one model reply
run at once.
Kestrel: up to 4 at once (`mapLimit` in `engine.ts`); the Council evidence
planner has its own limit.

**24. Serial tool execution — Have, where it matters.** Steps that change state
run one at a time.
Kestrel: tools that only read data run in parallel. The one tool that can act,
`paper_place_order`, is made safe in FinSight: every Kestrel order passes one
gate, one at a time (`inKestrelGate` in `lib/paper.ts`), so two parallel
orders can't both pass the daily and position limits. Portfolio writes go
through `withLock`. If you add another tool that changes something, give it
the same kind of gate.

**31. Hallucinated tool rejection — Have.** The model calls a tool that
doesn't exist.
Kestrel: it gets an `UNKNOWN_TOOL` error back, logged as `tool.denied`, and
can recover. `render_ui` is limited to three attempts per turn, so a model
can't loop on a broken view.

**25. Retry with backoff — Have.** Retry failed calls with growing waits.
Kestrel: `stepWithRetry` retries only rate-limit and provider errors, up to 3
times, waiting 0.5 s, 1 s, 2 s and so on (at most 8 s) with random spread.
It never retries after text has reached the screen or after a stop, and a
refused request costs nothing. The Council never retries a call whose outcome
is uncertain.

**23. Graceful execution abort — Have.** Stop mid-run cleanly.
Kestrel: each turn has an abort signal. Stop saves any text already written
with "Stopped by you", makes no further paid calls, and marks the turn
`stopped`. Shutdown stops running turns and waits up to 3 s. A REAL/PAPER
switch mid-reply aborts it rather than mixing the two books.

### Files and images

**14. Large file chunking — Have.** Documents too big for the context.
Kestrel: PDF, DOCX and text are converted to text locally. A preview goes into
context, with a note giving the exact offset to continue from.
`read_attachment` pages through the rest and `search_attachments` finds
passages. There are no embeddings, by design (SPEC §14).

**13. Memory-efficient image processing — Missing, build.** Don't hold or
resend large images more than needed.
Kestrel: `imageBase64` reads the whole file and encodes it again on every step
of a turn, because history is rebuilt each step. A turn with 8 steps sends the
same image 8 times.

**15. Automatic image optimization — Missing, build.** Shrink images to what
the model can use.
Kestrel: none. Images up to 15 MB are sent as they are. Models scale large
images down anyway, so the extra size only costs time and money and risks
rejection (Anthropic allows about 5 MB per image). **Fix for 13 and 15:** at
upload, resize to at most about 1,600 px on the long side and recompress, keep
the original on disk, and send the small copy.

### Discovery, packaging and clients

**16. Zero-config discovery — Have.** New parts work just by being added.
Kestrel: brains are found from `plugins/brains/*/manifest.json` and switched
on when their key or CLI is present. Skills are found from folders with a
`SKILL.md`. Tools register themselves.

**21. Agent packaging and distribution — Partial (fine as is).** Ship and
install agents or their parts.
Kestrel: skills install from a GitHub folder (`agent skills add`), brains are
manifest plugins, and the tools are available to other agents over MCP. The
agent itself ships with FinSight. A package registry isn't needed for one user.

**19. Framework-agnostic client — Have.** Any client can use the agent.
Kestrel: a plain HTTP and SSE API (FinSight's web UI is just one client) and
an MCP server (`agent mcp`) that Claude Code, Codex or any MCP client can use.

**26. Unified response format — Have.** One shape for results and errors.
Kestrel: every provider's reply becomes the same `StepResult` blocks. Every
tool error is `{ "error": { "code", "message" } }`. Errors carry `AgentError`
codes such as `BUDGET_EXCEEDED` and `BOOK_CHANGED`. Long tool results are cut
at 30,000 characters with a note on how to narrow the request.

### Hooks

**17. Message lifecycle hooks — Not needed.** Let outside code run before and
after each message.
**18. Tool lifecycle hooks — Not needed.** Same, before and after each tool
call.
Kestrel: these points exist, but as fixed code rather than pluggable hooks.
Before a tool runs: validation, the `render_ui` limit and book pinning. After:
result shaping, labelling the book, the audit entry and the trace step.
Frameworks offer hooks because their users can't edit the framework. You own
this code, so editing the code is simpler and easier to test.

### Streaming, telemetry and isolation

**27. HTTP streaming for long execution — Have.** Show progress while a long
run continues.
Kestrel: Server-Sent Events. Each event is saved before it is sent, so a
client that reconnects with `Last-Event-ID` gets what it missed. Text is
batched every 40 ms so there isn't one database write per token.

**28. Persistent WebSocket connections — Not needed.** Two-way live
connection.
Kestrel: progress only flows from server to browser; requests and stop are
normal POSTs. SSE already covers this, works through ordinary HTTP and
replays after a reconnect. WebSockets would add complexity for nothing.

**12. Real-time log streaming — Partial (fine as is).** Watch logs live.
Kestrel: live turn events (tool started and finished, retries, budget
warnings) stream over SSE. The detailed audit log is read in pages through
`/v1/logs` and `agent logs <turnId>`, not streamed. That suits a single user.

**29. Execution telemetry — Have.** Measure what each run did and cost.
Kestrel: an audit log of turn, model, tool and HTTP events, linked by turn and
request IDs; a trace step per model and tool call; a cost ledger with
reservations; and the usage dashboard. No OpenTelemetry, which only pays off
with many services.

**30. Namespace isolation — Have.** Keep separate workspaces from leaking
into each other.
Kestrel: events and locks are per chat; one turn reads one REAL or PAPER book
and is stopped if it changes; the demo refuses to start if its folder overlaps
personal data; MCP calls are logged with their client name; and tool names
must match a strict pattern.

**22. Sub-agent chaining — Have.** One agent's output feeds the next.
Kestrel: the Council's assessment → challenge → chair sequence. Each stage's
output is validated, gets one repair attempt, and the chair sees only cited
evidence.

## Recommended work

| Priority | Work | Why |
|---|---|---|
| 1 | Resize and recompress images at upload; send the small copy ([FEAT-024](../features/FEAT-024-kestrel-image-optimization.md)) | Likely failures on Claude brains with large images; repeated cost on every step |
| 2 | A test that sends a large image through each vision brain (in FEAT-024's acceptance) | Confirms the fix; nothing covers this path today |
| Later | Durable task queue (SPEC FR-5) | Only together with background or scheduled tasks |

Both are registered as deferred proposals in [BACKLOG.md](../BACKLOG.md).

Nothing else on the checklist is worth building for Kestrel today.
