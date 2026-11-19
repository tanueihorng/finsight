# FEAT-029 · Kestrel answer number check

Selected 2026-11-19 SGT by the owner as part of the verification work (`VERIFY-001`). Implements the existing
rule SPEC FR-1.4 for ordinary chat as SPEC FR-1.15; the Council already checks its findings (`council-metrics.ts`).

## Problem

FR-1.4 says every number about the user's data or the market must come from a tool result, and FR-1.5 forbids
model arithmetic. For chat answers this was a prompt instruction only. Nothing checked it, so a figure the
model computed or misremembered read the same as one a tool returned.

## Outcome

After each API-brain chat turn, code checks the answer's figures against the evidence in the conversation:
tool results, context snapshots and the user's own messages. Figures that match nothing are listed in a
warning under the answer: "Number check: 2 of 9 figures in this answer match no tool result or data snapshot
(12.4%, S$4,500). Treat them as unverified." The answer is not changed and no model call is made.

## Rules

- **Checked:** percentages, decimals, amounts with a currency mark or scale (K, M, bn, million) and any number of
  100 or more. **Not checked:** small whole numbers (counts, list numbers, "6M"), years, dates and times, and
  percentages named as a limit, cap or target.
- **A match** is equality after the answer's own rounding, allowing sign and fraction-to-percent changes.
- **Evidence** is the whole conversation's tool results and snapshots, so follow-up answers can quote earlier
  results. Earlier assistant answers are not evidence.
- **Recorded:** `turn.numbers` in the audit log for every checked turn; an `answer.check` event and a saved
  notice when something is unmatched.
- **Not covered:** CLI brains (their tools run out of process and results are not stored) and Council turns
  (checked by `council-metrics.ts`).

## Relationship to FEAT-025

FEAT-025 (done check) asks whether the answer covers the question. This asks whether its numbers came from
tools. They are independent; FEAT-025 can use this result as one of its code checks.

## Acceptance

- An answer whose figures all come from tool results, including rounded ones (S$4.35K for 4350), shows no
  warning. Covered in `agent/test/engine.test.ts`.
- An answer with figures absent from all evidence lists exactly those figures. Covered in the same test.
- No extra model call, no change to the answer text, no new cost.
