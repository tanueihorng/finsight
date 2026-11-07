---
name: position-review
description: Deep review of one holding - why it is owned, current weight and P/L, fundamentals trend, what the strategy library says, risks, and a clear keep / review / reduce-candidate conclusion against the user's rules. Use for "review my NVDA position" or similar.
---

# Position review

1. **Position facts:** `query_positions` with the symbol. Report quantity, average cost, value, weight, unrealised P/L and FX P/L. Give the date.
2. **Context:** `search_memory` for the symbol (theses, past reviews, decisions) and `get_decisions`. Say if no written thesis exists. That is itself a finding.
3. **Fundamentals:** `edgar_financials` for US filers (last 4–6 quarters: revenue, operating income, EPS, operating cash flow). Describe the direction, not just the numbers. Then `dcf_valuation` (reverse DCF: what growth the price implies, compared with historical revenue CAGR) and `peer_comparison` against 2–4 named peers for multiples and margins.
4. **Price and technicals:** `technical_indicators` (moving averages, RSI, drawdown, return vs SPY), then `scan_strategies` with `scope: "symbols"` for this symbol. Report each strategy's stage with its status and evidence.
5. **Portfolio fit:** `get_exposures` by sector and currency. Does this holding drive concentration?
6. **Positioning:** `insider_trades` (open-market buys vs sells, 10b5-1 plans) and `short_interest` for US-listed stocks. Context, not a signal.
7. **Upcoming:** `get_events` for earnings and dividends.
8. **Conclusion:**
   - one of keep / review trigger / reduce candidate, with the rule it rests on;
   - what would change your mind;
   - what data is missing.

Never present a price move alone as a reason to act.
