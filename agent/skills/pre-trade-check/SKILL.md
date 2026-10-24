---
name: pre-trade-check
description: Run the user's pre-trade checklist before any buy, add, trim or sell idea - objective fit, valuation, sizing from real cash, concentration, liquidity, costs and taxes, and what would prove the idea wrong. Use when the user says they are thinking of buying/selling something.
---

# Pre-trade check

Goal: give a pass / conditional pass / not yet verdict against the user's own rules. You never place trades; the user decides.

1. **Restate the idea** in one line: instrument, direction, rough size, reason.
2. **Rules:** call `get_policy`. Say which limits are *accepted* and which are only placeholders.
3. **Current exposure:** `query_positions` for the symbol and its sector, plus `get_exposures` (currency and sector). Note overlap with existing holdings (same theme, same customers/capex drivers).
4. **Size from real numbers:** if an entry and a stop exist, call `size_position`. Otherwise ask for the stop, or state the loss if the position falls 20% and 40%.
5. **Valuation and evidence:** for US stocks use `edgar_financials` (revenue, earnings and cash-flow trend). Use `web_search` only for recent material news, and cite every source.
6. **Timing risk:** `get_events` for earnings inside the expected holding window. If a strategy applies, run `run_strategy` and state its status and evidence.
7. **Costs and taxes:** mention FX conversion, commissions, and any tax consideration the user's profile flags (`get_profile`). Don't infer tax status.
8. **Verdict table:** each check with ✓ / ⚠ / ✗ and one line of evidence. Then add:
   - what would invalidate the idea;
   - whether "no action" is the better default.

Keep it under ~350 words unless the user asks for depth.
