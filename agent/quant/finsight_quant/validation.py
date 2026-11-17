"""Robustness checks on a strategy whose rules are frozen.

Nothing here fits a parameter. Each study replays the same candidate trades on
part of the history, part of the universe or at higher cost, then asks whether
the result against the benchmark holds. The thresholds are fixed in this file so
a run cannot choose the test it passes.
"""
from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import date
from hashlib import sha256
from math import sqrt

import numpy as np

from .metrics import MIN_TRADES_FOR_EVIDENCE, TRADING_DAYS, benchmark_curve, difference, performance
from .portfolio import Config, replay

HOLDOUT_PERCENT = 30
PERIODS = 4
PERIODS_TO_PASS = 3
MIN_DAYS = 126
MIN_SYMBOLS_FOR_HALVES = 4
MIN_SYMBOLS_FOR_REMOVAL = 3
COST_GRID_BPS = (0.0, 5.0, 10.0, 25.0, 50.0, 100.0)
COST_STRESS_BPS = 25.0
RESAMPLES = 2000
BLOCK_DAYS = 21
SEED = 20261110
LOWER_PERCENTILE, UPPER_PERCENTILE = 2.5, 97.5


@dataclass(frozen=True)
class Study:
    bars: dict
    candidates: list
    config: Config
    calendar: list
    benchmark: list
    risk_free_pct: float


def _trades_during(result: dict, start: str, end: str) -> int:
    """Trades holding a position at some point after the close of the first day."""
    closed = sum(1 for t in result["closed"] if t["entryDate"] <= end and t["exitDate"] > start)
    return closed + sum(1 for p in result["open"] if p["entryDate"] <= end)


def _row(days: list[str], equity: list[float], bench: list[float], risk_free_pct: float, trades: int) -> dict:
    strategy_stats = performance(days, equity, risk_free_pct)
    bench_stats = performance(days, bench, risk_free_pct)
    return {
        "start": days[0], "end": days[-1], "tradingDays": len(days),
        "cagrPct": strategy_stats["cagrPct"], "benchmarkCagrPct": bench_stats["cagrPct"],
        "excessCagrPct": difference(strategy_stats["cagrPct"], bench_stats["cagrPct"]),
        "sharpe": strategy_stats["sharpe"], "benchmarkSharpe": bench_stats["sharpe"],
        "maxDrawdownPct": strategy_stats["maxDrawdownPct"], "trades": trades,
    }


def evaluate(study: Study, symbols: list[str], extra_bps: float = 0.0, position_pct: float | None = None) -> tuple[dict, list[float], list[float], dict]:
    """One replay on the given symbols, compared with the benchmark over the same days."""
    held = set(symbols)
    config = replace(study.config, extra_slippage_bps=study.config.extra_slippage_bps + extra_bps,
                     position_pct=study.config.position_pct if position_pct is None else position_pct)
    result = replay({s: study.bars[s] for s in symbols}, [c for c in study.candidates if c["symbol"] in held], config, study.calendar)
    equity = [point["equity"] for point in result["curve"]]
    bench, _ = benchmark_curve(study.benchmark, study.calendar, config.initial_cash)
    days = study.calendar
    return _row(days, equity, bench, study.risk_free_pct, _trades_during(result, days[0], days[-1])), equity, bench, result


def scaled_position_pct(position_pct: float, max_positions: int, full: int, part: int) -> float:
    """Position size that lets a smaller universe deploy as much capital as the full one."""
    return min(100.0, position_pct * min(max_positions, full) / min(max_positions, part))


def universe_halves(symbols: list[str]) -> tuple[list[str], list[str]]:
    """Splits by symbol hash: repeatable, and unrelated to name, size or sector."""
    ranked = sorted(symbols, key=lambda s: sha256(s.encode()).hexdigest())
    return sorted(ranked[0::2]), sorted(ranked[1::2])


def stationary_indices(n: int, resamples: int, block_days: int, rng: np.random.Generator) -> np.ndarray:
    """Politis-Romano stationary bootstrap: runs of consecutive days with geometric lengths."""
    indices = np.empty((resamples, n), dtype=np.int64)
    indices[:, 0] = rng.integers(n, size=resamples)
    for t in range(1, n):
        restart = rng.random(resamples) < 1 / block_days
        indices[:, t] = np.where(restart, rng.integers(n, size=resamples), (indices[:, t - 1] + 1) % n)
    return indices


def _interval(values: np.ndarray) -> list[float] | None:
    finite = values[np.isfinite(values)]
    return [float(v) for v in np.percentile(finite, [LOWER_PERCENTILE, UPPER_PERCENTILE])] if finite.size else None


def bootstrap_intervals(strategy: np.ndarray, benchmark: np.ndarray, years: float, risk_free_pct: float, resamples: int, block_days: int, seed: int) -> dict:
    """Resamples the same days for both series, so their relationship is preserved."""
    indices = stationary_indices(strategy.size, resamples, block_days, np.random.default_rng(seed))
    paths, bench_paths = strategy[indices], benchmark[indices]
    cagr = (np.prod(1 + paths, axis=1) ** (1 / years) - 1) * 100
    bench_cagr = (np.prod(1 + bench_paths, axis=1) ** (1 / years) - 1) * 100
    excess = cagr - bench_cagr
    daily_excess = paths - risk_free_pct / 100 / TRADING_DAYS
    with np.errstate(divide="ignore", invalid="ignore"):
        sharpe = np.mean(daily_excess, axis=1) / np.std(paths, axis=1, ddof=1) * sqrt(TRADING_DAYS)
    levels = np.concatenate([np.ones((resamples, 1)), np.cumprod(1 + paths, axis=1)], axis=1)
    drawdown = (levels / np.maximum.accumulate(levels, axis=1) - 1).min(axis=1) * 100
    return {
        "cagrPct": _interval(cagr), "excessCagrPct": _interval(excess), "sharpe": _interval(sharpe), "maxDrawdownPct": _interval(drawdown),
        "shareOfResamplesAboveBenchmarkPct": float(np.mean(excess > 0) * 100),
    }


def _check(check_id: str, enough: bool, passed: bool, detail: str) -> dict:
    return {"id": check_id, "status": "insufficient" if not enough else "pass" if passed else "fail", "detail": detail}


def _beats(row: dict | None) -> bool:
    return row is not None and row["excessCagrPct"] is not None and row["excessCagrPct"] > 0


def _solid(row: dict | None) -> bool:
    return row is not None and row["tradingDays"] >= MIN_DAYS and row["trades"] >= MIN_TRADES_FOR_EVIDENCE


def assess(base: dict, time: dict, universe: dict, cost: dict, bootstrap: dict, symbol_count: int) -> list[dict]:
    """Turns the studies into fixed pass, fail or insufficient results."""
    holdout, periods = time["holdout"], time["periods"]
    halves, removals = universe["halves"], universe["removals"]
    stress = next(row for row in cost["grid"] if row["extraBpsPerSide"] == COST_STRESS_BPS)
    interval = bootstrap["intervals"]["excessCagrPct"]
    beating = sum(1 for row in periods if _beats(row))
    enough_base = base["trades"] >= MIN_TRADES_FOR_EVIDENCE
    return [
        _check("time_holdout", _solid(holdout), _beats(holdout),
               f"The last {HOLDOUT_PERCENT}% of the window must beat the benchmark, with at least {MIN_DAYS} days and {MIN_TRADES_FOR_EVIDENCE} trades."),
        _check("time_consistency", all(row is not None and row["tradingDays"] >= MIN_DAYS for row in periods), beating >= PERIODS_TO_PASS,
               f"At least {PERIODS_TO_PASS} of {PERIODS} equal periods must beat the benchmark. {beating} did."),
        _check("universe_halves", symbol_count >= MIN_SYMBOLS_FOR_HALVES and all(row["trades"] >= MIN_TRADES_FOR_EVIDENCE for row in halves),
               all(_beats(row) for row in halves), f"Both halves of the universe must beat the benchmark, each with at least {MIN_TRADES_FOR_EVIDENCE} trades."),
        _check("single_name_dependence", symbol_count >= MIN_SYMBOLS_FOR_REMOVAL and enough_base, all(_beats(row) for row in removals),
               "The portfolio must still beat the benchmark with any one symbol removed."),
        _check("cost_stress", enough_base, _beats(stress), f"The portfolio must still beat the benchmark with {COST_STRESS_BPS:g} bps extra per side."),
        _check("bootstrap_excess", enough_base and base["tradingDays"] >= MIN_DAYS, interval is not None and interval[0] > 0,
               f"The lower end of the {UPPER_PERCENTILE - LOWER_PERCENTILE:g}% interval for excess CAGR must be above zero."),
    ]


def validate(request: dict) -> dict:
    cfg = request["config"]
    study = Study(request["bars"], request["candidates"], Config(cfg["initialCash"], cfg["positionPct"], cfg["maxPositions"], cfg["costBps"], cfg["extraSlippageBps"]),
                  request["calendar"], request["benchmark"]["bars"], cfg["riskFreePct"])
    symbols, calendar = sorted(study.bars), study.calendar
    n = len(calendar)
    base, equity, bench, result = evaluate(study, symbols)

    def window(first: int, last: int) -> dict | None:
        """A slice of the one continuous run, so positions carry in and periods compound to the whole."""
        if last <= first:
            return None
        days = calendar[first:last + 1]
        return _row(days, equity[first:last + 1], bench[first:last + 1], study.risk_free_pct, _trades_during(result, days[0], days[-1]))

    split = n * (100 - HOLDOUT_PERCENT) // 100
    edges = [i * (n - 1) // PERIODS for i in range(PERIODS + 1)]
    time = {"development": window(0, split), "holdout": window(split, n - 1), "periods": [window(a, b) for a, b in zip(edges, edges[1:])]}

    def subset(part: list[str]) -> dict:
        position_pct = scaled_position_pct(study.config.position_pct, study.config.max_positions, len(symbols), len(part))
        return {"positionPct": position_pct, **evaluate(study, part, position_pct=position_pct)[0]}

    universe = {
        "halves": [{"symbols": part, **subset(part)} for part in universe_halves(symbols) if part],
        "removals": [{"removed": s, **subset([x for x in symbols if x != s])} for s in symbols] if len(symbols) > 1 else [],
    }

    grid = [{"extraBpsPerSide": bps, **evaluate(study, symbols, bps)[0]} for bps in COST_GRID_BPS]
    survives = None
    for row in grid:
        if not _beats(row):
            break
        survives = row["extraBpsPerSide"]
    cost = {"grid": grid, "survivesExtraBpsPerSide": survives}

    years = (date.fromisoformat(calendar[-1]) - date.fromisoformat(calendar[0])).days / 365.25
    series, bench_series = np.asarray(equity, dtype=float), np.asarray(bench, dtype=float)
    bootstrap = {
        "method": "stationary block bootstrap of paired daily returns", "resamples": RESAMPLES, "expectedBlockDays": BLOCK_DAYS, "seed": SEED,
        "confidencePct": UPPER_PERCENTILE - LOWER_PERCENTILE,
        "intervals": bootstrap_intervals(series[1:] / series[:-1] - 1, bench_series[1:] / bench_series[:-1] - 1, years, study.risk_free_pct, RESAMPLES, BLOCK_DAYS, SEED),
    }
    return {
        "ok": True, "base": base, "checks": assess(base, time, universe, cost, bootstrap, len(symbols)),
        "time": time, "universe": universe, "cost": cost, "bootstrap": bootstrap,
        "design": {"holdoutPercent": HOLDOUT_PERCENT, "periods": PERIODS, "periodsToPass": PERIODS_TO_PASS, "minDays": MIN_DAYS, "minTrades": MIN_TRADES_FOR_EVIDENCE, "costStressBps": COST_STRESS_BPS},
    }
