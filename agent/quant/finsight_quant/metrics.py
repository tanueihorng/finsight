"""Performance, risk and trading statistics. Daily returns, 252-day annualisation."""
from __future__ import annotations

from datetime import date

import numpy as np

from .portfolio import ReplayError

TRADING_DAYS = 252
MIN_TRADES_FOR_EVIDENCE = 30


def _clean(value: float | None) -> float | None:
    if value is None:
        return None
    number = float(value)
    return number if np.isfinite(number) else None


def difference(a: float | None, b: float | None) -> float | None:
    """a minus b, or nothing when either is too large to represent (a huge move annualised over days)."""
    return None if a is None or b is None else a - b


def performance(dates: list[str], equity: list[float], risk_free_pct: float) -> dict:
    series = np.asarray(equity, dtype=float)
    returns = series[1:] / series[:-1] - 1
    years = (date.fromisoformat(dates[-1]) - date.fromisoformat(dates[0])).days / 365.25
    total = series[-1] / series[0] - 1
    daily_rf = risk_free_pct / 100 / TRADING_DAYS
    excess = returns - daily_rf

    volatility = sharpe = sortino = None
    if returns.size >= 2:
        sd = float(np.std(returns, ddof=1))
        if sd > 0:
            volatility = sd * np.sqrt(TRADING_DAYS)
            sharpe = float(np.mean(excess)) / sd * np.sqrt(TRADING_DAYS)
        downside = float(np.sqrt(np.mean(np.minimum(excess, 0.0) ** 2)))
        if downside > 0:
            sortino = float(np.mean(excess)) / downside * np.sqrt(TRADING_DAYS)

    peaks = np.maximum.accumulate(series)
    drawdowns = series / peaks - 1
    trough = int(np.argmin(drawdowns))
    peak_at = int(np.argmax(series[: trough + 1]))

    underwater = longest = 0
    for dd in drawdowns:
        underwater = underwater + 1 if dd < 0 else 0
        longest = max(longest, underwater)

    return {
        "totalReturnPct": _clean(total * 100),
        "cagrPct": _clean(((series[-1] / series[0]) ** (1 / years) - 1) * 100),
        "volatilityPct": _clean(volatility * 100) if volatility is not None else None,
        "sharpe": _clean(sharpe),
        "sortino": _clean(sortino),
        "maxDrawdownPct": _clean(float(drawdowns[trough]) * 100),
        "maxDrawdownPeak": dates[peak_at],
        "maxDrawdownTrough": dates[trough],
        "longestUnderwaterDays": longest,
        "years": _clean(years),
    }


def benchmark_curve(bars: list[dict], calendar: list[str], initial_cash: float) -> tuple[list[float], bool]:
    """Total-return buy-and-hold on the replay calendar, carrying over missing days."""
    by_date = {b["date"]: b for b in bars}
    if calendar[0] not in by_date:
        raise ReplayError(f"benchmark has no bar on {calendar[0]}")
    price_only = any(not b.get("adj") for b in bars)
    field = "c" if price_only else "adj"
    start = by_date[calendar[0]][field]
    level, curve = start, []
    for day in calendar:
        if day in by_date:
            level = by_date[day][field]
        curve.append(initial_cash * level / start)
    return curve, price_only


def trading(replay: dict) -> dict:
    closed = replay["closed"]
    pnl = np.asarray([t["pnl"] for t in closed], dtype=float)
    returns = np.asarray([t["returnPct"] for t in closed], dtype=float)
    wins = pnl[pnl > 0]
    losses = pnl[pnl <= 0]
    gross_loss = float(-losses.sum())
    hold = [(date.fromisoformat(t["exitDate"]) - date.fromisoformat(t["entryDate"])).days for t in closed]
    return {
        "closedTrades": len(closed),
        "openTrades": len(replay["open"]),
        "winRatePct": _clean(wins.size / pnl.size * 100) if pnl.size else None,
        "expectancyPct": _clean(float(returns.mean())) if pnl.size else None,
        "profitFactor": _clean(float(wins.sum()) / gross_loss) if gross_loss > 0 else None,
        "averageHoldCalendarDays": _clean(float(np.mean(hold))) if hold else None,
    }


def activity(replay: dict, years: float) -> dict:
    curve = replay["curve"]
    equity = np.asarray([p["equity"] for p in curve], dtype=float)
    value = np.asarray([p["value"] for p in curve], dtype=float)
    traded = sum(f["shares"] * f["px"] for f in replay["fills"])
    return {
        "annualTurnover": _clean(traded / 2 / float(equity.mean()) / years),
        "totalCosts": _clean(sum(f["fee"] for f in replay["fills"])),
        "dividendsReceived": _clean(sum(d["amount"] for d in replay["dividends"])),
        "averageExposurePct": _clean(float((value / equity).mean()) * 100),
        "averagePositions": _clean(float(np.mean([p["positions"] for p in curve]))),
        "largestPositionWeightPct": _clean(max(p["maxWeight"] for p in curve) * 100),
    }
