# FEAT-012: Paper trading mode (Alpaca paper) with Kestrel order placement

Status: In progress on branch `feat/paper-trading` · 2026-10-31  
Execution task: `PAPER-001` (selected by the user 2026-10-31). No separate decision record: the trade ban (ADR-001) was withdrawn on main in `7bb7cc9`, so Kestrel's paper orders need no exception. Next step: [FEAT-013](FEAT-013-agentic-trading.md) agentic trading plan. Agent data sources and evaluation references: [FEAT-011](FEAT-011-agent-data-sources.md).

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

## Trade desk (UI, 2026-10-31)

The user asked for the paper screen to follow what professional trading screens do (chart, ticket and orders together). Patterns taken from broker and exchange terminals (TradingView's order panel, Binance/OKX/Kraken Pro spot screens, Webull, DXtrade): chart in the centre with the order ticket docked beside it, one symbol linked across chart, ticket and tables, BUY/SELL tabs, order-type tabs, size in shares or USD with 25/50/75/100% quick sizes, an estimate block (price, cost or proceeds, buying power and buying power after), one large side-coloured submit button, and a tabbed strip below for positions, open orders and history. Fills and open orders are drawn on the chart.

In FinSight, the desk is a full-width section above the panels and is shown in PAPER mode only:

- **Account strip:** equity, day P/L, cash, buying power and the order-stream state.
- **Watchlist (left column):** an add box with symbol search, the paper positions, then the paper book's watchlist with last price and day change. A click charts the symbol; ✕ removes it. Under 1200 px it becomes a row of chips above the chart.
- **Symbol header:** a ☆ Watch / ★ Watching toggle and key stats (previous close, day and 52-week range, volume, market cap, P/E, forward P/E, next earnings in New York time, dividend yield) from `/api/quote-details`.
- **Kestrel's pending tickets:** a highlighted bar with Approve and Reject.
- **Chart:** the existing chart engine (`public/chart.js`) runs as its own instance with its own saved settings (`cfgKey`). It draws the paper book's fills as B/S markers with the average-cost line. Open limit orders are dashed price lines (new `tradeData.orders`).
- **Ticket:** docked on the right; it stacks below the chart under 900 px.
- **Tabs:** Positions (a click selects the symbol; Buy, Sell and Close prefill the ticket, and Close still needs the Sell press), Open orders (Cancel), History, News (the symbol's headlines), Kestrel (all tickets with status and note) and Settings (Kestrel approval and limits, account, Disconnect).
- **Linked to the terminal:** a symbol picked anywhere in the terminal becomes the desk's symbol, and a symbol picked on the desk updates the terminal's detail panel.
- **Before connecting:** the watchlist, chart, key stats and News still show; the ticket slot holds the Connect form. The desk is for research as well as orders.

The estimate is only a guide; a market order fills at Alpaca's price.

## Security (review 2026-11-01)

- **Keys:** server-side only (`alpaca-paper.json`, 0600, written atomically), never returned to the browser or Kestrel. Live keys (`AK…`) are refused. The Alpaca base URL is the paper constant; an override must be loopback (tests).
- **Kestrel's reach:** its bearer token may read a fixed GET list and POST only `/api/paper/orders` and `/api/paper/orders/cancel`. It cannot change settings or limits, approve tickets, or connect keys. Its orders pass the user's limits first; in ask mode they become tickets.
- **Cancels:** in ask mode Kestrel may cancel only orders it placed; the user's own orders need the user. In auto mode it may cancel any open paper order.
- **Races:** a ticket is claimed inside the orders lock, so a double click or a second tab sends one order. Kestrel's orders run one at a time, so concurrent calls cannot pass the daily count together.
- **CSRF:** SameSite=Strict does not stop another port on localhost (same site). Every browser write under `/api/` must come from this origin (`Sec-Fetch-Site` and `Origin` are checked when sent). DNS rebinding is refused by the Host check.
- **Display:** news links are kept only if they are http(s); React escapes Kestrel's notes and all feed text.
- **Prompt injection:** Kestrel reads web pages and news, which could try to steer it to trade. Ask mode (the default) puts the user in front of every order; auto mode is bounded by the limits the user sets, and by paper money.

## Out of scope for this slice

Live (real-money) trading of any kind; short selling and options in the book; Alpaca market-data streaming; scheduled or recurring agent runs; multi-account paper.

## Acceptance

Ticked items are verified offline against the fake broker (`FINSIGHT_FAKE_MARKET=1`). A run with the user's own Alpaca paper keys and a real Kestrel model run are still pending.

- [x] Mode switch on the lock screen and in the top bar; reload lands in the chosen mode; REAL data is untouched by anything done in PAPER.
- [x] Connect flow: paper keys verified and stored server-side; live keys or bad keys refused; disconnect removes them.
- [x] Orders: place, list, cancel from the terminal; fills appear in positions, ledger and P&L without a manual refresh.
- [x] Kestrel: `ask` creates a pending ticket that can be approved or rejected; `auto` places directly; each limit refuses with its reason; the agent cannot change settings.
- [x] Deterministic tests against a loopback fake Alpaca (no network); E2E covers the mode switch, an order fill and a Kestrel pending ticket.
- [x] Trade desk: the chart follows the ticket's symbol, shows paper fills and open limit orders, and drops a cancelled order's line; the desk stacks on a phone with no horizontal scroll.
- [x] Desk research: before and after connecting, the user can add and remove watchlist symbols, see key stats and news, and the desk follows the terminal's selected symbol.
- [x] Live run with the user's Alpaca paper keys (real `trade_updates` stream) and a real Kestrel model placing a paper order. Verified 2026-11-03 SGT (US session 2026-11-02) on the demo at 8003 from `main` `2ba05d8`: paper account connected with "Order stream live"; DeepSeek Flash Kestrel (US$0.0039) made ask-mode ticket `tk70f02385b99d` (buy 1 SPY, market, day, est. US$761.07); the user approved it in the terminal; Alpaca order `664f1db7…` filled at US$761.06 and the fill was mirrored into the paper book about 3 s after approval with no drift, shown as a position and a chart marker. Fill delivery by the stream rather than a resync poll was inferred from timing, not traced.
