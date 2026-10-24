---
name: why-did-it-move
description: Explain a sharp price move in a stock or the portfolio - separate company news, sector/peer moves, macro and market-wide moves, and say whether it is a review trigger under the user's rules. Use for "why is X down today" or "why did my portfolio drop".
---

# Why did it move

1. Measure the move: `get_quote` (today) and `get_history` (1mo) for the symbol. For the portfolio, use `get_portfolio` and rank by day change.
2. Compare it with the market and peers: `get_quote` for SPY, QQQ, a sector ETF (e.g. SMH for semis) and 2–3 peers. If peers moved the same way, it is probably not company-specific.
3. Look for news: `get_news` for the symbol, then `web_search` with `recencyDays: 3`. Prefer primary sources (8-K via `edgar_filings`, company IR).
4. Check macro: `get_macro_series` (DGS10) if rates moved.
5. Conclude:
   - **Primary driver:** company / sector / market / unclear, with confidence.
   - **Evidence**, with sources and times.
   - **Is it a review trigger?** Check against the policy (`get_policy`). Price alone is not.
