# FEAT-017: Process panels (guardrails, theses, decisions)

Status: in progress on branch `feat/policy-guardrails` (worktree `finsight-wt/guardrails`), not merged · 2026-11-07
Execution task: `GUARDRAILS-001` (selected by the user 2026-11-07, items 1–3 of a ten-item build list).

## Intent

Connect the terminal to the owner's written investment process. Three read-mostly panels show where the
book stands against the owner's own rules, which theses are due for review, and which logged decisions
were never executed. None of them places, drafts or suggests an order.

## Boundaries

- The repo stays generic. Limits and theses persist in `FINSIGHT_DATA_DIR` (`guardrails.json`,
  `theses.json`, mode 0600). The decision log is read from the configured records directory
  (`RECORDS_DIR`, else `recordsDir` in `DATA_DIR/agent/config.json`, else `DATA_DIR/records`) and is never
  written by FinSight.
- FinSight never invents a limit or a thesis. Every limit kind starts **unset**; a saved limit is
  **proposed** unless the owner marks it **accepted**. Policy acceptance still happens in the owner's
  policy record; the label only reflects it.
- A breach, near reading or overdue review is a prompt to review, never a trade instruction.
- Figures are computed in code from `portfolioWithQuotes`; weights are of whole-book net worth (all
  accounts, cash included).

## 1. Policy guardrails (implemented)

- Kinds: largest single holding (same symbol across accounts counts once), named holding, any one
  foreign currency (positions plus cash), any one account, cash floor, cash ceiling.
- States: `unset`, `ok`, `near` (within 90% of a max, or within 1/0.9 of a floor), `breach`, `no-data`
  (net worth zero or negative). Observations show even when unset so a limit can be chosen.
- Disclosed limits: funds are not looked through; unquoted holdings use their stored price; one account
  means the per-account check has nothing to compare.
- API: `GET /api/guardrails?base=`, `POST /api/guardrails/limits {limits}` (validated: kind, 0–100 %,
  status `proposed|accepted`, symbol format, floor ≤ ceiling; unchanged entries keep `updatedAt`).
- Panel: `POLICY GUARDRAILS`, left column after Positions, hideable in ⚙ Layout; EDIT LIMITS editor.

## 2. Thesis tracker (implemented)

Per holding, following policy §6: role (core / tactical / unclassified), value mechanism, valuation
range, invalidation conditions (business / valuation / portfolio-fit; urgent or needs corroboration),
optional maximum intended weight, review interval and next review date, and dated checks
(`intact`, `weakened`, `broken`, `insufficient evidence`). Held symbols without a thesis are listed as
such; a missing thesis is not a reason to sell.

## 3. Decision log view (implemented)

Parses `DECISION_LOG.md` entries headed `## D-YYYYMMDD-NNN — title` (the template's placeholder id is
skipped) and shows date, id, title, the "User decision" and "Execution" text exactly as written, and the
raw entry on expansion. Tags are a coarse reading of the first words only: a decision starting "pending"
is pending, otherwise decided; an execution starting "none"/"unexecuted" is none. "Decided, not executed"
means exactly that pairing, so an entry that authorised research but left the investment decision
pending can still be flagged; the text beside it is authoritative. Duplicate ids and missing status
lines are listed as log issues. `GET /api/decisions` returns the file name, never its folder path.

API: `GET /api/theses?base=`, `POST /api/theses/save {thesis}`, `/api/theses/delete {symbol}`,
`/api/theses/check {symbol, check}` (verdict, optional note and past date; next review = check date +
interval).

## Verification

- `test/guardrails.test.ts` (6 tests): unset defaults, issuer de-duplication, currency incl. cash, near and
  floor logic, named holdings, no-data, validation, persistence.
- `test/theses.test.ts` (3): validation per policy §6, check history and next-review movement, report join
  (issuer de-duplication, overdue, valuation band only in matching currency, max weight, sold symbols).
- `test/decisions.test.ts` (2): template skipped, tags and flag, duplicate ids, missing lines, folder path
  not exposed.
- Browser check on an isolated scratch data dir with fictional holdings and a fictional log (port 8013):
  guardrail editor saves and shows 2 breach / 1 near; a thesis is written, validated, reviewed and shown
  over its max weight; the decision filter and entry expansion work.
- The owner's real log was parsed locally as a smoke test; its contents are not recorded in this repo.
