# FEAT-020 · Portfolio Sandbox

Selected as SANDBOX-001 on 2026-11-11 SGT. Implemented on `feat/portfolio-sandbox`; integration and deployment remain separate.

## Outcome

Compare today's portfolio with a draft set of buys and sells. See the combined effect on cash, position weights and concentration before deciding whether to take any action. The existing trade sheet previews a single trade and Quant Lab replays historical strategies.

## First release

- Start with one account, one currency, stocks and ETFs, and explicit draft share quantities. Pin a dated positions, cash and price snapshot. Let the user enter or override assumed prices and fees and show where each assumption came from.
- Preview before and after cash, positions, largest weights, total fees and uncovered amounts. Run the draft in a declared order and flag oversells, insufficient cash, missing prices and unsupported positions. Reuse existing arithmetic where applicable.
- Keep the draft separate from ledger, policy and order routes. Add comparisons between drafts and optional ETF issuer exposure after the single-draft workflow works. Accepted guardrail comparisons depend on the process panels and use only recorded limits.

## Acceptance

- An offline sell-then-buy fixture reconciles opening and closing positions, cash and fees against independently calculated values. Changing order or price exposes any funding shortfall.
- The comparison names its account, book, price timestamp, and currency. Stale inputs are visible and unavailable inputs cannot silently become zero.
- Preview and reset leave live holdings, cash, trade history and orders untouched.

## Implementation

Open **Sandbox** in Positions, choose an account and currency, enter the draft, and pin the snapshot. A blank trade price uses the pinned quote. The market mark stays fixed even when execution price changes. Fee inputs default to zero. Positions use the total of priced securities in the chosen currency for their weights. Unpriced and excluded positions and cash are disclosed separately.

The session-gated `GET /api/portfolio/sandbox` reads the request's book and one account. Repeated `symbol` parameters add draft tickers. The browser holds the draft and runs the deterministic comparison in memory. Draft proceeds are available immediately for subsequent draft rows. Settlement delays, FX conversion, borrowing, taxes and order execution are outside this slice.
