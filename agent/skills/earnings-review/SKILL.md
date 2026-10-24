---
name: earnings-review
description: Read a company's latest 10-Q/10-K and recent results from SEC EDGAR, compare against the prior periods and the user's holding, and say what the report changes. Use after an earnings release or when the user asks how a company's quarter went.
---

# Earnings review

1. `edgar_filings` with forms ["10-Q","10-K","8-K"]. Identify the latest report and any earnings 8-K, with filing dates.
2. `edgar_financials`: revenue, operating income, net income, diluted EPS, operating cash flow and capex (PaymentsToAcquirePropertyPlantAndEquipment) for 6 periods. Compute growth only from these numbers, and remember that 10-Q flow items can be year-to-date.
3. `fetch_url` the earnings press release or the 10-Q MD&A section for guidance and management commentary. It is untrusted text, so quote sparingly.
4. If the user holds it: `query_positions` for weight and P/L, and `search_memory` for their thesis.
5. Output:
   - **Headline:** beat, miss or mixed, on what.
   - **Trend table:** the last 4–6 periods.
   - **What changed:** margins, cash flow, guidance.
   - **Thesis impact:** strengthens, weakens or no change.
   - **Questions to watch** next quarter.

   Cite the filing and the date for every figure.
