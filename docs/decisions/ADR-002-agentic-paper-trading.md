# ADR-002: Kestrel may place orders on a paper trading account

- **Status:** Accepted by the owner
- **Date:** 2026-10-31
- **Amends:** [ADR-001](ADR-001-trade-execution-boundary.md) for paper trading only. Spec: [FEAT-011](../features/FEAT-011-paper-trading.md).

---

## Context
The owner wants to work towards agentic trading, starting with an Alpaca paper account (fake money). ADR-001 forbids the agent from dispatching orders to any broker and limits it to staged tickets.

## Decision
1. **Paper orders are allowed.** Kestrel may place and cancel orders on the Alpaca *paper* account through FinSight's paper order endpoint, and may read the paper book.
2. **The user sets the autonomy.** A paper setting chooses `ask` (each Kestrel order is a pending ticket the user approves or rejects; the default) or `auto` (Kestrel's orders are sent immediately), plus optional limits (order value, orders per day, position weight, symbol allowlist). Limits are checked by code before an order leaves FinSight. Only the user, through a PIN session, can change these settings.
3. **Paper only.** FinSight holds only paper keys and only the paper API base URL. Nothing in this decision authorizes real-money orders; ADR-001 continues to apply in full to the real portfolio and to any live broker.
4. **Traceability.** Every order records whether the user or Kestrel placed it, and Kestrel's thread.

## Consequences
- Kestrel can act on its research in the paper book, which lets the owner evaluate agentic trading without risking money.
- In `auto`, content Kestrel reads (web pages, filings, uploads) can influence paper orders; the user-set limits and the paper-only boundary bound that.
- Moving any part of this to live trading needs a new decision record.
