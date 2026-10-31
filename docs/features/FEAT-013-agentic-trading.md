# FEAT-013: Agentic trading (Kestrel trades the paper account on the user's behalf)

- **ID:** FEAT-013
- **Status:** Plan, not selected for implementation · 2026-10-31
- **Depends on:** FEAT-012 paper trading (branch `feat/paper-trading`: Alpaca paper book, order gate, ask/auto approval, limits); FEAT-011 agent data sources (optional evidence); the evaluation references in FEAT-011 ("Evaluating the paper-trading agent")

## Intent

Kestrel runs a trading cycle on its own: it finds candidates, researches them, decides, places paper orders through the existing gate, manages exits and records each decision so it can be scored. The user chooses the autonomy level and the limits. Holding period is days to about two months, so a daily cycle is enough; intraday speed is not a goal.

## Reuse first

Most of the machinery already exists in this repo. The plan wires it together rather than adding a framework.

| Need | Existing piece | Change |
|---|---|---|
| Durable background runs, budgets, checkpoints, tool allowlists | Kestrel task queue and workflows (agent SPEC FR-5) | New workflow `paper-trade-cycle` |
| Scheduled and event triggers | L2 triggers, specified in agent SPEC §15 but not built | Build them (schedule, alert fired, fill, earnings within N days) |
| Screening | Strategy plugins, `scan_strategies`, `size_position` (FR-4) | None; the cycle calls them |
| Analyst roles, debate, decision | Council: Business & Growth, Macro & Valuation and Portfolio Risk, a challenge round, chair (FEAT-002) | Add a structured `TradeProposal` output after the chair |
| Order gate, approval, limits, origin tagging, live updates | FEAT-012 `/api/paper/orders`, Kestrel tickets, settings, SSE, book mirror | Add bracket and trailing-stop orders and more limits (below) |
| Market data, quotes, history, alerts, Discover | FinSight server | None |

**External code considered**

- **Alpaca MCP server** ([alpacahq/alpaca-mcp-server](https://github.com/alpacahq/alpaca-mcp-server), MIT, Python, run with `uvx`): adopt it for **data only**. FinSight's server, not the agent, runs it with `ALPACA_PAPER_TRADE=true` and `ALPACA_TOOLSETS=stock-data,news,assets,corporate-actions`. A few of its tools are exposed to Kestrel through FinSight, so the keys stay in the server process. The `trading` and `account` toolsets are **not** given to Kestrel. If they were, orders would skip the user's approval, the limits, the origin tag, the book mirror and the audit log. Bracket and trailing orders are added to FinSight's own order path instead; Alpaca's REST API supports both. The MCP is optional: without Python or `uv`, FinSight works as today.
- **TradingAgents** (TauricResearch), **ai-hedge-fund** (virattt): use their pattern, not their code. The pattern is analysts, then a debate, then a trader, then a risk manager, then a portfolio manager. Both are Python and LangGraph and FinSight is Node and TypeScript. Kestrel's council already covers the analysts and the debate, with cost reservations and audit. The trader step becomes `TradeProposal`. The risk manager is the **deterministic** gate, not another model.
- **Infinite Bagholder** (Alpaca forum project): not used; AGPLv3.

## The cycle

`D` = deterministic code; `M` = model.

1. **Trigger (D).** A schedule (default: once a day, 60 min after the US open), an alert firing, a fill, earnings within N days, or **Run cycle now** on the desk. Each trigger enqueues at most one cycle per event key per day.
2. **Universe (D).** Paper positions and the watchlist, plus Discover movers if the user turns that on. The user can pin a fixed list.
3. **Screen and review (D).**
   - For new ideas: strategy scans, ranked into a shortlist of at most N symbols per cycle (default 5).
   - For held positions: stop or target reached, thesis re-check due, earnings ahead.
4. **Research (M).** The council runs on the shortlist, within a per-cycle spending cap set by the user.
5. **Decide (M, structured).** For each symbol, either a `TradeProposal` or "no trade" with the reason; no trade is the default. The proposal holds:
   - the symbol, side and order type
   - the size, taken from `size_position` and never typed by the model
   - entry, stop, target and expected holding days
   - the thesis and what would invalidate it
   - evidence references and the council run id
6. **Gate (D, FinSight server).** The existing ask/auto setting and limits, plus new optional limits, each off unless set:
   - a stop is required
   - maximum loss per trade, as a % of equity
   - maximum open positions
   - a daily drawdown kill switch
   - market hours only
   - no new entries within N days of earnings

   `ask` creates the pending ticket that already exists, showing the thesis.
7. **Execute (D).** A bracket order (entry, stop-loss and take-profit) on Alpaca paper, with an idempotency key per proposal so a retried task cannot place twice.
8. **Manage (D + M).** Alpaca holds the stop and the target. Each cycle re-checks the thesis of open positions. An exit is a `TradeProposal` like any other and goes through the same gate.
9. **Record and score (D).** A decision log entry stores the proposal, the model, the prices at decision time and the outcome. The scorecard compares results with SPY buy-and-hold over the same dates after costs, splits Kestrel's results from the user's, and separates market exposure from stock selection once enough days have passed. Backtests are not used as evidence.

## User controls (desk "Agent" tab)

- **Autonomy:** Off, Propose (each order asks first), or Auto within limits.
- **Settings:**
  - schedule
  - universe
  - shortlist size
  - per-cycle and daily spending caps
  - the new limits above
- **Pause all:** one button cancels Kestrel's open orders and stops new cycles. It leaves positions as they are.
- **Visibility:** the last cycles, with their trigger, the shortlist, the decisions with reasons, the orders placed and the cost, plus the scorecard.
- **Chat:** stays as it is. Asking Kestrel to trade in chat produces the same `TradeProposal` and goes through the same gate.

## Slices

1. Bracket and trailing-stop orders in FEAT-012's order path, a `TradeProposal` tool and a decision log.
2. The `paper-trade-cycle` workflow, run by hand with **Run cycle now**, and the Agent tab with the last runs.
3. L2 triggers (schedule, alert, fill, earnings), the kill switch and the new limits.
4. Scorecard: benchmark, Kestrel against the user, exposure against selection, and a `paper_performance` tool so Kestrel sees its own record.
5. The Alpaca MCP data proxy (optional): quotes and snapshots, news, corporate actions and the market calendar.

Live (real-money) trading is not in this plan. If it comes later, it reuses the same cycle and gate with a separate connector and separate settings.

## Open questions for the user

- The cycle time, in Singapore time. The default above is 60 minutes after the US open.
- The universe: holdings and watchlist only, or Discover movers too?
- Default spending caps per cycle and per day.
- Is the Alpaca MCP's data worth adding a Python and `uv` dependency? FinSight's Yahoo path already covers quotes and history.
