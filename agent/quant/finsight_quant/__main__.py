"""Worker entry point: one JSON request on stdin, one JSON response on stdout."""
from __future__ import annotations

import json
import sys

from . import CONTRACT_VERSION
from .guard import install as install_guard
from .metrics import MIN_TRADES_FOR_EVIDENCE, activity, benchmark_curve, difference, performance, trading
from .portfolio import Config, ReplayError, replay
from .validation import validate

def run(request: dict) -> dict:
    if request.get("version") != CONTRACT_VERSION:
        raise ReplayError(f"unsupported contract version {request.get('version')}")
    if request.get("op") == "validate":
        return validate(request)
    cfg = request["config"]
    config = Config(cfg["initialCash"], cfg["positionPct"], cfg["maxPositions"], cfg["costBps"], cfg["extraSlippageBps"])
    calendar = request["calendar"]
    bars = request["bars"]

    result = replay(bars, request["candidates"], config, calendar)
    dates = [p["date"] for p in result["curve"]]
    strategy = performance(dates, [p["equity"] for p in result["curve"]], cfg["riskFreePct"])
    bench_curve, bench_price_only = benchmark_curve(request["benchmark"]["bars"], calendar, config.initial_cash)
    benchmark = performance(dates, bench_curve, cfg["riskFreePct"])

    warnings = []
    trades = trading(result)
    if trades["closedTrades"] < MIN_TRADES_FOR_EVIDENCE:
        warnings.append(f"Only {trades['closedTrades']} closed trades: too few to separate skill from chance.")
    skipped = result["rejected"]["max_positions"] + result["rejected"]["no_cash"]
    if skipped or result["reduced"]:
        warnings.append(f"{skipped} candidate trades were skipped and {result['reduced']} reduced for lack of cash or position slots, so the most-liquid-first ordering affects this result.")
    window = (calendar[0], calendar[-1])
    # A dividend is credited only between two bars that both have adjusted close,
    # so none in the window means none are counted, and a gap means some may be missing.
    in_window = {s: [bool(b.get("adj")) for b in rows if window[0] <= b["date"] <= window[1]] for s, rows in bars.items()}
    no_adj = sorted(s for s, has in in_window.items() if has and not any(has))
    some_adj = sorted(s for s, has in in_window.items() if any(has) and not all(has))
    if no_adj:
        warnings.append(f"No adjusted close for {', '.join(no_adj)}: dividends on these are not counted.")
    if some_adj:
        warnings.append(f"Adjusted close is missing on some days for {', '.join(some_adj)}: dividends on these may be incomplete.")
    if bench_price_only:
        warnings.append("No adjusted close for the benchmark: its return excludes dividends.")

    month_ends = [i for i, d in enumerate(dates) if i == len(dates) - 1 or dates[i + 1][:7] != d[:7]]
    return {
        "ok": True,
        "strategy": strategy,
        "benchmark": benchmark,
        "excess": {key: difference(strategy[key], benchmark[key]) for key in ("totalReturnPct", "cagrPct")},
        "trading": trades,
        "activity": activity(result, strategy["years"]),
        "rejected": result["rejected"],
        "reducedEntries": result["reduced"],
        "openPositions": result["open"],
        "reconciled": result["reconciled"],
        "monthlyEquity": [{"date": dates[i], "strategy": result["curve"][i]["equity"], "benchmark": bench_curve[i]} for i in month_ends],
        "recentFills": result["fills"][-20:],
        "warnings": warnings,
    }


def main() -> int:
    install_guard()
    try:
        response = run(json.load(sys.stdin))
    except (ReplayError, KeyError, TypeError, ValueError) as error:
        print(json.dumps({"ok": False, "code": "QUANT_INVALID", "error": f"{type(error).__name__}: {error}"}))
        return 0
    print(json.dumps(response, allow_nan=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
