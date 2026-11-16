# FEAT-025 · Kestrel done check

Deferred proposal, 2026-11-15 SGT. No execution task assigned.
Source: owner discussion after the [agent capability evaluation](../architecture/agent-capability-eval.md).

## Problem

A chat reply ends when the model stops calling tools or reaches a limit.
Nothing compares the answer with the question, so a reply can skip part of
the question, or rest on a tool that failed, and still read as complete. The
Council already grades itself (research readiness in
`agent/src/chat/council-readiness.ts`); ordinary chat does not.

## Outcome

Before Kestrel answers a research question, it checks the draft against the
question and the evidence it gathered. It then either fills the gap once or
says plainly what is missing. The user sees whether the answer is complete.

## First release

- **Code checks first (free).** Before the final answer, code lists:
  companies or tickers named in the question that no tool returned data for;
  tool calls that failed and were not retried; and limits that were hit. These
  go to the model as facts, not as suggestions.
- **One model check (small, capped).** The model splits the question into its
  parts and marks each one answered, partly answered or not answered, citing
  the tool results it used. The output is schema-validated, with one repair
  attempt, like Council assessments.
- **At most one extra research round.** If a part is unanswered and the turn
  and daily budgets allow, Kestrel gets one more round with tools. Otherwise
  it answers and names the gaps.
- **Shown to the user.** Each research answer carries a label: *Complete*,
  *Partial: <what is missing>* or *Couldn't verify*. The check's result is
  saved in the turn's trace.
- **Skipped when pointless:** greetings, replies that used no tools, and
  presentation-only `render_ui` answers. Council turns keep their own readiness.

## Acceptance

- Fixture questions with a deliberately failing tool, a missing ticker, and
  two-part questions where one part has no data: each gets the correct label,
  and none is marked *Complete*.
- A fully answered fixture is marked *Complete* without an extra round.
- The extra round never exceeds the turn or daily cap; stopping the reply
  stops the check.
- Cost per checked turn is measured on a small live sample, within a stated
  cap and with the owner's approval.

## Not in scope

Grading investment quality or correctness of opinions; changing the Council's
readiness logic.
