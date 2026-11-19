# FinSight feature map

What a user can do, where, and what they should see on the verify server (`scripts/verify-server.ts`: fake
market, demo portfolio in SGD, Kestrel off). Values are from the offline fake market and do not change.
Selectors are for reading results; act the way a user would.

## Dashboard on load

| Feature | Where | Expect |
|---|---|---|
| Unlock | Lock screen, PIN `2468`, Enter | `body` loses class `locked`; dashboard shows |
| Summary bar | Top cards | Net worth **S$92,967.48**, cost S$66.06K, unrealized +S$26,912.17 (+40.74%), realized +S$0.00 |
| Positions | Panel `positions` | 9 rows (`#positions-body tr[data-sym]`), VOO first: qty 22, avg 470.00, last 552.10, weight 16.9 |
| Look-through | Panel `exposure` | "Mapped 72,595 + not broken down 20,373 = 92,967 invested" and **✓ reconciles**; VOO and ES3.SI "no file" |
| FX risk | Panel `fxrisk` | USD/SGD 1.2900; USD exposure S$66.33K, 71% of book; blended entry 1.0981 |
| Dividends | Panel `dividends` | Forward S$1,670/yr net, S$1,816 gross |
| Recent activity | Panel `activity` | 9 BUY rows, newest O39.SI 500 @ 14.80 |
| Guardrails | Panel `guardrails` | All limits UNSET; largest holding VOO 16.9% |
| Thesis tracker | Panel `theses` | 0/9 written |
| Security detail | Panel `detail` | Title `VOO · DETAIL`, price 552.10, a chart canvas |
| World markets | Panel `markets` | INDICES group; S&P 500 6,012.40; USDSGD=X 1.2900; pill LIVE |

## Flows

| Feature | How | Expect |
|---|---|---|
| Command bar | Type in `#cmd`, Enter | `#cmd-status` confirms, e.g. `WATCH NVDA` → "Watching NVDA" and NVDA 182.40 in the watchlist |
| Select a symbol | Click a positions or markets row, or `Q AAPL` | Detail title changes, e.g. `AAPL · DETAIL` |
| Buy | Positions `+ ADD`, or a row's Buy | Quantity, cost and summary update; a BUY appears in recent activity |
| Sell | A row's Sell | Quantity drops, realized P&L changes; a sale dated before shares were bought is refused with a message |
| Undo | `↶ UNDO` after a change | The previous state returns exactly |
| Import | `IMPORT` with CSV text | Rows added; with replace, a bad row refuses the whole import and changes nothing |
| Cash | `CASH` or `EDIT CASH` | Net worth and the cash floor/ceiling readings move by the amount |
| Accounts | Account selector | Switching shows only that account; ALL merges them |
| Alerts | `ALERT AAPL > 320` | Alert listed in `alerts` with its condition |
| Layout | ⚙ Layout (`#cards-btn`) | Hide/show panels; drag a panel by ⠿ to the other column; both survive reload |
| Theme | ⚙ Layout theme swatches | Colours change; charts redraw |
| Lock | Clear the session or wait for expiry | Lock screen; polling stops; unlock restores the same view |
| Kestrel | `↗ KESTREL` (⌘/) | Side panel opens with "Kestrel offline. The agent is turned off (AGENT_AUTOSTART=0)" and Retry; the verify server runs without the agent |
| Narrow screen | Resize to 390×844 | One column; no horizontal scroll; the lock screen hides everything else |
