# FEAT-011: Paper trading mode (Alpaca paper) with Kestrel order placement

Status: In progress on branch `feat/paper-trading` · 2026-10-31  
Execution task: `PAPER-001` (selected by the user 2026-10-31). Decision record: [ADR-002](../decisions/ADR-002-agentic-paper-trading.md).

## Intent

Give FinSight a second mode next to the real portfolio: a **paper trading** book backed by an Alpaca paper account (fake money, US stocks and ETFs), where the user and Kestrel can place orders and see fills, positions and P&L live. It is a step towards agentic trading: Kestrel may place paper orders itself, with the level of autonomy chosen by the user.

## Decisions (2026-10-31, from the user)

- **Two modes, one terminal.** `REAL` (the existing book in `portfolio.json`, unchanged) and `PAPER`. The mode is chosen on the lock screen before entering the PIN, or switched in the terminal's top bar. The choice is stored in `DATA_DIR/book.json` and applies to every tab and to Kestrel, so the agent always sees the book the user sees. Paper mode is visibly marked (PAPER badge and a coloured top stripe) so the two are never confused.
- **Broker:** Alpaca's paper API only (`paper-api.alpaca.markets`, free). The paper base URL is a constant; there is no live trading URL in the code. A test or demo may point it at a loopback fake only. Keys: an Alpaca *paper* key pair entered by the user in the terminal (stored `0600` in `DATA_DIR/alpaca-paper.json`, never sent to the browser or the agent) or `ALPACA_PAPER_KEY_ID` / `ALPACA_PAPER_SECRET_KEY`. Keys are verified against the paper endpoint before they are saved.
- **Paper book = mirror of Alpaca.** Alpaca is the source of truth for orders, fills, cash and positions. FinSight replays Alpaca fill activities into its own book file `DATA_DIR/paper/portfolio.json` (account "Alpaca Paper", USD), so every existing view works unchanged in paper mode: positions, summary, P&L with the FX split in SGD, analytics, performance, ledger, realized P&L and chart trade markers. Cash is Alpaca's account cash. Manual book edits (add/import/edit/delete/cash/accounts/transfer/reset/undo) are refused in paper mode with a clear message; orders are the only way in. Watchlist and alerts work per book.
- **Orders:** market and limit; buy and sell; time in force `day` or `gtc`; whole or fractional quantity, or a notional USD amount for market orders. Open orders can be cancelled. Short sales and options are not mirrored in this slice (Alpaca's own position list is shown alongside if they occur).
- **Live updates:** FinSight keeps Alpaca's `trade_updates` stream open while keys exist, resyncs the book on every fill and pushes order events to the browser over a server-sent event stream (`/api/paper/stream`). Prices stay on the existing quote path (Yahoo, 15 s); Alpaca's free market data (IEX only) is not used for valuation.
- **Kestrel can trade paper.** New tools: `paper_account` (account, positions, open and recent orders, settings), `paper_place_order`, `paper_cancel_order`. What happens to a Kestrel order is the user's setting:
  - **Approval** — `ask` (default): Kestrel's order becomes a pending ticket that the user approves or rejects in the terminal; `auto`: Kestrel's order is sent to Alpaca at once.
  - **Optional limits on Kestrel's orders**, each off unless set: maximum order value (USD), maximum Kestrel orders per day, maximum position weight after the order (% of paper equity), and a symbol allowlist. A breached limit refuses the order with the reason, deterministically, before it reaches Alpaca.
  - Settings are changed only from the terminal (PIN session); the agent can read them but not change them.
- **Every order records its origin** (`user` or `kestrel`, with the Kestrel thread) and is listed in the orders panel.

## Out of scope for this slice

Live (real-money) trading of any kind; short selling and options in the book; Alpaca market-data streaming; scheduled or recurring agent runs; multi-account paper.

## Acceptance

- [ ] Mode switch on the lock screen and in the top bar; reload lands in the chosen mode; REAL data is untouched by anything done in PAPER.
- [ ] Connect flow: paper keys verified and stored server-side; live keys or bad keys refused; disconnect removes them.
- [ ] Orders: place, list, cancel from the terminal; fills appear in positions, ledger and P&L without a manual refresh.
- [ ] Kestrel: `ask` creates a pending ticket that can be approved or rejected; `auto` places directly; each limit refuses with its reason; the agent cannot change settings.
- [ ] Deterministic tests against a loopback fake Alpaca (no network); E2E covers the mode switch, an order fill and a Kestrel pending ticket.
