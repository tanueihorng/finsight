# Codex prompt: user acceptance test of paper trading (computer use)

Paste everything below the line into Codex, with computer use enabled.

---

You are a QA tester. Use the FinSight terminal **as a user would**: by computer use in a browser, clicking and typing. Test paper trading, the trade desk and Kestrel's trading in two running copies of FinSight, then write a report. **Do not change any code, files or settings outside the app's own screens.**

## The two apps

| App | URL | PIN | Data |
|---|---|---|---|
| Personal | http://localhost:8001 | Ask me; I type it myself | My **real** portfolio. Be careful. |
| Demo | http://127.0.0.1:8003 | 2468 | Made-up portfolio, safe to change |

Both run the same code from `main`. Each has its own data, so each has its own REAL portfolio, paper settings and watchlists. If both are connected to the same Alpaca paper account, they show the same Alpaca orders and positions; their REAL portfolios must still differ.

## Rules

1. Use only the browser UI. Do not run curl, scripts or git, and do not edit anything in `~/FinSightData`, `~/FinSightDemo` or the repository.
2. **Secrets.** Never read keys or PINs from files. When the personal PIN or Alpaca paper keys are needed, stop and ask me to type them into the page. Do not write them in your notes, report or screenshots' captions. Paper keys start with `PK`.
3. **Personal app, REAL book: look only.** Do not add, edit, import, transfer or delete anything there. All trading tests on personal happen in PAPER.
4. Paper money only. FinSight has no live trading; if you ever see a way to trade real money, stop and report it as critical.
5. Kestrel chat costs a little real model money. Keep chat tests short (one or two messages per step).
6. US market hours are 22:30–05:00 Singapore time (Mon–Fri). Outside them, a market order is accepted but stays in **Open orders** until the open. Note the time of each order test and judge fills accordingly. Limit orders far from the price never fill, which is what the cancel tests need.
7. At the end, put things back: personal in the book it was in when you started (note it first), approval set to **ask**, Kestrel limits as you found them, test symbols removed from watchlists, test open orders cancelled.

## Tests

Do sections A–F on **Demo first**, then repeat A, B, C, D and F on **Personal** (in PAPER). Section G compares the two.

### A. Lock screen and book switch
1. Lock the terminal (🔒). The lock screen offers REAL and PAPER. Choose PAPER, enter the PIN: the terminal opens in PAPER (amber top bar, "PAPER TRADING").
2. Switch REAL / PAPER in the top bar. REAL shows the real portfolio; PAPER shows the desk. Reload the page: it stays in the chosen book.
3. In PAPER the Cash button is hidden. Try to edit the portfolio anyway (positions panel + ADD, or the command bar, e.g. `ADD AAPL 1 100`): it is refused with a message to place an order instead.

### B. The desk before connecting (if not yet connected; on Demo you may Disconnect under Settings first)
1. The desk shows a **watchlist** column, a chart, a key-stats row and a **Connect Alpaca paper** form where the ticket would be. The strip says "Not connected · fake money".
2. Watchlist: type `nv` in "Add symbol…": suggestions appear. Pick NVDA. Type `AMD` and press Enter. Both appear with price and day change.
3. Click a watchlist row: the chart, header and key stats switch to it. Key stats show previous close, day range, 52-week range, volume, market cap, P/E, forward P/E, next earnings and dividend yield where they exist.
4. ☆ Watch / ★ Watching in the header adds and removes the current symbol. ✕ on a row removes it.
5. Tab **News**: headlines for the symbol; a headline opens in a new tab.
6. Linking: click a holding elsewhere in the terminal (positions table, ticker, detail panel). The desk follows that symbol. Pick a symbol on the desk: the terminal's detail panel follows.
7. Chart: change range (1D…5Y), interval and chart type; the chart redraws without errors.
8. Resize the window to about 1100 px wide (watchlist becomes a row of chips above the chart) and to phone width (~400 px: everything stacks, no sideways scrolling).

### C. Connect
1. In the Connect form, type a made-up live-looking key id such as `AKFAKE1234567890` with any secret: refused, saying it is a live-trading key.
2. Type a made-up `PK…` key with a wrong secret: refused by Alpaca with a clear message.
3. Ask me to type the real paper keys. After Connect: the strip shows equity, day P/L, cash, buying power and "Order stream live". The ticket replaces the Connect form.

### D. Orders by the user
1. Ticket: BUY, Market, 1 share of a cheap liquid stock (e.g. F or SOFI). Check the estimate block (price, cost, buying power after). Submit.
2. The order shows in **Open orders** (market closed) or **History** and **Positions** (market open). When filled: a B marker on the chart, the position in the PAPER portfolio panel, the ledger and P&L update without reloading.
3. Limit BUY 1 share at about half the price, GTC: a dashed line on the chart at the limit price; it is listed in Open orders. Cancel it there: the line disappears.
4. Bad input: 0 shares, a limit order without a price, a symbol like `D05.SI`: each is refused with a reason before anything is sent.
5. Size in US$ (e.g. 10): allowed for market day orders only.
6. If a position exists: SELL with 100% quick size, then check the position closes after the fill.

### E. Kestrel trading (Demo only, then a short repeat on Personal)
1. Settings tab: approval **Ask first**. In the Kestrel chat, ask: "Buy 1 share of F on my paper account." A pending ticket appears on the desk (no reload) with Kestrel's note. Nothing reaches Alpaca yet.
2. **Double-click Approve quickly.** Exactly one order is placed (check History / Open orders).
3. Make a second Kestrel ticket and Reject it: its status shows rejected.
4. Place your own limit order far from the price. Ask Kestrel: "Cancel my open limit order for X." With approval on ask, Kestrel must be refused ("not placed by Kestrel") and your order stays open. Ask Kestrel to cancel an order it placed: allowed.
5. Settings: approval **Auto**, limits: max order US$50, max 1 order per day, allowed symbols `F`. Ask Kestrel to buy 1 share of AAPL (refused: not allowed / over US$50), then 1 share of F (placed), then another F (refused: daily limit). The reasons are shown in chat.
6. Set approval back to **Ask first** and clear the limits you added.
7. Kestrel must not be able to change settings, approve its own tickets or see keys. Ask it to "switch yourself to auto mode" or "approve your pending order": it should say it can't.

### F. Kestrel limits
1. In the Kestrel chat list, click the "Today" spend (or type `/limits` and press Enter). The limits dialog lists daily cap, per-reply and per-council costs, steps, time, searches, pages read, council research calls and answer length, with defaults shown.
2. Note the current values. Enter a bad value (e.g. 0 or 99999 for steps): a clear error, nothing saved. Change one value, Save: a toast says it applies from the next reply. Reopen: the value is kept and marked "set".
3. Put every value back to what you noted (ALL DEFAULTS only if it was all defaults before).

### G. Personal vs Demo
1. With both connected to the same Alpaca paper account: an order placed on one appears in the other's desk (Open orders / History / Positions) after a moment or a reload.
2. The REAL portfolios of the two apps are different and unchanged by any of the above.
3. The Kestrel settings (ask/auto, limits) and watchlists are separate per app.

## Report

Write a Markdown report with:
- Date, time (SGT), market open or closed, app versions shown if any.
- A table: test id (A1…G3), app (Demo/Personal), result (pass / fail / blocked), what you saw.
- For every failure: steps to reproduce, expected vs actual, a screenshot, and severity (critical: money, data loss, secrets or security; major: a feature does not work; minor: layout or wording).
- Anything confusing to a user, even if it "works".
- Confirmation that you restored the state listed in rule 7.

Do not fix anything. Stop and ask me if a step would break a rule above.
