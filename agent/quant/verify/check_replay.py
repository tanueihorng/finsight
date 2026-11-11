"""Exhaustive small-scope, generative and metamorphic checks on the real replay.

Run: .venv-verify/bin/python -m verify.check_replay [--fast]
"""
import itertools
import random
import sys
from datetime import date, timedelta

import empyrical
import numpy as np
import pandas as pd
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from finsight_quant.__main__ import MIN_TRADES_FOR_EVIDENCE, run
from finsight_quant.metrics import activity, performance, trading
from finsight_quant import portfolio
from finsight_quant.portfolio import Config, Position, ReplayError, _reconcile, derive_dividends, replay
from verify.reference import reference_replay

TOLERANCE = 1e-6


class Mismatch(AssertionError):
    pass


def require(condition, message, context=None):
    if not condition:
        raise Mismatch(f"{message}\n  context: {context}")


def close(a, b, relative_to=1.0):
    return abs(float(a) - float(b)) <= TOLERANCE * max(1.0, abs(relative_to))


def compare_with_reference(bars, candidates, config, calendar):
    got = replay(bars, candidates, config, calendar)
    want = reference_replay(bars, candidates, config, calendar)
    context = (bars, candidates, config, calendar)
    require([(f["date"], f["symbol"], f["side"], f["shares"]) for f in got["fills"]] == want["fills"], "fills differ", (got["fills"], want["fills"], context))
    require(got["rejected"] == want["rejected"], "rejections differ", (got["rejected"], want["rejected"], context))
    require(got["reduced"] == want["reduced"], "reduced count differs", context)
    require(close(sum(d["amount"] for d in got["dividends"]), want["dividends"], config.initial_cash), "dividends differ", context)
    require(len(got["curve"]) == len(want["ledger"]), "curve length differs", context)
    for point, row in zip(got["curve"], want["ledger"]):
        for key in ("equity", "cash", "value"):
            require(close(point[key], row[key], config.initial_cash), f"{key} differs on {point['date']}", (point, row, context))
        require(close(point["maxWeight"], row["maxWeight"]), f"max weight differs on {point['date']}", (point, row, context))
        require(point["positions"] == row["positions"], "position count differs", context)
    require(len(got["closed"]) == len(want["closed"]), "closed trades differ", context)
    for trade, (symbol, entry, exit_day, pnl, return_pct) in zip(got["closed"], want["closed"]):
        require((trade["symbol"], trade["entryDate"], trade["exitDate"]) == (symbol, entry, exit_day), "closed trade identity differs", context)
        require(close(trade["pnl"], pnl, config.initial_cash), "closed trade P&L differs", context)
        require(close(trade["returnPct"], return_pct), "closed trade return differs", context)
    require(sorted((p["symbol"], p["entryDate"], p["shares"]) for p in got["open"]) == want["open"], "open positions differ", context)
    return got


# ---- exhaustive small scope -------------------------------------------------

DAYS = [f"2024-01-0{d}" for d in range(1, 6)]
PATHS = {"A": [(100.0, 100.0), (100.0, 110.0), (105.0, 90.0), (90.0, 100.0), (100.0, 120.0)],
         "B": [(50.0, 50.0), (55.0, 50.0), (50.0, 40.0), (45.0, 44.0), (44.0, 60.0)]}


def exhaustive_bars():
    bars = {}
    for symbol, path in PATHS.items():
        rows = [{"date": d, "o": o, "h": max(o, c), "l": min(o, c), "c": c, "v": 1000 if symbol == "A" else 5000} for d, (o, c) in zip(DAYS, path)]
        if symbol == "B":  # one dividend, ex on the third day
            for i, row in enumerate(rows):
                row["adj"] = row["c"] * (0.99 if i < 2 else 1.0)
        bars[symbol] = rows
    return bars


def trade_shapes(bars):
    shapes = []
    for symbol, rows in bars.items():
        for e in range(1, 5):
            entry = rows[e]["o"]
            exits = [[]]
            leg = lambda d, kind, qty: {"date": DAYS[d], "px": rows[d]["o"] * (1.0 if kind == "open" else 0.95), "qty": qty, "why": kind}
            for d, kind in itertools.product(range(e, 5), ("open", "intraday")):
                exits.append([leg(d, kind, 1.0)])
                exits.append([leg(d, kind, 0.5)])
            for d1, d2 in itertools.combinations_with_replacement(range(e, 5), 2):
                exits.append([leg(d1, "intraday", 0.5), leg(d2, "open", 0.5)])
            shapes.extend({"symbol": symbol, "entryDate": DAYS[e], "entry": entry, "stop": entry * 0.9, "exits": x} for x in exits)
    return shapes


def run_exhaustive(fast):
    bars = exhaustive_bars()
    shapes = trade_shapes(bars)
    configs = [Config(cash, pct, slots, cost, slip)
               for cash, pct, slots, cost, slip in itertools.product((150.0, 1000.0, 1001.0), (50.0, 100.0), (1, 2), (0.0, 10.0), (0.0, 5.0))]
    scenarios = [[]] + [[s] for s in shapes] + [list(p) for p in itertools.combinations(shapes, 2)]
    if fast:
        random.Random(7).shuffle(scenarios)
        scenarios = scenarios[:1500]
        configs = configs[::5]
    count = 0
    for candidates in scenarios:
        for config in configs:
            compare_with_reference(bars, candidates, config, DAYS)
            count += 1
    return count


# ---- generated scenarios and metamorphic relations -------------------------


def calendar_of(n):
    start = date(2023, 1, 2)
    return [(start + timedelta(days=i)).isoformat() for i in range(n)]


PRICES = st.sampled_from([5.0, 7.5, 10.0, 12.25, 33.0, 50.0, 99.99, 100.0, 250.5])


@st.composite
def scenarios(draw):
    n = draw(st.integers(3, 12))
    calendar = calendar_of(n)
    bars = {}
    for symbol in draw(st.lists(st.sampled_from("ABCD"), min_size=1, max_size=4, unique=True)):
        rows, factor = [], draw(st.sampled_from([0.9, 0.95, 1.0]))
        with_adj = draw(st.booleans())
        for i, day in enumerate(calendar):
            if i and draw(st.integers(0, 9)) == 0:
                continue
            c, o = draw(PRICES), draw(PRICES)
            if with_adj and draw(st.integers(0, 3)) == 0:
                factor = min(1.0, factor + 0.01)
            rows.append({"date": day, "o": o, "h": max(o, c), "l": min(o, c), "c": c, "v": draw(st.integers(0, 5000)), **({"adj": c * factor} if with_adj else {})})
        if rows:
            bars[symbol] = rows
    symbols = sorted(bars)
    if not symbols:
        rows = [{"date": d, "o": 10.0, "h": 10.0, "l": 10.0, "c": 10.0, "v": 1} for d in calendar]
        bars["A"], symbols = rows, ["A"]
    candidates = []
    for _ in range(draw(st.integers(0, 8))):
        symbol = draw(st.sampled_from(symbols))
        rows = bars[symbol]
        pos = draw(st.integers(0, len(rows) - 1))
        entry = draw(st.sampled_from([rows[pos]["o"], rows[pos]["o"] * 1.0005, rows[pos]["c"]]))
        exits, sold = [], 0.0
        at = pos
        for _ in range(draw(st.integers(0, 2))):
            at = draw(st.integers(at, len(rows) - 1))
            qty = draw(st.sampled_from([0.5, 1.0 - sold]))
            if qty <= 0:
                break
            exits.append({"date": rows[at]["date"], "px": draw(st.sampled_from([rows[at]["o"], rows[at]["l"], rows[at]["c"] * 1.01])), "qty": qty, "why": "x"})
            sold += qty
        candidates.append({"symbol": symbol, "entryDate": rows[pos]["date"], "entry": entry, "stop": entry * 0.9, "exits": exits})
    config = Config(draw(st.sampled_from([100.0, 1000.0, 54321.0])), draw(st.sampled_from([10.0, 33.0, 100.0])), draw(st.integers(1, 4)),
                    draw(st.sampled_from([0.0, 1.0, 10.0, 25.5])), draw(st.sampled_from([0.0, 5.0, 12.5])))
    return bars, candidates, config, calendar


@st.composite
def liquidity_scenarios(draw):
    """Long, gappy histories where only the liquidity ranking decides who gets the cash."""
    calendar = calendar_of(30)
    bars = {}
    for symbol in "ABC":
        rows = [{"date": d, "o": 10.0, "h": 10.0, "l": 10.0, "c": 10.0, "v": draw(st.sampled_from([0, 1, 1000, None]))}
                for d in calendar if draw(st.integers(0, 3)) > 0]  # a symbol may list after the window opens
        bars[symbol] = rows
    candidates = []
    for day in draw(st.lists(st.integers(1, 29), min_size=1, max_size=3, unique=True)):
        for symbol, rows in bars.items():
            if any(b["date"] == calendar[day] for b in rows):
                exit_day = draw(st.integers(day, 29))
                candidates.append({"symbol": symbol, "entryDate": calendar[day], "entry": 10.0, "stop": 9.0,
                                   "exits": [{"date": calendar[exit_day], "px": 10.0, "qty": 1.0, "why": "x"}]})
    return bars, candidates, Config(100.0, 100.0, 3, 0.0, 0.0), calendar


def key(result):
    return result["fills"], result["rejected"], result["reduced"], result["curve"]


def _hide_after(candidates, last_day):
    return [{**c, "exits": [x for x in c["exits"] if x["date"] <= last_day]} for c in candidates if c["entryDate"] <= last_day]


def check_generated(bars, candidates, config, calendar):
    result = compare_with_reference(bars, candidates, config, calendar)

    # Determinism and independence from input order.
    shuffled = list(candidates)
    random.Random(len(candidates)).shuffle(shuffled)
    distinct = len({(c["symbol"], c["entryDate"]) for c in candidates}) == len(candidates)
    if distinct:
        require(key(replay(bars, shuffled, config, calendar)) == key(result), "result depends on candidate input order", (bars, candidates, config))

    # No look-ahead: a run cut off at day k matches the full run up to day k.
    k = len(calendar) // 2 + 1
    if k >= 2:
        cut_day = calendar[k - 1]
        cut_bars = {s: [b for b in rows if b["date"] <= cut_day] for s, rows in bars.items()}
        cut_bars = {s: rows for s, rows in cut_bars.items() if rows}
        cut_candidates = [c for c in _hide_after(candidates, cut_day) if c["symbol"] in cut_bars]
        short = replay(cut_bars, cut_candidates, config, calendar[:k])
        require(short["curve"] == result["curve"][:k], "future data changed past equity", (bars, candidates, config, calendar))

    # A candidate nobody can afford changes nothing but the rejection count.
    pricey = {"symbol": "ZZZ", "entryDate": calendar[-1], "entry": 1e15, "stop": 1.0, "exits": []}
    extra_bars = {**bars, "ZZZ": [{"date": calendar[-1], "o": 1e15, "h": 1e15, "l": 1e15, "c": 1e15, "v": 0}]}
    if config.max_positions > result["curve"][-1]["positions"]:
        extended = replay(extra_bars, candidates + [pricey], config, calendar)
        require(extended["fills"] == result["fills"] and extended["curve"] == result["curve"], "unaffordable candidate changed the portfolio", (bars, candidates, config))

    # Money is conserved: trade P&L includes dividends attributed to each position.
    realised = sum(t["pnl"] for t in result["closed"])
    unrealised = sum(p["unrealizedPnl"] for p in result["open"])
    require(close(result["curve"][-1]["equity"], config.initial_cash + realised + unrealised, config.initial_cash), "money not conserved", (bars, candidates, config))
    for point in result["curve"]:
        require(point["cash"] >= -TOLERANCE and point["positions"] <= config.max_positions, "cash or slot limit broken", point)

    check_trading_and_activity(result, calendar)


def check_trading_and_activity(result, calendar):
    closed = pd.DataFrame(result["closed"], columns=["symbol", "entryDate", "exitDate", "shares", "pnl", "returnPct"])
    trades = trading(result)
    require(trades["closedTrades"] == len(closed) and trades["openTrades"] == len(result["open"]), "trade counts wrong", trades)
    if len(closed):
        wins, losses = closed.pnl[closed.pnl > 0], closed.pnl[closed.pnl <= 0]
        require(close(trades["winRatePct"], 100 * len(wins) / len(closed)), "win rate wrong", trades)
        require(close(trades["expectancyPct"], closed.returnPct.mean()), "expectancy wrong", trades)
        factor = wins.sum() / -losses.sum() if losses.sum() < 0 else None
        require((trades["profitFactor"] is None) == (factor is None) and (factor is None or close(trades["profitFactor"], factor, factor)), "profit factor wrong", trades)
        days = (pd.to_datetime(closed.exitDate) - pd.to_datetime(closed.entryDate)).dt.days.mean()
        require(close(trades["averageHoldCalendarDays"], days), "hold period wrong", trades)
    else:
        require(trades["winRatePct"] is None and trades["expectancyPct"] is None and trades["profitFactor"] is None, "empty trade stats should be null", trades)

    years = (date.fromisoformat(calendar[-1]) - date.fromisoformat(calendar[0])).days / 365.25
    frame = pd.DataFrame(result["curve"])
    fills = pd.DataFrame(result["fills"], columns=["date", "symbol", "side", "shares", "px", "fee", "why"])
    stats = activity(result, years)
    traded = float((fills.shares * fills.px).sum()) if len(fills) else 0.0
    require(close(stats["annualTurnover"], traded / 2 / frame.equity.mean() / years), "turnover wrong", stats)
    require(close(stats["totalCosts"], fills.fee.sum() if len(fills) else 0.0), "costs wrong", stats)
    require(close(stats["dividendsReceived"], sum(d["amount"] for d in result["dividends"])), "dividends wrong", stats)
    require(close(stats["averageExposurePct"], 100 * (frame.value / frame.equity).mean()), "exposure wrong", stats)
    require(close(stats["averagePositions"], frame.positions.mean()), "average positions wrong", stats)
    require(close(stats["largestPositionWeightPct"], 100 * frame.maxWeight.max()), "largest weight wrong", stats)


# ---- metrics against empyrical and brute force ------------------------------


def check_guards():
    days, rows = DAYS, {"A": [{"date": d, "o": 10.0, "h": 10.0, "l": 10.0, "c": 10.0, "v": 1} for d in DAYS]}
    config = Config(1000.0, 10.0, 2, 0.0, 0.0)
    leg = lambda d, px=10.0, qty=1.0: {"date": d, "px": px, "qty": qty, "why": "x"}
    trade = lambda exits, entry=10.0, symbol="A": {"symbol": symbol, "entryDate": days[2], "entry": entry, "stop": 9.0, "exits": exits}
    bad = [trade([], entry=0.0), trade([], symbol="NOPE"), trade([leg(days[1])]), trade([leg(days[3], qty=0.0)]), trade([leg(days[3], qty=1.5)]), trade([leg(days[3], px=0.0)])]
    for candidate in bad:
        try:
            replay(rows, [candidate], config, days)
        except ReplayError:
            continue
        raise Mismatch(f"invalid candidate was accepted: {candidate}")
    for candidate in (trade([], entry=0.5), trade([leg(days[2])]), trade([leg(days[3], qty=1.0)]), trade([leg(days[3], px=0.5, qty=0.5)])):
        replay(rows, [candidate], config, days)

    fill = {"date": days[1], "symbol": "A", "side": "buy", "shares": 1, "px": 10.0, "fee": 0.0, "why": "x"}
    position = {0: Position(0, "A", days[1], 10.0, 1, 1, 0.0)}
    marks = {"A": 10.0}
    _reconcile(config, [fill], [], position, marks, 990.0, 1000.0)
    tampered = [([fill], {}, 990.0, 1000.0), ([fill], position, 991.0, 1001.0), ([fill], position, 990.0, 1001.0)]
    for fills, held, cash, equity in tampered:
        try:
            _reconcile(config, fills, [], held, marks, cash, equity)
        except ReplayError:
            continue
        raise Mismatch(f"reconciliation accepted a broken ledger: {cash} {equity}")

    def reconciles(cfg, fills, held, cash, equity):
        try:
            _reconcile(cfg, fills, [], held, marks, cash, equity)
        except ReplayError:
            return False
        return True

    # The allowance is one millionth of starting cash, and never below one millionth of a dollar.
    for cfg, limit in ((config, 1e-3), (Config(0.5, 10.0, 2, 0.0, 0.0), 1e-6)):
        start = cfg.initial_cash
        for cash_off, equity_off in ((1.0, 0.0), (0.0, 1.0)):
            inside = reconciles(cfg, [], {}, start + cash_off * limit * 0.5, start + equity_off * limit * 0.5)
            outside = reconciles(cfg, [], {}, start + cash_off * limit * 1.5, start + equity_off * limit * 1.5)
            require(inside and not outside, "reconciliation allowance moved", (cfg, limit, cash_off, equity_off))
    orphan_sale = {**fill, "side": "sell"}
    require(not reconciles(config, [orphan_sale], {}, 1010.0, 1010.0), "a sale with no purchase was accepted", orphan_sale)

    original, called = portfolio._reconcile, []
    portfolio._reconcile = lambda *args: called.append(args)
    try:
        replay(rows, [], config, days)
    finally:
        portfolio._reconcile = original
    require(called, "replay does not reconcile its ledger", None)


def check_trading_boundaries():
    row = lambda pnl, ret: {"symbol": "A", "entryDate": "2024-01-01", "exitDate": "2024-01-03", "shares": 1, "pnl": pnl, "returnPct": ret}
    out = trading({"closed": [row(0.0, 0.0), row(0.5, 1.0), row(-0.5, -1.0), row(2.0, 4.0)], "open": []})
    require(out["winRatePct"] == 50.0, "a zero or sub-unit P&L is misclassified", out)
    require(out["profitFactor"] == 5.0, "profit factor uses the wrong losses", out)
    spread = [{**row(1.0, 1.0), "exitDate": day} for day in ("2024-01-03", "2024-01-03", "2024-01-13")]
    require(trading({"closed": spread, "open": []})["averageHoldCalendarDays"] == (2 + 2 + 12) / 3, "average hold is not the mean", out)
    require(trading({"closed": [row(1.0, 1.0)], "open": []})["profitFactor"] is None, "no losses should give no profit factor", out)


def check_metrics(rounds):
    for series, peak, trough in (([100.0, 120.0, 90.0, 200.0], 1, 2), ([100.0, 90.0, 80.0, 70.0, 300.0], 0, 3)):
        got = performance(DAYS[: len(series)], series, 0.0)
        require(got["maxDrawdownPeak"] == DAYS[peak] and got["maxDrawdownTrough"] == DAYS[trough], "drawdown dates wrong", got)
    rising = performance(DAYS[:4], [100.0, 101.0, 102.0, 103.0], 0.0)
    require(rising["longestUnderwaterDays"] == 0 and rising["maxDrawdownPct"] == 0.0, "a rising series is never under water", rising)
    one = performance(DAYS[:2], [100.0, 90.0], 0.0)
    require(one["sharpe"] is None and one["sortino"] is None and one["volatilityPct"] is None, "one return cannot give a risk ratio", one)
    two = performance(DAYS[:3], [100.0, 101.0, 99.0], 0.0)
    pair = pd.Series([0.01, 99.0 / 101.0 - 1])
    require(close(two["sharpe"], empyrical.sharpe_ratio(pair, annualization=252)), "two returns should give a Sharpe", two)

    rng = np.random.default_rng(11)
    for _ in range(rounds):
        n = int(rng.integers(5, 400))
        returns = rng.normal(0.0005, 0.015, n)
        series = np.concatenate([[100.0], 100.0 * np.cumprod(1 + returns)])
        dates = [(date(2020, 1, 1) + timedelta(days=int(i * 1.45))).isoformat() for i in range(n + 1)]
        rf_pct = float(rng.choice([0.0, 2.0, 4.5]))
        got = performance(dates, series.tolist(), rf_pct)
        rs = pd.Series(returns)
        rf = rf_pct / 100 / 252
        years = (date.fromisoformat(dates[-1]) - date.fromisoformat(dates[0])).days / 365.25
        want = {"sharpe": empyrical.sharpe_ratio(rs, risk_free=rf, annualization=252),
                "sortino": empyrical.sortino_ratio(rs, required_return=rf, annualization=252),
                "volatilityPct": empyrical.annual_volatility(rs, annualization=252) * 100,
                "maxDrawdownPct": empyrical.max_drawdown(rs) * 100,
                "totalReturnPct": empyrical.cum_returns_final(rs) * 100,
                "cagrPct": ((series[-1] / series[0]) ** (1 / years) - 1) * 100}
        for name, value in want.items():
            require(close(got[name], value, value), f"{name} disagrees with reference", (got[name], value))

        # Brute force over every pair of days, with no running-maximum shortcut.
        worst, peak, trough = 0.0, 0, 0
        for j in range(len(series)):
            for i in range(j + 1):
                dd = series[j] / series[i] - 1
                if dd < worst:
                    worst, peak, trough = dd, i, j
        require(got["maxDrawdownPeak"] == dates[peak] and got["maxDrawdownTrough"] == dates[trough], "drawdown dates wrong", got)
        longest = run_length = 0
        for j in range(len(series)):
            run_length = run_length + 1 if series[j] < series[: j + 1].max() else 0
            longest = max(longest, run_length)
        require(got["longestUnderwaterDays"] == longest, "time under water wrong", got)
        require(close(got["years"], years), "years wrong", got)


def check_dividends():
    """Known cash amounts, pushed through the same back-adjustment Yahoo applies."""
    rng = np.random.default_rng(3)
    for _ in range(200):
        closes = rng.uniform(20, 200, 30)
        paid = {int(i): float(rng.uniform(0.05, 2.0)) for i in rng.choice(np.arange(1, 30), 4, replace=False)}
        factor, factors = 1.0, [1.0] * 30
        for i in range(29, 0, -1):
            factors[i] = factor
            if i in paid:
                factor *= 1 - paid[i] / closes[i - 1]
        factors[0] = factor
        rows = [{"date": (date(2022, 1, 3) + timedelta(days=i)).isoformat(), "c": float(closes[i]), "adj": float(closes[i] * factors[i])} for i in range(30)]
        found = derive_dividends(rows)
        require(set(found) == {rows[i]["date"] for i in paid}, "wrong ex-dates", (found, paid))
        for i, amount in paid.items():
            require(close(found[rows[i]["date"]], amount), "wrong dividend amount", (found, paid))
    flat = [{"date": f"2022-01-{d:02d}", "c": 100.0, "adj": 100.0 * (1 + 1e-7 * (d % 2))} for d in range(1, 20)]
    require(derive_dividends(flat) == {}, "rounding noise treated as a dividend", flat)
    pair = lambda dividend_yield: [{"date": "2022-01-03", "c": 100.0, "adj": 100.0 * (1 - dividend_yield)}, {"date": "2022-01-04", "c": 100.0, "adj": 100.0}]
    require(len(derive_dividends(pair(1.2e-5))) == 1 and derive_dividends(pair(0.8e-5)) == {}, "dividend threshold moved", None)
    gappy = [{"date": "2022-01-03", "c": 100.0, "adj": 99.0}, {"date": "2022-01-04", "c": 100.0, "adj": None}, {"date": "2022-01-05", "c": 100.0, "adj": 100.0}]
    require(derive_dividends(gappy) == {}, "a missing adjusted close must not produce a dividend", gappy)


def check_worker_contract():
    days = calendar_of(70)
    def bars_at(c):
        return [{"date": d, "o": c, "h": c, "l": c, "c": c, "v": 10, "adj": c} for d in days]
    def request(trades):
        spy = bars_at(100.0)
        for i, row in enumerate(spy):
            row["adj"] = row["c"] = 100.0 + i
        spy = [b for i, b in enumerate(spy) if i % 7 != 3]
        cands = [{"symbol": "A", "entryDate": days[1 + 2 * i], "entry": 100.0, "stop": 90.0, "exits": [{"date": days[2 + 2 * i], "px": 100.0, "qty": 1.0, "why": "x"}]} for i in range(trades)]
        return {"version": 1, "calendar": days, "bars": {"A": bars_at(100.0)}, "benchmark": {"symbol": "SPY", "bars": spy}, "candidates": cands,
                "config": {"initialCash": 10000.0, "positionPct": 10.0, "maxPositions": 3, "costBps": 0.0, "extraSlippageBps": 0.0, "riskFreePct": 0.0}}
    for trades, warned in ((MIN_TRADES_FOR_EVIDENCE - 1, True), (MIN_TRADES_FOR_EVIDENCE, False)):
        out = run(request(trades))
        require(any("too few" in w for w in out["warnings"]) == warned, "small-sample warning threshold wrong", (trades, out["warnings"]))
    require(MIN_TRADES_FOR_EVIDENCE == 30, "evidence threshold changed", MIN_TRADES_FOR_EVIDENCE)

    req = request(5)
    out = run(req)
    spy = pd.Series({b["date"]: b["adj"] for b in req["benchmark"]["bars"]}).reindex(days).ffill()
    want_total = (spy.iloc[-1] / spy.iloc[0] - 1) * 100
    require(close(out["benchmark"]["totalReturnPct"], want_total), "benchmark return wrong", out["benchmark"])
    require(close(out["excess"]["totalReturnPct"], out["strategy"]["totalReturnPct"] - want_total), "excess return wrong", out["excess"])
    require(close(out["excess"]["cagrPct"], out["strategy"]["cagrPct"] - out["benchmark"]["cagrPct"]), "excess CAGR wrong", out["excess"])
    curve = 10000.0 * spy / spy.iloc[0]
    index = pd.to_datetime(curve.index)
    month_ends = curve.groupby([index.year, index.month]).tail(1)
    require([m["date"] for m in out["monthlyEquity"]] == list(month_ends.index), "month ends wrong", out["monthlyEquity"])
    for point, value in zip(out["monthlyEquity"], month_ends):
        require(close(point["benchmark"], value, value), "monthly benchmark wrong", point)
    require(out["reconciled"] is True and out["trading"]["closedTrades"] == 5, "worker summary wrong", out["trading"])

    no_adj = request(1)
    for row in no_adj["benchmark"]["bars"]:
        del row["adj"]
    closes = pd.Series({b["date"]: b["c"] for b in no_adj["benchmark"]["bars"]}).reindex(days).ffill()
    out = run(no_adj)
    require(close(out["benchmark"]["totalReturnPct"], (closes.iloc[-1] / closes.iloc[0] - 1) * 100), "price-only benchmark wrong", out["benchmark"])
    require(any("benchmark" in w for w in out["warnings"]), "price-only benchmark not flagged", out["warnings"])

    # Only bars inside the window decide price-only: a warm-up or later bar without
    # adjusted close changes neither the benchmark nor the warnings.
    def outside(day, c):
        return {"date": day, "o": c, "h": c, "l": c, "c": c, "v": 10}
    edges = request(5)
    edges["bars"]["A"] = [outside("1999-12-31", 100.0), *edges["bars"]["A"], outside("2999-01-04", 100.0)]
    edges["benchmark"]["bars"] = [outside("1999-12-31", 50.0), *edges["benchmark"]["bars"], outside("2999-01-04", 500.0)]
    out = run(edges)
    require(close(out["benchmark"]["totalReturnPct"], want_total), "a bar outside the window changed the benchmark", out["benchmark"])
    require(not any("adjusted close" in w for w in out["warnings"]), "a bar outside the window raised a price-only warning", out["warnings"])
    for at in (0, len(days) // 2, len(days) - 1):
        gap = request(5)
        del gap["bars"]["A"][at]["adj"]
        notes = run(gap)["warnings"]
        require(any(w.startswith("No adjusted close for A") for w in notes), "a window bar without adjusted close not flagged", (at, notes))
        bench_gap = request(5)
        day = days[at]
        rows = bench_gap["benchmark"]["bars"]
        if any(b["date"] == day for b in rows):
            del next(b for b in rows if b["date"] == day)["adj"]
            out = run(bench_gap)
            closes = pd.Series({b["date"]: b["c"] for b in rows}).reindex(days).ffill()
            require(close(out["benchmark"]["totalReturnPct"], (closes.iloc[-1] / closes.iloc[0] - 1) * 100), "benchmark with a window gap not price-only", (at, out["benchmark"]))

    skipped = request(0)
    skipped["candidates"] = [{"symbol": "A", "entryDate": days[1], "entry": 1e9, "stop": 1.0, "exits": []}]
    require(any("skipped" in w for w in run(skipped)["warnings"]), "skipped candidates not flagged", skipped)

    both = request(0)
    both["bars"]["B"] = both["bars"]["D"] = bars_at(100.0)
    both["config"]["maxPositions"] = 1
    both["candidates"] = [{"symbol": "D", "entryDate": days[1], "entry": 1e9, "stop": 1.0, "exits": []},  # no cash
                          {"symbol": "A", "entryDate": days[2], "entry": 100.0, "stop": 90.0, "exits": []},
                          {"symbol": "B", "entryDate": days[3], "entry": 100.0, "stop": 90.0, "exits": []}]  # no slot
    require(any(w.startswith("2 candidate trades") for w in run(both)["warnings"]), "skipped count wrong", run(both)["warnings"])
    limited = request(0)
    limited["config"]["positionPct"] = 100.0
    limited["bars"]["B"] = bars_at(100.0)
    limited["candidates"] = [{"symbol": "A", "entryDate": days[1], "entry": 100.0, "stop": 90.0, "exits": []},
                             {"symbol": "B", "entryDate": days[1], "entry": 100.0, "stop": 90.0, "exits": []}]
    require(any(w.startswith("1 candidate trades") for w in run(limited)["warnings"]), "no-cash skips not counted", run(limited)["warnings"])

    many = run(request(30))
    require(len(many["recentFills"]) == 20 and many["recentFills"][-1]["date"] == days[60], "recent fills wrong", many["recentFills"][-1])

    partial = request(1)
    for row in partial["bars"]["A"]:
        row["adj"] = None
    partial["bars"]["C"] = bars_at(100.0)
    notes = run(partial)["warnings"]
    require(any("No adjusted close for A:" in w for w in notes), "price-only symbols not named", notes)
    require(not any("C" in w.split(":")[0] for w in notes if w.startswith("No adjusted close for")), "complete symbols wrongly named", notes)

    missing_first = request(1)
    missing_first["benchmark"]["bars"] = missing_first["benchmark"]["bars"][1:]
    try:
        run(missing_first)
    except ReplayError:
        pass
    else:
        raise Mismatch("a benchmark with no first-day bar was accepted")
    missing_second = request(1)
    del missing_second["benchmark"]["bars"][1]
    run(missing_second)


def check_ranked(scenario):
    compare_with_reference(*scenario)


def check_liquidity_window():
    """Volume exactly 21 bars back must not count: it would put A ahead of B."""
    calendar = calendar_of(30)
    entry_day = 24
    bars = {symbol: [{"date": d, "o": 10.0, "h": 10.0, "l": 10.0, "c": 10.0, "v": volume(i)} for i, d in enumerate(calendar)]
            for symbol, volume in (("A", lambda i: 1_000_000 if i == entry_day - 21 else 0), ("B", lambda i: 1))}
    candidates = [{"symbol": s, "entryDate": calendar[entry_day], "entry": 10.0, "stop": 9.0, "exits": []} for s in bars]
    result = compare_with_reference(bars, candidates, Config(100.0, 100.0, 3, 0.0, 0.0), calendar)
    require([f["symbol"] for f in result["fills"]] == ["B"], "liquidity window is not 20 bars", result["fills"])


def main():
    fast = "--fast" in sys.argv
    count = run_exhaustive(fast)
    examples = 150 if fast else 3000
    verified = given(scenarios())(settings(max_examples=examples, deadline=None, derandomize=True, database=None,
                                           suppress_health_check=list(HealthCheck))(lambda s: check_generated(*s)))
    verified()
    ranked = given(liquidity_scenarios())(settings(max_examples=examples, deadline=None, derandomize=True, database=None,
                                                   suppress_health_check=list(HealthCheck))(check_ranked))
    ranked()
    check_liquidity_window()
    check_guards()
    check_trading_boundaries()
    check_metrics(25 if fast else 300)
    check_dividends()
    check_worker_contract()
    print(f"OK: {count} exhaustive scenarios, {examples} generated scenarios with metamorphic relations, metrics against empyrical and brute force")


if __name__ == "__main__":
    main()
