"""Independent checks on the robustness studies.

Every study is recomputed from the written rules with the exact-Fraction
reference model and plain arithmetic. The bootstrap is compared with the `arch`
library and measured for coverage on series whose true growth rate is known.

Run: .venv-verify/bin/python -W ignore -m verify.check_validation [--fast]
"""
import json
import random
import statistics
import sys
from dataclasses import replace
from datetime import date
from hashlib import sha256
from math import sqrt

import numpy as np
from arch.bootstrap import StationaryBootstrap
from hypothesis import HealthCheck, given, settings

from finsight_quant.__main__ import run
from finsight_quant.portfolio import Config, ReplayError
from finsight_quant.metrics import difference
from finsight_quant.validation import assess, bootstrap_intervals, scaled_position_pct, stationary_indices, universe_halves
from verify.check_replay import calendar_of, scenarios
from verify.reference import reference_replay

TOLERANCE = 1e-6


class Mismatch(AssertionError):
    pass


def require(condition, message, context=None):
    if not condition:
        raise Mismatch(f"{message}\n  context: {context}")


def close(a, b):
    return abs(float(a) - float(b)) <= TOLERANCE * max(1.0, abs(float(b)))


def benchmark_rows(calendar):
    """A benchmark with one missing day, carried forward like any other gap."""
    return [{"date": d, "o": 100.0 + i, "h": 100.0 + i, "l": 100.0 + i, "c": 100.0 + i, "v": 1, "adj": (100.0 + i) * 1.01 ** i} for i, d in enumerate(calendar) if i != 1]


def plain_cagr(first, last, days):
    years = (date.fromisoformat(days[-1]) - date.fromisoformat(days[0])).days / 365.25
    try:
        return ((last / first) ** (1 / years) - 1) * 100
    except OverflowError:
        return None


def full_run(bars, candidates, config, calendar, bench):
    """Equity, benchmark level and trade dates, written out from the rules with none of the code under test."""
    ledger = reference_replay(bars, candidates, config, calendar)
    by_day = {b["date"]: b["adj"] for b in bench}
    levels, level = [], by_day[calendar[0]]
    for day in calendar:
        level = by_day.get(day, level)
        levels.append(level)
    closed = [(entry, leaving) for _, entry, leaving, _, _ in ledger["closed"]]
    return [float(point["equity"]) for point in ledger["ledger"]], levels, closed, [day for _, day, _ in ledger["open"]]


def expected_row(calendar, run, first, last, rf=0.0):
    equity, levels, closed, still_open = run
    equity, levels, days = equity[first:last + 1], levels[first:last + 1], calendar[first:last + 1]
    cagr, bench_cagr = plain_cagr(equity[0], equity[-1], days), plain_cagr(levels[0], levels[-1], days)
    worst = min(equity[j] / equity[i] - 1 for j in range(len(equity)) for i in range(j + 1))
    returns = [b / a - 1 for a, b in zip(equity, equity[1:])]
    deviation = statistics.stdev(returns) if len(returns) >= 2 else 0.0
    trades = sum(1 for entry, leaving in closed if entry <= days[-1] and leaving > days[0]) + sum(1 for entry in still_open if entry <= days[-1])
    return {"start": days[0], "end": days[-1], "tradingDays": len(days), "cagrPct": cagr, "benchmarkCagrPct": bench_cagr, "excessCagrPct": None if cagr is None or bench_cagr is None else cagr - bench_cagr,
            "maxDrawdownPct": worst * 100, "trades": trades, "sharpe": (statistics.mean(returns) - rf / 100 / 252) / deviation * sqrt(252) if deviation > 0 else None}


def same_row(got, want, context):
    if got is None or want is None:
        require(got is None and want is None, "a window exists on one side only", (got, want, context))
        return
    for key, value in want.items():
        if isinstance(value, float) and got[key] is not None:
            require(close(got[key], value), f"{key} differs", (got, want, context))
        else:
            require(got[key] == value, f"{key} differs", (got, want, context))


def request_for(bars, candidates, config, calendar, bench, rf=0.0):
    return {"version": 1, "op": "validate", "calendar": calendar, "bars": bars, "candidates": candidates, "benchmark": {"symbol": "SPY", "bars": bench},
            "config": {"initialCash": config.initial_cash, "positionPct": config.position_pct, "maxPositions": config.max_positions, "costBps": config.cost_bps, "extraSlippageBps": config.extra_slippage_bps, "riskFreePct": rf}}


def check_studies(bars, candidates, config, calendar):
    bench = benchmark_rows(calendar)
    result = run(request_for(bars, candidates, config, calendar, bench))
    context = (bars, candidates, config, calendar)
    symbols, n = sorted(bars), len(calendar)
    last = n - 1

    def run_on(chosen=symbols, extra=0.0, pct=None):
        keep = {s: bars[s] for s in chosen}
        settings = replace(config, extra_slippage_bps=config.extra_slippage_bps + extra, position_pct=config.position_pct if pct is None else pct)
        return full_run(keep, [c for c in candidates if c["symbol"] in keep], settings, calendar, bench)

    whole = run_on()

    def expected_window(first, final):
        return expected_row(calendar, whole, first, final) if final > first else None

    same_row(result["base"], expected_row(calendar, whole, 0, last), context)
    split = n * 7 // 10
    same_row(result["time"]["development"], expected_window(0, split), context)
    same_row(result["time"]["holdout"], expected_window(split, last), context)
    edges = [last * i // 4 for i in range(5)]
    require(len(result["time"]["periods"]) == 4, "there must be four periods", context)
    for got, a, b in zip(result["time"]["periods"], edges, edges[1:]):
        same_row(got, expected_window(a, b), context)

    # Periods are pieces of one run, so they must compound to the whole.
    pieces = [row for row in result["time"]["periods"] if row]
    if all(row["cagrPct"] is not None and 1 + row["cagrPct"] / 100 > 1e-6 for row in pieces):  # annualising a one-day crash lands too close to -100% to invert
        growth = np.prod([(1 + row["cagrPct"] / 100) ** ((date.fromisoformat(row["end"]) - date.fromisoformat(row["start"])).days / 365.25) for row in pieces])
        require(close(growth, whole[0][-1] / whole[0][0]), "periods do not compound to the whole run", context)

    def scaled(part):
        return min(100.0, config.position_pct * min(config.max_positions, len(symbols)) / min(config.max_positions, len(part)))

    ranked = sorted(symbols, key=lambda s: sha256(s.encode()).hexdigest())
    parts = [p for p in (sorted(ranked[0::2]), sorted(ranked[1::2])) if p]
    require([row["symbols"] for row in result["universe"]["halves"]] == parts, "universe halves are wrong", context)
    for row, part in zip(result["universe"]["halves"], parts):
        require(close(row["positionPct"], scaled(part)), "half position size is wrong", context)
        same_row(row, expected_row(calendar, run_on(part, pct=scaled(part)), 0, last), context)
    expected_removed = symbols if len(symbols) > 1 else []
    require([row["removed"] for row in result["universe"]["removals"]] == expected_removed, "removals are wrong", context)
    for row in result["universe"]["removals"]:
        part = [s for s in symbols if s != row["removed"]]
        require(close(row["positionPct"], scaled(part)), "removal position size is wrong", context)
        same_row(row, expected_row(calendar, run_on(part, pct=scaled(part)), 0, last), context)

    require([row["extraBpsPerSide"] for row in result["cost"]["grid"]] == [0.0, 5.0, 10.0, 25.0, 50.0, 100.0], "cost grid changed", context)
    for row in result["cost"]["grid"]:
        same_row(row, expected_row(calendar, run_on(extra=row["extraBpsPerSide"]), 0, last), context)
    survives = None
    for row in result["cost"]["grid"]:
        if (row["excessCagrPct"] or 0) <= 0:
            break
        survives = row["extraBpsPerSide"]
    require(result["cost"]["survivesExtraBpsPerSide"] == survives, "survival cost is wrong", context)

    # A period must not read anything after its last day.
    development = result["time"]["development"]
    if development and split + 1 < n:
        cut = calendar[split]
        later = {s: [b if b["date"] <= cut else {**b, "c": b["c"] * 3, "o": b["o"] * 3, "h": b["h"] * 3, "l": b["l"] * 3, "v": 7} for b in rows] for s, rows in bars.items()}
        moved = run(request_for(later, candidates, config, calendar, bench))["time"]["development"]
        require({k: v for k, v in moved.items() if k != "trades"} == {k: v for k, v in development.items() if k != "trades"}, "the development period read later data", context)

    shuffled_bars = dict(sorted(bars.items(), reverse=True))
    shuffled = list(candidates)
    random.Random(len(candidates)).shuffle(shuffled)
    if len({(c["symbol"], c["entryDate"]) for c in candidates}) == len(candidates):
        require(run(request_for(shuffled_bars, shuffled, config, calendar, bench)) == result, "the result depends on input order", context)


def check_small_helpers():
    require(difference(3.0, 1.0) == 2.0 and difference(None, 1.0) is None and difference(1.0, None) is None and difference(None, None) is None, "difference handles empty values wrongly", None)
    require(scaled_position_pct(10.0, 10, 13, 12) == 10.0, "a universe still above the slot limit should not be rescaled", None)
    require(close(scaled_position_pct(10.0, 10, 13, 7), 100 / 7), "a smaller universe should deploy the same capital", None)
    require(scaled_position_pct(60.0, 4, 4, 1) == 100.0, "a position cannot exceed the whole portfolio", None)


def check_halves():
    symbols = ["AAPL", "KO", "MSFT", "XOM", "JPM"]
    first, second = universe_halves(symbols)
    require(sorted(first + second) == sorted(symbols) and not set(first) & set(second), "halves must partition the universe", (first, second))
    require(abs(len(first) - len(second)) <= 1, "halves must be even", (first, second))
    require((first, second) == universe_halves(list(reversed(symbols))), "halves depend on input order", (first, second))


def row(excess=1.0, trades=30, days=126, **extra):
    return {"excessCagrPct": excess, "trades": trades, "tradingDays": days, **extra}


def statuses(**overrides):
    parts = {"base": row(), "holdout": row(), "periods": [row() for _ in range(4)], "halves": [row(), row()], "removals": [row()], "symbols": 4, "stress": 1.0, "lower": 0.5}
    parts.update(overrides)
    time = {"holdout": parts["holdout"], "periods": parts["periods"]}
    universe = {"halves": parts["halves"], "removals": parts["removals"]}
    cost = {"grid": [{"extraBpsPerSide": 10.0, "excessCagrPct": -9.0}, {"extraBpsPerSide": 25.0, "excessCagrPct": parts["stress"]}, {"extraBpsPerSide": 50.0, "excessCagrPct": -9.0}]}
    interval = None if parts["lower"] is None else [parts["lower"], 9.0]
    return {c["id"]: c["status"] for c in assess(parts["base"], time, universe, cost, {"intervals": {"excessCagrPct": interval}}, parts["symbols"])}


def check_assessment():
    """Every threshold, tested on both sides of its boundary."""
    require(set(statuses().values()) == {"pass"} and len(statuses()) == 6, "the passing case should pass all six", statuses())
    cases = [
        ("time_holdout", {"holdout": row(excess=0.0)}, "fail"), ("time_holdout", {"holdout": row(trades=29)}, "insufficient"), ("time_holdout", {"holdout": row(days=125)}, "insufficient"), ("time_holdout", {"holdout": None}, "insufficient"),
        ("time_consistency", {"periods": [row(), row(), row(), row(excess=0.0)]}, "pass"), ("time_consistency", {"periods": [row(), row(), row(excess=0.0), row(excess=-1.0)]}, "fail"),
        ("time_consistency", {"periods": [row(), row(), row(), row(days=125)]}, "insufficient"), ("time_consistency", {"periods": [row(), row(), row(), None]}, "insufficient"), ("time_consistency", {"periods": [row(trades=1) for _ in range(4)]}, "pass"),
        ("universe_halves", {"halves": [row(), row(excess=0.0)]}, "fail"), ("universe_halves", {"halves": [row(excess=0.0), row()]}, "fail"), ("universe_halves", {"halves": [row(), row(trades=29)]}, "insufficient"), ("universe_halves", {"halves": [row(trades=29), row()]}, "insufficient"), ("universe_halves", {"symbols": 3}, "insufficient"),
        ("single_name_dependence", {"removals": [row(), row(excess=0.0)]}, "fail"), ("single_name_dependence", {"removals": [row(excess=0.0), row()]}, "fail"), ("single_name_dependence", {"symbols": 2}, "insufficient"), ("single_name_dependence", {"symbols": 3}, "pass"), ("single_name_dependence", {"base": row(trades=29)}, "insufficient"),
        ("time_holdout", {"holdout": row(excess=None)}, "fail"), ("cost_stress", {"stress": None}, "fail"),
        ("cost_stress", {"stress": 0.0}, "fail"), ("cost_stress", {"base": row(trades=29)}, "insufficient"), ("cost_stress", {"base": row(trades=30)}, "pass"),
        ("bootstrap_excess", {"lower": 0.0}, "fail"), ("bootstrap_excess", {"lower": None}, "fail"), ("bootstrap_excess", {"base": row(trades=29)}, "insufficient"), ("bootstrap_excess", {"base": row(days=125)}, "insufficient"), ("bootstrap_excess", {"base": row(days=126)}, "pass"),
    ]
    for check_id, overrides, expected in cases:
        got = statuses(**overrides)
        require(got[check_id] == expected, f"{check_id} should be {expected}", (overrides, got))


def plain_statistics(strategy, benchmark, years):
    growth = np.prod(1 + strategy) ** (1 / years) - 1
    drag = np.prod(1 + benchmark) ** (1 / years) - 1
    levels = np.concatenate([[1.0], np.cumprod(1 + strategy)])
    return growth * 100, (growth - drag) * 100, np.mean(strategy) / np.std(strategy, ddof=1) * sqrt(252), (levels / np.maximum.accumulate(levels) - 1).min() * 100


def check_against_arch(seed):
    rng = np.random.default_rng(seed)
    noise = rng.normal(0, 0.012, 1000)
    strategy, benchmark = np.empty(1000), 0.6 * noise + rng.normal(0.0004, 0.006, 1000)
    strategy[0] = noise[0]
    for t in range(1, 1000):
        strategy[t] = 0.0006 + 0.2 * (strategy[t - 1] - 0.0006) + noise[t]
    years = 1000 / 252
    got = bootstrap_intervals(strategy, benchmark, years, 0.0, 4000, 21, seed)
    sampler = StationaryBootstrap(21, strategy, benchmark, seed=np.random.default_rng(seed + 1))
    draws = np.array([plain_statistics(pos[0], pos[1], years) for pos, _ in sampler.bootstrap(4000)])
    for column, name in enumerate(("cagrPct", "excessCagrPct", "sharpe", "maxDrawdownPct")):
        low, high = np.percentile(draws[:, column], [2.5, 97.5])
        allowance = 0.08 * (high - low)
        require(abs(got[name][0] - low) <= allowance and abs(got[name][1] - high) <= allowance, f"{name} disagrees with arch", (got[name], low, high))
    share = float(np.mean(draws[:, 1] > 0) * 100)
    require(abs(got["shareOfResamplesAboveBenchmarkPct"] - share) <= 3.0, "share above benchmark disagrees with arch", (got, share))


def check_bootstrap_structure():
    rng = np.random.default_rng(5)
    indices = stationary_indices(1000, 2000, 21, rng)
    steps = np.diff(indices, axis=1)
    continuing = (steps == 1) | (steps == -999)
    require(abs(1 - continuing.mean() - 1 / 21) < 0.0012, "expected block length is not 21 days", 1 - continuing.mean())
    counts = np.bincount(indices.ravel(), minlength=1000)
    require(counts.min() > 0.9 * counts.mean() and counts.max() < 1.1 * counts.mean(), "days are not sampled evenly", (counts.min(), counts.max()))
    first_column = np.bincount(indices[:, 0], minlength=1000)
    require(np.count_nonzero(first_column) > 800, "start days are not spread out", np.count_nonzero(first_column))

    series = np.random.default_rng(6).normal(0.0005, 0.01, 400)
    same = bootstrap_intervals(series, series, 400 / 252, 0.0, 300, 21, 9)
    require(max(abs(v) for v in same["excessCagrPct"]) < 1e-9 and same["shareOfResamplesAboveBenchmarkPct"] == 0.0, "a series against itself must have zero excess", same)
    again = bootstrap_intervals(series, series * 0.5, 400 / 252, 1.0, 300, 21, 9)
    require(again == bootstrap_intervals(series, series * 0.5, 400 / 252, 1.0, 300, 21, 9), "the bootstrap must repeat for one seed", again)
    require(again != bootstrap_intervals(series, series * 0.5, 400 / 252, 1.0, 300, 21, 10), "the seed must matter", again)
    flat = bootstrap_intervals(np.zeros(50), np.zeros(50), 50 / 252, 0.0, 50, 5, 1)
    require(flat["sharpe"] is None and flat["cagrPct"] == [0.0, 0.0], "a flat series has no Sharpe", flat)
    json.dumps(flat, allow_nan=False)

    # A risk-free rate lowers the Sharpe interval by a known amount only through the numerator.
    without = bootstrap_intervals(series, series * 0, 400 / 252, 0.0, 300, 21, 9)["sharpe"]
    with_rate = bootstrap_intervals(series, series * 0, 400 / 252, 5.0, 300, 21, 9)["sharpe"]
    require(with_rate[0] < without[0] and with_rate[1] < without[1], "the risk-free rate must lower Sharpe", (without, with_rate))


def same_interval(got, want, context):
    if want is None:
        require(got is None, "an interval should be empty", (got, want, context))
    else:
        require(close(got[0], want[0]) and close(got[1], want[1]), "an interval differs", (got, want, context))


def check_bootstrap_arithmetic():
    """Each statistic recomputed path by path in ordinary Python, from the same resampled days."""
    strategy = np.random.default_rng(12).normal(0.0007, 0.011, 120)
    benchmark = np.random.default_rng(13).normal(0.0003, 0.008, 120)
    resamples, years, rf = 250, 0.47, 3.0
    got = bootstrap_intervals(strategy, benchmark, years, rf, resamples, 21, 77)
    indices = stationary_indices(120, resamples, 21, np.random.default_rng(77))
    rows = []
    for path in indices:
        chosen, level, peak, worst, growth, bench_growth = [float(strategy[i]) for i in path], 1.0, 1.0, 0.0, 1.0, 1.0
        for i in path:
            growth *= 1 + float(strategy[i])
            bench_growth *= 1 + float(benchmark[i])
            level *= 1 + float(strategy[i])
            peak = max(peak, level)
            worst = min(worst, level / peak - 1)
        cagr, bench_cagr = (growth ** (1 / years) - 1) * 100, (bench_growth ** (1 / years) - 1) * 100
        rows.append((cagr, cagr - bench_cagr, (statistics.mean(chosen) - rf / 100 / 252) / statistics.stdev(chosen) * sqrt(252), worst * 100))
    table = np.array(rows)
    for column, name in enumerate(("cagrPct", "excessCagrPct", "sharpe", "maxDrawdownPct")):
        same_interval(got[name], list(np.percentile(table[:, column], [2.5, 97.5])), name)
    require(close(got["shareOfResamplesAboveBenchmarkPct"], sum(1 for row in rows if row[1] > 0) / resamples * 100), "share above benchmark is wrong", got)


def check_long_study():
    """A study long enough to separate the window arithmetic, with a risk-free rate and a real bootstrap."""
    n, rf = 100, 3.0
    calendar = calendar_of(n)
    rng = random.Random(3)
    bars = {}
    for symbol in "ABCDE":
        price, rows = 50.0, []
        for day in calendar:
            price = round(price * rng.uniform(0.98, 1.025), 2)
            rows.append({"date": day, "o": price, "h": price, "l": price, "c": price, "v": rng.randint(1, 900), "adj": price})
        bars[symbol] = rows
    candidates = [{"symbol": s, "entryDate": calendar[i], "entry": bars[s][i]["o"], "stop": 1.0, "exits": [{"date": calendar[i + 9], "px": bars[s][i + 9]["o"], "qty": 1.0, "why": "x"}]}
                  for i in range(5, 85, 12) for s in "ABC"]
    config = replace(CONFIG, position_pct=15.0)
    bench = benchmark_rows(calendar)
    out = run(request_for(bars, candidates, config, calendar, bench, rf))
    whole = full_run(bars, candidates, config, calendar, bench)
    same_row(out["base"], expected_row(calendar, whole, 0, n - 1, rf), "base")
    same_row(out["time"]["holdout"], expected_row(calendar, whole, 70, n - 1, rf), "holdout")
    same_row(out["time"]["development"], expected_row(calendar, whole, 0, 70, rf), "development")
    for row, (a, b) in zip(out["time"]["periods"], ((0, 24), (24, 49), (49, 74), (74, 99))):
        same_row(row, expected_row(calendar, whole, a, b, rf), (a, b))
    equity, levels = np.array(whole[0]), np.array(levels_of(whole))
    years = (date.fromisoformat(calendar[-1]) - date.fromisoformat(calendar[0])).days / 365.25
    want = bootstrap_intervals(equity[1:] / equity[:-1] - 1, levels[1:] / levels[:-1] - 1, years, rf, 2000, 21, 20261110)
    got = out["bootstrap"]["intervals"]
    for name in ("cagrPct", "excessCagrPct", "sharpe", "maxDrawdownPct"):
        same_interval(got[name], want[name], name)
    require(close(got["shareOfResamplesAboveBenchmarkPct"], want["shareOfResamplesAboveBenchmarkPct"]), "share above benchmark is wrong", got)
    require("95%" in next(c["detail"] for c in out["checks"] if c["id"] == "bootstrap_excess"), "the interval size is misreported", out["checks"])


def check_trade_windows():
    """A trade that left at the close of a window's first day held nothing during the window."""
    calendar = calendar_of(10)
    rows = [{"date": d, "o": 10.0, "h": 10.0, "l": 10.0, "c": 10.0, "v": 1, "adj": 10.0} for d in calendar]
    def trade(entry, leaving):
        return {"symbol": "A", "entryDate": calendar[entry], "entry": 10.0, "stop": 1.0, "exits": [{"date": calendar[leaving], "px": 9.9, "qty": 1.0, "why": "x"}]}
    out = run(request_for({"A": rows}, [trade(1, 1), trade(2, 7), trade(8, 8)], CONFIG, calendar, benchmark_rows(calendar)))
    require(out["base"]["trades"] == 3, "a same-day trade on the first tradable day was missed", out["base"])
    require(out["time"]["holdout"]["trades"] == 1, "a trade that ended on the window's first day was counted", out["time"]["holdout"])


def ar_series(rng, n, mean, phi, sd):
    shocks = rng.normal(0, sd, n)
    out = np.empty(n)
    previous = 0.0
    for t in range(n):
        previous = phi * previous + shocks[t]
        out[t] = mean + previous
    return out


def check_coverage(trials):
    """A 95% interval should contain the true growth rate about 95% of the time."""
    mean, phi, sd, n = 0.0005, 0.3, 0.01, 750
    long_run = ar_series(np.random.default_rng(1), 4_000_000, mean, phi, sd)
    truth = (np.exp(252 * np.mean(np.log1p(long_run))) - 1) * 100
    rng, hits = np.random.default_rng(2), 0
    zeros = np.zeros(n)
    for trial in range(trials):
        low, high = bootstrap_intervals(ar_series(rng, n, mean, phi, sd), zeros, n / 252, 0.0, 400, 21, trial)["excessCagrPct"]
        hits += low <= truth <= high
    coverage = hits / trials
    floor_, ceiling = (0.86, 0.99) if trials >= 300 else (0.75, 1.0)
    require(floor_ <= coverage <= ceiling, "bootstrap coverage is off", (coverage, truth))
    return coverage


CONFIG = Config(10000.0, 10.0, 10, 0.0, 0.0)


def levels_of(run_values):
    return run_values[1]


def check_contract():
    days = calendar_of(8)
    bars = {"A": [{"date": d, "o": 10.0, "h": 10.0, "l": 10.0, "c": 10.0, "v": 1, "adj": 10.0} for d in days]}
    config = {"initialCash": 1000.0, "positionPct": 10.0, "maxPositions": 2, "costBps": 0.0, "extraSlippageBps": 0.0, "riskFreePct": 0.0}
    request = {"version": 1, "op": "validate", "calendar": days, "bars": bars, "candidates": [], "benchmark": {"symbol": "SPY", "bars": benchmark_rows(days)}, "config": config}
    out = run(request)
    require(out["ok"] is True and {c["status"] for c in out["checks"]} == {"insufficient"}, "an empty run has no evidence", out["checks"])
    require(out["universe"]["removals"] == [] and len(out["universe"]["halves"]) == 1, "one symbol cannot be removed or halved", out["universe"])
    design = {"holdoutPercent": 30, "periods": 4, "periodsToPass": 3, "minDays": 126, "minTrades": 30, "costStressBps": 25.0}
    require(out["design"] == design, "declared design changed", out["design"])
    boot = out["bootstrap"]
    require((boot["resamples"], boot["expectedBlockDays"], boot["seed"], boot["confidencePct"]) == (2000, 21, 20261110, 95.0), "bootstrap settings changed", boot)
    plain = run({**request, "op": None})
    require("base" not in plain and "strategy" in plain, "only the validate op runs validation", list(plain))
    try:
        run({**request, "version": 2})
    except ReplayError:
        return
    raise Mismatch("a wrong contract version was accepted")


def main():
    fast = "--fast" in sys.argv
    examples = 40 if fast else 400
    verified = given(scenarios())(settings(max_examples=examples, deadline=None, derandomize=True, database=None, suppress_health_check=list(HealthCheck))(lambda s: check_studies(*s)))
    verified()
    check_small_helpers()
    check_halves()
    check_assessment()
    check_contract()
    check_bootstrap_structure()
    check_bootstrap_arithmetic()
    check_long_study()
    check_trade_windows()
    check_against_arch(31)
    coverage = check_coverage(60 if fast else 400)
    print(f"OK: {examples} generated studies match the reference, every threshold tested both sides, bootstrap agrees with arch, coverage {coverage:.1%}")


if __name__ == "__main__":
    main()
