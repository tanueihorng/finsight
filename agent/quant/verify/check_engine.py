"""Compares the replay with code this project's replay did not write.

  * vectorbt rebuilds cash and portfolio value from the replay's fills.
  * vectorbt decides fills itself from the raw candidates, so it can disagree
    with the replay about which trades were affordable and at what size.
  * The JavaScript engines' own per-trade P&L must match the replay's ledger.
  * Yahoo's declared dividends must match the amounts derived from adjclose.

Run: .venv-verify/bin/python -W ignore -m verify.check_engine <export.json>
"""
import json
import sys
from dataclasses import replace as with_fields
from datetime import date, timedelta
from math import fsum

import numpy as np
import pandas as pd
import vectorbt as vbt
from vectorbt.portfolio.enums import OrderSide, SizeType
from hypothesis import HealthCheck, assume, given, settings
from hypothesis import strategies as st

from finsight_quant.portfolio import Config, derive_dividends, replay
from verify.check_replay import calendar_of, scenarios

SHARE_ROUNDING_PCT = 1e-4
DECLARED_HISTORY_DAYS = 1780


def without_adj(bars):
    return {s: [{k: v for k, v in b.items() if k != "adj"} for b in rows] for s, rows in bars.items()}


def compare_vectorbt(bars, result, config, calendar):
    """Returns False when vectorbt's one-order-per-bar model cannot express the fills."""
    fills = pd.DataFrame(result["fills"], columns=["date", "symbol", "side", "shares", "px", "fee", "why"])
    if fills.empty or fills.duplicated(["date", "symbol"]).any():
        return False
    symbols = sorted(bars)
    close = pd.DataFrame({s: pd.Series({b["date"]: b["c"] for b in bars[s]}) for s in symbols}).reindex(calendar).ffill().bfill()
    size = pd.DataFrame(np.nan, index=calendar, columns=symbols)
    price = close.copy()
    for fill in fills.itertuples():
        size.loc[fill.date, fill.symbol] = fill.shares if fill.side == "buy" else -fill.shares
        price.loc[fill.date, fill.symbol] = fill.px
    for frame in (close, size, price):
        frame.index = pd.to_datetime(frame.index)
    portfolio = vbt.Portfolio.from_orders(close, size=size, size_type="amount", price=price, fees=config.cost_bps / 1e4, init_cash=config.initial_cash,
                                          cash_sharing=True, group_by=True, call_seq="auto", freq="1D", log=False)
    value = portfolio.value().to_numpy()
    cash = portfolio.cash().to_numpy()
    equity = np.array([p["equity"] for p in result["curve"]])
    replay_cash = np.array([p["cash"] for p in result["curve"]])
    limit = 1e-6 * config.initial_cash
    assert np.abs(value - equity).max() <= limit, f"vectorbt value differs by {np.abs(value - equity).max()}"
    assert np.abs(cash - replay_cash).max() <= limit, f"vectorbt cash differs by {np.abs(cash - replay_cash).max()}"
    assert portfolio.orders.count() == len(fills), "vectorbt did not accept every fill"
    return True


def expressible(candidates, first_day):
    """Narrows candidates to what vectorbt can size alone: one full exit, no overlap, no same-bar round trip."""
    kept, busy_until = [], {}
    for candidate in sorted(candidates, key=lambda c: (c["symbol"], c["entryDate"])):
        symbol, entry = candidate["symbol"], candidate["entryDate"]
        legs = candidate["exits"][:1]
        exit_day = legs[0]["date"] if legs else None
        overlaps = symbol in busy_until and (busy_until[symbol] is None or entry <= busy_until[symbol])
        if entry <= first_day or overlaps or exit_day == entry:
            continue
        kept.append({**candidate, "exits": [{**legs[0], "qty": 1.0}] if legs else []})
        busy_until[symbol] = exit_day
    return kept


def liquidity(rows, day):
    """Average dollar volume of the 20 bars before the day, written from the rule."""
    window = [b for b in rows if b["date"] < day][-20:]
    return fsum(b["c"] * (b.get("v") or 0) for b in window) / len(window) if window else 0.0


def compare_selection(bars, candidates, config, calendar):
    """vectorbt chooses shares under its own cash limit. Returns (cash limited the run, fill count)."""
    config = with_fields(config, max_positions=len(candidates) + 1)  # vectorbt has no position-slot limit
    candidates = expressible(candidates, calendar[0])
    result = replay(bars, candidates, config, calendar)
    symbols, row_of = sorted(bars), {d: i for i, d in enumerate(calendar)}
    column_of = {s: i for i, s in enumerate(symbols)}
    close = pd.DataFrame({s: pd.Series({b["date"]: b["c"] for b in bars[s]}) for s in symbols}).reindex(calendar).ffill().bfill()
    close.index = pd.to_datetime(close.index)
    days, width = len(calendar), len(symbols)
    size, kind, price = np.full((days, width), np.nan), np.full((days, width), int(SizeType.Amount)), close.to_numpy().copy()
    slip, queue, entry_cells = config.extra_slippage_bps / 1e4, {}, []
    for candidate in candidates:
        symbol, entry_day = candidate["symbol"], candidate["entryDate"]
        row, column = row_of[entry_day], column_of[symbol]
        kind[row, column], price[row, column] = int(SizeType.Value), candidate["entry"] * (1 + slip)
        entry_cells.append((row, column))
        queue.setdefault(row, []).append((1, -liquidity(bars[symbol], entry_day), symbol, column))
        for leg in candidate["exits"]:
            row = row_of[leg["date"]]
            open_px = next(b["o"] for b in bars[symbol] if b["date"] == leg["date"])
            size[row, column], price[row, column] = -np.inf, leg["px"] * (1 - slip)
            queue.setdefault(row, []).append((0 if leg["px"] == open_px else 2, 0.0, symbol, column))
    order = np.tile(np.arange(width), (days, 1))
    for row, items in queue.items():
        listed = [item[-1] for item in sorted(items)]
        order[row] = listed + [c for c in range(width) if c not in listed]

    def simulate(prior_value):
        for row, column in entry_cells:
            size[row, column] = prior_value[row] * config.position_pct / 100
        return vbt.Portfolio.from_orders(close, size=size, size_type=kind, price=price, val_price=price, direction="longonly", fees=config.cost_bps / 1e4,
                                         size_granularity=1.0, init_cash=config.initial_cash, cash_sharing=True, group_by=True, call_seq=order, freq="1D", log=False)

    # Each entry is sized from vectorbt's own value the day before, which needs only earlier days, so this settles.
    value = np.full(days, config.initial_cash)
    for _ in range(len(entry_cells) + 2):
        portfolio = simulate(np.r_[config.initial_cash, value[:-1]])
        updated = portfolio.value().to_numpy()
        if np.array_equal(updated, value):
            break
        value = updated
    else:
        raise AssertionError("vectorbt sizing did not settle")

    decided = sorted((calendar[r["idx"]], symbols[r["col"]], "buy" if r["side"] == OrderSide.Buy else "sell", int(round(r["size"]))) for r in portfolio.orders.values)
    expected = sorted((f["date"], f["symbol"], f["side"], f["shares"]) for f in result["fills"])
    assert decided == expected, f"vectorbt chose different fills: {sorted(set(decided) ^ set(expected))[:6]}"
    limit = 1e-6 * config.initial_cash
    assert np.abs(value - np.array([p["equity"] for p in result["curve"]])).max() <= limit, "vectorbt equity differs after its own selection"
    assert np.abs(portfolio.cash().to_numpy() - np.array([p["cash"] for p in result["curve"]])).max() <= limit, "vectorbt cash differs after its own selection"
    return bool(result["rejected"]["no_cash"] or result["reduced"]), len(result["fills"])


COMPARED = {"generated": 0, "selection": 0, "constrained": 0}
MIN_CONSTRAINED = 100


@settings(max_examples=1500, deadline=None, derandomize=True, database=None, suppress_health_check=list(HealthCheck))
@given(scenarios())
def check_generated(scenario):
    bars, candidates, config, calendar = scenario
    bars = without_adj(bars)
    result = replay(bars, candidates, config, calendar)
    assume(compare_vectorbt(bars, result, config, calendar))
    COMPARED["generated"] += 1


@st.composite
def contested(draw):
    """Same-day entries and exits under tight cash, where order and settlement decide who gets filled."""
    calendar = calendar_of(draw(st.integers(4, 25)))
    bars = {symbol: [{"date": day, "o": px, "h": px * 1.02, "l": px, "c": px, "v": draw(st.sampled_from([0, 100, 1000, 100000]))} for day in calendar for px in [draw(st.sampled_from([10.0, 20.0, 25.0]))]]
            for symbol in "ABC"}
    candidates = []
    for symbol, rows in bars.items():
        for i in draw(st.lists(st.integers(1, len(rows) - 2), max_size=5, unique=True)):
            out = rows[draw(st.integers(i + 1, len(rows) - 1))]
            px = out["o"] if draw(st.booleans()) else out["o"] * 1.02  # filled at the open, or intraday
            candidates.append({"symbol": symbol, "entryDate": rows[i]["date"], "entry": rows[i]["o"], "stop": 1.0, "exits": [{"date": out["date"], "px": px, "qty": 1.0, "why": "x"}]})
    return bars, candidates, Config(1000.0, draw(st.sampled_from([40.0, 60.0, 100.0])), 3, draw(st.sampled_from([0.0, 10.0])), draw(st.sampled_from([0.0, 5.0]))), calendar


def record_selection(scenario):
    bars, candidates, config, calendar = scenario
    constrained, _ = compare_selection(without_adj(bars), candidates, config, calendar)
    COMPARED["selection"] += 1
    COMPARED["constrained"] += constrained


SELECTION = settings(max_examples=800, deadline=None, derandomize=True, database=None, suppress_health_check=list(HealthCheck))


@SELECTION
@given(scenarios())
def check_generated_selection(scenario):
    record_selection(scenario)


@SELECTION
@given(contested())
def check_contested_selection(scenario):
    record_selection(scenario)


def check_dataset(dataset):
    bars = dataset["bars"]
    calendar = sorted({b["date"] for rows in bars.values() for b in rows})
    for strategy in dataset["strategies"]:
        ample = Config(1e12, 0.1, 100000, 10.0, 0.0)
        result = replay(without_adj(bars), strategy["candidates"], ample, calendar)
        expected = {(t["symbol"], t["entryDate"]): t["pnl"] / t["entry"] * 100 for t in strategy["engineClosed"] if t["entryDate"] > calendar[0]}
        got = {(t["symbol"], t["entryDate"]): t["returnPct"] for t in result["closed"]}
        assert got.keys() == expected.keys(), f"{strategy['id']}: trades differ: {sorted(got.keys() ^ expected.keys())[:5]}"
        worst = max((abs(got[k] - expected[k]) for k in got), default=0.0)
        assert worst <= SHARE_ROUNDING_PCT, f"{strategy['id']}: per-trade return differs by {worst} points"

        realistic = Config(100_000.0, 10.0, 10, 10.0, 0.0)
        plain = without_adj(bars)
        limited = replay(plain, strategy["candidates"], realistic, calendar)
        expressible = compare_vectorbt(plain, limited, realistic, calendar)
        print(f"  {dataset['name']}/{strategy['id']}: {len(got)} trades match the engine (worst {worst:.2e} pts); vectorbt {'matched ' + str(len(limited['fills'])) + ' fills' if expressible else 'skipped: same-bar round trips'}")
        constrained, chosen = compare_selection(plain, strategy["candidates"], Config(100_000.0, 25.0, 100, 10.0, 0.0), calendar)
        print(f"  {dataset['name']}/{strategy['id']}: vectorbt independently chose the same {chosen} fills (cash limited: {constrained})")

    for symbol, events in dataset["dividends"].items():
        rows = bars[symbol]
        derived = derive_dividends(rows)
        # Yahoo's dividend history covers five years; stay inside it so non-payers are tested too.
        cutoff = (date.fromisoformat(rows[-1]["date"]) - timedelta(days=DECLARED_HISTORY_DAYS)).isoformat()
        declared = {e["date"]: e["amount"] for e in events if cutoff <= e["date"] <= rows[-1]["date"]}
        recent = {d: a for d, a in derived.items() if d >= cutoff}
        assert recent.keys() == declared.keys(), f"{symbol}: ex-dates differ: {sorted(recent.keys() ^ declared.keys())[:6]}"
        for day, amount in declared.items():
            assert abs(recent[day] - amount) <= max(0.005, 0.01 * amount), f"{symbol} {day}: derived {recent[day]} vs declared {amount}"
        print(f"  {dataset['name']}/{symbol}: {len(declared)} declared dividends match")


def main():
    for dataset in json.load(open(sys.argv[1])):
        check_dataset(dataset)
    check_generated()
    check_generated_selection()
    check_contested_selection()
    assert COMPARED["constrained"] >= MIN_CONSTRAINED, f"only {COMPARED['constrained']} generated runs were limited by cash"
    print(f"OK: vectorbt matched the replay on {COMPARED['generated']} generated portfolios, and chose the same fills itself on {COMPARED['selection']} ({COMPARED['constrained']} limited by cash)")


if __name__ == "__main__":
    main()
