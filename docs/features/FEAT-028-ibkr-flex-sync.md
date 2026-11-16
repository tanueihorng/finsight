# FEAT-028 · IBKR Flex Query sync

Deferred proposal, 2026-11-17 SGT. No execution task assigned.

> Draft requirements, not execution authority. IBKR endpoints, error codes, limits and XML field names below come from IBKR's public Flex Web Service documentation and from reading one open-source client. Verify them against IBKR's current documentation and a synthetic response before building.

## Outcome

Pull trades, dividends and closing balances from Interactive Brokers without exporting a statement by hand. The user creates a read-only Flex Query and a Flex Web Service token in IBKR Client Portal, saves both in FinSight once, and presses **SYNC**. FinSight fetches the latest statement and shows the same preview as the existing IBKR import (FEAT-008): new fills, already-recorded fills and anything it refuses. Nothing changes until the user confirms.

This is the low-risk path to "broker sync". It needs no gateway, no daily 2FA session and no OAuth, and the Flex token can only read reports. It cannot place orders.

## Why now

- Manual statement export is the main friction left in keeping the real book current.
- IBKR execution IDs fix a known FEAT-008 limit: identical same-day fills in separate partial exports cannot be told apart without them.
- Flex reports include IBKR's own FX rate for each trade, which can make the stock-versus-FX split use the rate actually paid rather than a fetched historical rate.

## Relationship to other specs

| Spec | Relationship |
|---|---|
| FEAT-008 IBKR trade import | Reuses its preview, snapshot token, lock, undo, chronological apply and refusal rules. Flex is a new source of the same rows, not a new import path |
| FEAT-021 Statement reconciliation | A Flex statement can be the broker side of the comparison. Shared parser; independent release |
| FEAT-001 IBKR MCP and live sync | Covers the read-only sync part of FEAT-001 with far less machinery. FEAT-001 keeps the gateway, margin data and staged orders |
| Agent read-only rule | Unchanged. Kestrel never sees the token and has no sync tool that writes. It can read the last sync status |

## Licence boundary

Sure (`we-promise/sure`) has a working Flex client, but it is AGPLv3 and FinSight is MIT. **Do not copy, port or translate its code.** Copying would make the result a derivative work under AGPL. Build from IBKR's documentation. The design lessons listed under *Design notes* are general facts about the IBKR API, which anyone may use.

## First release

### Setup
- [ ] Settings form with **Query ID** and **Token** fields and a link to IBKR's Flex Query setup page. Short instructions name the sections the query must include: Account Information, Open Positions, Trades (execution level), Cash Transactions, Cash Report. Format: XML.
- [ ] Save the token in the macOS Keychain, with an encrypted-at-rest fallback in the data folder on other platforms, file mode 0600. Never write it to logs, traces, the browser, exports or Kestrel. The browser only sees `configured: true` and the last four characters.
- [ ] Link the query to one explicitly chosen FinSight account. If the statement's IBKR account ID differs from the one saved at first sync, refuse.
- [ ] **Test connection** fetches once and reports the account ID, statement period and section counts without importing anything.

### Fetch (server side, `lib/ibkr-flex.ts`)
- [ ] Two-step Flex Web Service flow: `SendRequest` returns a reference code, then poll `GetStatement` until the XML is ready.
- [ ] Space requests at least 6 seconds apart per token, the documented limit being 10 a minute. Treat "statement generating" codes as pending, "throttled or busy" codes as retry-later, and token or query errors as setup errors with a clear message. Cap total wait (proposed: 2 minutes) and report a timeout as unavailable.
- [ ] The host is fixed to IBKR's Flex endpoint and goes through FinSight's existing outbound fetch. There is no user-supplied URL.
- [ ] Optional date range, at most 365 days per request; without one, the query's saved period applies.
- [ ] Keep the raw XML in the data folder for audit, with retention set by the user (proposed default: last 10). It is never committed and never sent to the model.

### Parse (`lib/ibkr-flex-parse.ts`)
- [ ] Parse from attributes, without depending on attribute order. Reject a document with no `FlexQueryResponse` root or no `FlexStatement`.
- [ ] **Trades:** stocks and ETFs only, the same categories FEAT-008 accepts. Map to the existing `IbkrTrade` shape plus `brokerRef` (IBKR trade or execution ID) and `brokerFx` (the trade's FX rate to the IBKR base currency). Any other asset category is listed as unsupported in the preview, never dropped silently.
- [ ] **Cash transactions:** dividends and withholding tax mapped to the existing `IbkrDividend` shape, deduplicated by IBKR transaction ID.
- [ ] **Open positions and cash report:** parsed for the preview's check panel and for FEAT-021. They are never written as holdings.
- [ ] Symbols keep exchange identity using the same suffix rules as the CSV import, for example `0700.HK`.

### Match and apply
- [ ] Add optional `brokerRef` to `StoredTransaction`. A fill whose `brokerRef` is already stored is **recorded**.
- [ ] For a fill without a match, fall back to the FEAT-008 key (account, symbol, side, trade day, quantity, price, currency, with multiplicity). On confirm, stamp the matched existing fill with its `brokerRef`, so CSV-imported history and Flex history converge and the next sync matches by ID.
- [ ] New fills apply through `importTrades` unchanged: one save, one undo, under the lock, and a stale preview token is refused.
- [ ] **Check panel:** after applying the preview in memory, compare FinSight's resulting quantity per symbol with the statement's open positions. Show any differences before confirming. Do not block on them; that remains FEAT-021's job.
- [ ] Refuse, with a reason, anything FEAT-008 refuses: backfills before later activity, sales larger than holdings, currency mismatches.

### UI
- [ ] **SYNC** button in the Positions panel beside IMPORT, for accounts linked to a Flex query. It shows the last sync time and status (OK / Needs setup / Token expired / Unavailable).
- [ ] The preview reuses the IBKR import preview, with an extra *Source: IBKR Flex, statement as of …* line.

## Later releases (each needs its own selection)

1. **Scheduled fetch.** Fetch on server start and daily, and show "N new fills" as a badge. Still requires confirmation. Auto-apply is out of scope unless the owner selects it explicitly.
2. **Broker FX for attribution.** Where the IBKR base currency equals the FinSight base or USD, store the broker's rate on the lot instead of the fetched historical rate, and mark the source. Needs a check on how it interacts with `fxUsd` and `usdBase`.
3. **Corporate actions.** Splits and symbol changes from the Corporate Actions section. Until then, a statement that contains one is flagged and the affected symbol's fills are refused.
4. **Commissions and fees.** Only once the manual ledger records fees (FEAT-008 excludes them).
5. **Kestrel read access.** A read-only `get_sync_status` tool reporting last sync, pending new fills and position differences. No sync or apply tool.

## Design notes (from IBKR docs and how other clients behave)

- The Flex token's validity period is set by the user when it is created (up to a year) and the token can be restricted to an IP. Surface expiry as "Token expired, regenerate in Client Portal".
- Statements for the current day may be incomplete until IBKR's end-of-day batch. Label the as-of date and don't treat a missing same-day fill as an error.
- Use execution-level trade rows. Order-level summaries aggregate partial fills and break ID matching.
- A single Flex response can contain several `FlexStatement`s (multiple accounts). The first release accepts exactly one and refuses more with a clear message.

## Acceptance

- [ ] Synthetic XML fixtures only: one account with buys and sells across USD, HKD and SGD listings; dividends with withholding; an unsupported option trade; a split; a mismatched account ID; a multi-account response; malformed XML.
- [ ] A fake Flex server covering pending, throttled, expired-token and timeout responses. No test calls IBKR.
- [ ] Syncing the same statement twice adds nothing. A Flex sync after a CSV import of the overlapping period adds only the genuinely new fills and stamps `brokerRef` on the matched ones.
- [ ] Two identical same-day fills with different broker IDs both import, and a re-sync recognises both.
- [ ] Secret scan shows the token appears in no log, trace, response body, export or agent context.
- [ ] e2e: setup, test connection, sync preview, confirm, undo.

## Stop condition

The spec does not authorise connecting a real IBKR account. A first real sync is a separate owner action after synthetic verification.
