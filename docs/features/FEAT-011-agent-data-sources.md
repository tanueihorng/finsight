# FEAT-011: Agent Data Sources (APIs and MCP servers)

- **ID:** FEAT-011
- **Status:** Deferred proposal; not selected for implementation · 2026-10-31
- **Related:** [FEAT-012](FEAT-012-paper-trading.md) paper trading (Alpaca), [FEAT-013](FEAT-013-agentic-trading.md) agentic trading plan; FEAT-001 (IBKR MCP); FEAT-010 (Discover)

## Intent

Give Kestrel and a future paper-trading agent more evidence than Yahoo, SEC EDGAR, FRED and Nasdaq provide
today: insider and institutional positioning, short interest, company news, a second fundamentals source and
global event coverage. These sources are data only; none of them places orders.

Sentiment scoring (FinBERT or provider sentiment fields) is excluded from this proposal by the user's choice.

## Candidate sources

Free-tier limits and terms below come from vendor pages as of 2026-10-31 and must be rechecked when selected.

| Need | Source | Access | Notes |
|---|---|---|---|
| Insider trades, 13F holdings, congressional trades, short interest, fails-to-deliver | [Equibles](https://equibles.com/docs) | REST + MCP server, free key, ~100 requests/day shared | Primary candidate; one key covers four datasets |
| Same datasets, fallback | [Xoomar](https://pypi.org/project/xoomar/) | REST, free key ~120 requests/min; 30/min per IP without key | Also lists options data; depth unverified |
| Company news | Finnhub, Alpha Vantage | REST, free key | News headlines and links only; do not ingest sentiment fields |
| Fundamentals cross-check | Financial Modeling Prep | REST, free key | Second source to cross-validate Yahoo figures |
| Global news events | GDELT | REST, key-less | Current terms and rate limits unverified |
| Filings, financial statements, insider data | [stefanoamorelli/sec-edgar-mcp](https://github.com/stefanoamorelli/sec-edgar-mcp), [StockScope MCP](https://glama.ai/mcp/servers/Stewyboy1990/stockscope-mcp), [OctagonAI/octagon-mcp-server](https://github.com/OctagonAI/octagon-mcp-server) | MCP | Compare against FinSight's own EDGAR code before adopting; Octagon's key requirement unverified |

## Proposed requirements

- [ ] Each source is a Kestrel tool (direct REST adapter or MCP client) with `asOf` / `retrievedAt`, source URL and explicit failure states.
- [ ] Provider keys live in `~/FinSightData/`, never in the repo or browser code.
- [ ] Caching respects each free tier's daily or per-minute limit; a quota hit is reported, not hidden.
- [ ] Numbers that overlap existing sources (fundamentals, insider data) are cross-checked and disagreements shown.
- [ ] Python-only MCP servers run as external processes; FinSight stays Node/TypeScript.
- [ ] The paper-trading agent can call these tools once that work lands.

## Evaluating the paper-trading agent

References for judging whether paper results justify replaying a strategy on the live account. Trading is
medium term (days to about two months), so the evaluation favours multi-month runs over intraday metrics.

| Reference | What it offers |
|---|---|
| [StockBench](https://github.com/ChenYXxxx/stockbench) ([paper](https://www.alphaxiv.org/abs/2510.02209)) | Multi-month trading evaluation on data the models cannot have memorised; closest to the medium-term holding style |
| [Look-Ahead-Bench](https://github.com/benstaf/lookaheadbench) | Tests whether returns come from future knowledge absorbed in training; any backtest dated before the model's knowledge cutoff can look better than it is |
| [DeepFund](https://github.com/HKUSTDial/DeepFund), [LiveTradeBench](https://github.com/ulab-uiuc/live-trade-bench) | Live-market agent arenas that avoid memorisation; templates for scoring the paper-trading agent |
| [The Alpha Illusion](https://www.alphaxiv.org/abs/2605.16895v1) | Argues reported LLM-agent alpha is not deployment evidence |
| [KTD-Fin](https://econpapers.repec.org/paper/arxpapers/2605.28359.htm) | Found most agent returns came from market and style exposure, not stock selection |

Together these support comparing every paper result against a benchmark (for example buy-and-hold over the
same period, after costs) and treating backtests before the model's knowledge cutoff as unreliable.

## Open questions

- Which sources to take first (suggested: Equibles, then the EDGAR MCP comparison).
- Whether Xoomar or FMP is worth a second key given overlap.
- Licensing for any public or commercial release; most free tiers are personal or non-commercial.
