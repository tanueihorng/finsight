# FEAT-010: Market Discover

Status: First slice plus US market movers and US IPO calendar merged locally into `main` at `cefd2ff` (not pushed, not deployed) · 2026-10-31  
Execution task: `DISCOVER-001` (selected by the user 2026-10-31; market-wide movers and IPOs added at the user's request the same day).

## Intent

Add a responsive discovery view to FinSight inspired by the supplied market-discovery screenshot. Help users explore movers and upcoming events, and open existing symbol details. Adapt to FinSight's visual system rather than copying the reference's branding.

## Proposed first slice

- Display gainers and losers among holdings and watchlist symbols using available quotes. Clearly label the eligible universe; this is not a market-wide ranking. Define the percentage-change baseline, session, data time, instrument eligibility and treatment of missing quotes before implementation.
- Display available upcoming earnings for held and watched symbols, marking estimated dates. Allow symbol rows to open the existing chart/detail view.
- Show source, as-of time, session and delayed, stale, empty or failed states where applicable. Support desktop, mobile and keyboard navigation.
- Use deterministic calculations and existing authenticated, read-only server and caching patterns. Do not place provider credentials in browser code.

## First-slice decisions (2026-10-31)

Defaults chosen when the user selected the task; change any of them on review.

- **Placement:** a `DISCOVER · HOLDINGS + WATCHLIST` panel in the right column after World Markets; hideable and movable through ⚙ Layout like other panels.
- **Universe:** symbols held in the account in view (All Accounts when selected) plus the global watchlist, de-duplicated. Capped at 200. The panel states it is not market-wide and shows ranked / held / watched counts.
- **Baseline and session:** Yahoo Finance regular-session price against the previous regular close (the existing `normalizeQuote` `changePct`). Pre/post-market is excluded. Each symbol uses its own exchange's latest session, so mixed US/SG/HK lists can compare different days; this is disclosed.
- **Eligibility:** indices (`^`), FX (`=X`), futures (`=F`) and crypto pairs are excluded and listed with their reason. A failed quote is `no quote`; a missing price or previous close is `no prev close`. Neither is ranked as zero.
- **Sorting:** gainers by change % descending, losers ascending, ties by symbol; exactly 0% is counted as unchanged. Six rows per list, with "Show all".
- **Staleness:** rows stay ranked but carry a `stale` tag when the quote is a cached value served after a failed fetch, or the last trade is older than four days (or missing).
- **Earnings:** from the existing `/api/events` data (held and watched, next 60 days), with dates shown as the exchange-local calendar day (`NY`, `SG`, `HK`…), `~est` where Yahoo marks the date estimated, and days away. A failed lookup is shown, not hidden.
- **API:** authenticated, read-only `GET /api/discover?account=` returning scope, basis (source, session, baseline, delayed), `asOf`, `retrievedAt`, gainers, losers, exclusions and earnings with `ok`. It reuses the 15 s quote and 6 h detail caches; no new provider, credential or polling outside the panel's 60 s query.
- **Out of scope here:** no trade actions, alerts, explanations of moves, or agent tool.

## Market-wide movers and IPO calendar (2026-10-31)

Added when the user asked for wider movers and IPOs. The panel now has three keyboard-operable tabs: **Your symbols** (above), **US market** and **IPOs**; the chosen tab is remembered per browser.

- **US market movers:** Yahoo Finance's predefined `day_gainers` / `day_losers` screens (`/v1/finance/screener/predefined/saved`), key-less, through the existing `yahooFetch` (host fallback and 429 backoff). Top 25 each; equities only; rows re-sorted and sign-checked server-side; the screen's own total is shown ("top 25 of 109"). Yahoo's screen criteria are Yahoo's and not fully published, so the panel says the list is not every listed stock. Cached 60 s; a failed refresh serves the last list for 15 min, flagged as stale. Held and watched names are tagged. Clicking opens the existing detail.
- **IPO calendar:** Nasdaq's public calendar JSON (`api.nasdaq.com/api/ipo/calendar?date=YYYY-MM`), key-less, for the previous, current and next US Eastern month. Upcoming deals (expected date on or after today, ET) are labelled tentative; deals priced in the last 14 days are listed; filed and withdrawn deals are counted, not listed. Each deal links to its Nasdaq overview and an SEC EDGAR company search (the official filings, including the prospectus, are there; the link is a search, not a specific document). Cached 6 h, with a 3-day stale fallback, persisted.
- **Coverage:** US only. Yahoo ignores the screen's `region` parameter (SG and HK requests returned the US list on 2026-10-31); SG/HK movers and IPOs remain unsupported. Subscription counts, grey-market and broker top buys/sells remain unavailable.
- **Failure handling:** each section fails independently, with a visible message; partial results say they are partial.
- **Licensing and stability:** both are undocumented public endpoints with no published terms for this use; this personal, non-redistributing installation already relies on Yahoo the same way. They can change or block without notice. Before any public or commercial release, replace or license them (candidates in the feasibility record: FMP, Massive).
- **Live verification, 2026-10-31 (Sat, markets closed):** isolated preview on port 8009 with a temp data folder and the demo portfolio plus a watchlist of AMD, TSLA, 0700.HK, ^GSPC and BTC-USD; real Yahoo and Nasdaq data. `/api/discover` answered in 248 ms with every section ok. Your symbols: 12 ranked, ^GSPC (index) and BTC-USD (crypto) excluded, earnings dates on the exchange-local day (e.g. 0700.HK on 18 Nov, HK). US market: Day Gainers 109 / Day Losers 551 in total, top rows CDNA +22.22% and RDDT −29.22%, sorted correctly. Independent cross-check against Yahoo's chart endpoint (change vs the prior daily close): AMD −10.88%, INTC −28.58%, CDNA +22.22%, 0700.HK +1.59%, all matching. IPOs: 0 upcoming (Nasdaq's only listed upcoming deal, OPAY, was expected on 30 Oct, already past), 5 priced in the last 14 days, 70 filed and 16 withdrawn counted. Nasdaq leaves the price blank for some priced deals (GBC, DAVI); these show "price n/a". Desktop and 375 px phone layouts checked, no horizontal scroll, no console or server errors.
- **Note on the HTTP client:** a full desktop-Chrome User-Agent gets HTTP 429 from Yahoo on every endpoint; the app's minimal `Mozilla/5.0` (lib/config.ts) works.

## Later provider-backed scope

Investigate broad US movers, market-wide earnings and an IPO calendar. Normalize provider data, bound and cache requests per dataset, and account for rate limits and failure. Show IPO dates as tentative and retain official prospectus links when available. Verify provider plan, price, licensing, coverage, update frequency, market sessions and data quality before integrating. SG/HK coverage is an open question. Broker-specific top buys and sells, subscription counts, grey-market data and explanations of price moves require separately substantiated sources and are not part of the first slice.

## Acceptance and verification when selected

- [~] Agree scope, display placement, session/baseline semantics, supported instruments and data sources.
- [x] Sort eligible movers correctly; visibly disclose scope, exclusions and incomplete data. Show estimated or unknown event dates honestly.
- [x] Symbol navigation, responsive layout and keyboard interactions work without creating trade instructions or automated monitoring.
- [x] Test sorting, ties and missing quotes, date/timezone boundaries, estimated dates, stale data, partial failures and provider errors using deterministic fixtures; verify desktop and mobile UI.
- [~] Before any provider-backed release, verify actual entitlements, coverage, licensing, freshness and behavior under limits, and record the results.

## Integration notes and dependencies

The existing markets panel uses fixed groups rather than a market-wide universe; events are limited to held and watched symbols. Reuse the existing React island, symbol selection and authenticated server patterns where appropriate. Any new discovery endpoints should return source, scope, session, as-of and error/staleness metadata. News alone does not establish the cause of a move.

Initial feasibility estimate: 2–4 engineering days for the limited first slice, 1–2 weeks for a broader provider-backed version; both are uncertain and depend on scope and access. See the workspace feasibility record at `harness/runs/20261031-discover-feasibility/ASSESSMENT.md` for inspected code and candidate providers. Related existing feature: START-001 briefing mover tiles; reconcile overlap during design.
