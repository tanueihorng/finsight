# FEAT-026 · Watches, sell-condition checks and major-news alerts

Deferred proposal, 2026-11-15 SGT. No execution task assigned.
Source: owner discussion after the [agent capability evaluation](../architecture/agent-capability-eval.md).

## Problem

Kestrel's goals end with each reply. The owner wants goals that last: "tell
me if my sell conditions for TSM are met", "remind me before earnings", "tell
me about major news on what I hold". Today FinSight alerts cover price,
trendline and indicator levels only (checked every 60 seconds, with macOS
notifications). Nothing watches filings, earnings, valuation, thesis
conditions or news.

## Outcome

The user saves watches. FinSight and Kestrel check them on a schedule and
notify the user when something happens, with the evidence and its date.
Watches only notify: they never trade, change records or act on the result.

## Principles

- **The user creates every watch.** Kestrel may suggest one in chat; it is
  saved only when the user confirms it, like `propose_record_update`. Kestrel
  never writes its own watch list. (This follows the owner's rejection of
  agent-written memory.)
- **Code decides when it can.** Anything with a number or a date is checked
  by code. The model is used only for conditions that need reading, and its
  verdict is always "met", "not met" or "can't tell", with sources.
- **One notification per event.** Each event has a key (for example, a
  filing's accession number); it notifies once, as SPEC §15 specifies for
  triggers.
- **Costs are capped.** Scheduled model checks have their own daily budget,
  separate from chat, and stop when it is used up.

## Releases

**1. Code-checked watches (no model, no new data source).**
- Earnings within N days, for holdings and the watchlist.
- New SEC filing for a holding (8-K, 10-Q, 10-K, 6-K, 20-F, Form 4), using
  the existing EDGAR tools.
- Valuation or fundamental thresholds (for example, trailing P/E above X,
  revenue growth below Y), computed by the existing tools.
- A thesis re-check due date.
- Notifications reuse FinSight's desktop notification and add an in-app
  inbox listing what fired, when, and why. Quiet hours are respected.

**2. Sell-condition checks (model, scheduled).**
- Sell conditions come from the thesis tracker (`GUARDRAILS-001`) and
  FEAT-019 baselines, not a second store.
- When a new filing or earnings release lands for that holding, or on the
  user's chosen schedule, Kestrel checks each written condition against that
  evidence and reports "met", "not met" or "can't tell" with citations.
- "Met" notifies and links to the evidence. It recommends nothing.
- Needs a durable background runner (SPEC FR-5: queue, leases, checkpoints)
  so a check survives restarts and never runs twice.

**3. Major-news alerts.**
- Needs a news source first (FEAT-011 data sources), chosen for terms and
  reliability.
- "Major" is defined by rules, not sentiment (FEAT-011 excludes sentiment):
  material filing types, a price move above a set size on the same day as
  news, and the user's own keywords per holding (for example, "export
  controls" for TSM).
- One digest per day by default; the user can choose immediate alerts per
  holding.

## Acceptance

- Release 1: fixtures for each watch type fire exactly once per event, survive
  a restart, and respect quiet hours; deleting a watch stops it.
- Release 2: synthetic theses and filings produce the correct verdict for
  conditions that are met, not met and undecidable; a failed tool gives
  "can't tell", never "not met". Restarting mid-check does not duplicate a
  notification or a paid call. The daily budget stops checks when used.
- Release 3: replayed news fixtures fire only on rule matches, with source
  and date; duplicates of one story notify once.
- Live paid checks only with the owner's approval and a stated cap.

## Dependencies

- Release 1: none beyond the current FinSight alert loop and EDGAR tools.
- Release 2: `GUARDRAILS-001` (thesis tracker) merged; the SPEC FR-5 task
  queue; FEAT-019 is related.
- Release 3: a selected news source from FEAT-011.

## Not in scope

Trading, or changing records, because a watch fired; push notifications to a
phone (a later option); sentiment scoring.
