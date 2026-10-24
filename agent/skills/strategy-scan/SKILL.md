---
name: strategy-scan
description: Scan the user's holdings or watchlist with every mechanical strategy in their library, rank live setups, and size the top ones from real cash with event checks. Use for "any setups today?" or "what do my strategies say about my holdings".
---

# Strategy scan

1. `list_strategies` and note each one's status and evidence. None is an instruction unless its status is "accepted".
2. `scan_strategies` (scope from the request; default holdings, onlyLive true).
3. For the top 3 live setups:
   - `size_position` using the setup's trigger as entry and its stop;
   - `get_events` to check for earnings before a likely exit.
4. Output a table: symbol · strategy (status) · stage · trigger / stop · suggested size and cost · warnings. Below it, one line per strategy giving its historical edge, and a reminder that these are research signals.
5. If nothing is live, say so plainly; that is a valid answer.
