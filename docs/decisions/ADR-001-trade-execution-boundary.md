# ADR-001: Separation of Research Agency from Autonomous Trade Execution

- **Status:** Accepted
- **Date:** 2026-10-26
- **Basis:** Existing root agent instructions and agent specification; this document grants no new authority.

---

## Context
When building an AI investment research assistant (Kestrel) inside FinSight, there is a recurring temptation to grant the agent live broker API keys to autonomously execute buy/sell orders.

---

## Decision
**The AI agent (Kestrel) will NEVER possess autonomous trade execution authority.**

Specifically:
1. **No Autonomous API Triggers:** The model cannot directly dispatch financial orders to brokers (IBKR, Alpaca, etc.) . A PIN alone does not grant Kestrel broker execution authority.
2. **Untrusted Data Defense:** All web articles, SEC filings, news feeds, and uploaded files are treated as untrusted data. An indirect prompt injection must never have a code path to trigger financial capital movements.
3. **Staged Order Tickets Only:** When an idea passes policy checks, the agent may only format an interactive **Staged Order Ticket** (symbol, limit price, quantity, stop-loss).
4. **Mandatory Human Signature:** The user executes in their broker interface. Any future broker routing requires a separately selected, reviewed design; it is not authorized by this document.
5. **Algorithmic vs. Agentic Separation:** This document authorizes no recurring rebalancing, scripts, schedules or broker integration.

---

## Consequences
- **Positive:** Limits execution authority and reduces exposure to agent errors; it does not guarantee prevention of prompt injection or financial loss.
- **Negative:** Slightly higher user friction (user must click "Approve" or submit on the broker screen).
- **Compliance:** Restates the no-execution boundary in [AGENTS.md](../../AGENTS.md). Personal policy records are external to this repository.
