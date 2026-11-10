"""Synthetic fixtures only: no real portfolio data and no network."""
import json
import math
import subprocess
import sys
import unittest
from pathlib import Path

from finsight_quant.__main__ import run
from finsight_quant.metrics import performance, trading
from finsight_quant.portfolio import Config, ReplayError, derive_dividends, replay

QUANT_ROOT = Path(__file__).resolve().parent.parent
DAYS = [f"2024-01-{d:02d}" for d in range(1, 11)]


def flat(close=100.0, volume=1000, days=DAYS, opens=None):
    return [{"date": d, "o": (opens or {}).get(d, close), "h": close, "l": close, "c": close, "v": volume} for d in days]


def trade(symbol, entry_date, entry, exits=()):
    return {"symbol": symbol, "entryDate": entry_date, "entry": entry, "stop": entry * 0.9, "exits": list(exits)}


def leg(date, px, qty=1.0, why="exit"):
    return {"date": date, "px": px, "qty": qty, "why": why}


def config(cash=1000.0, pct=100.0, slots=5, cost=0.0, slip=0.0):
    return Config(cash, pct, slots, cost, slip)


class Replay(unittest.TestCase):
    def test_round_trip_reconciles_with_costs(self):
        rows = flat(110.0, opens={DAYS[5]: 110.0})
        out = replay({"A": rows}, [trade("A", DAYS[1], 100.0, [leg(DAYS[5], 110.0)])], config(cost=10.0), DAYS)
        shares = 9  # floor(1000 / 1.001 / 100)
        expected = 1000 - shares * 100 * 1.001 + shares * 110 * 0.999
        self.assertAlmostEqual(out["curve"][-1]["equity"], expected)
        self.assertTrue(out["reconciled"])
        self.assertEqual(out["closed"][0]["shares"], shares)

    def test_cash_limits_competing_signals_most_liquid_first(self):
        bars = {"LOW": flat(volume=10), "HIGH": flat(volume=9999)}
        cands = [trade("LOW", DAYS[1], 100.0), trade("HIGH", DAYS[1], 100.0)]
        out = replay(bars, cands, config(pct=100.0), DAYS)
        self.assertEqual([f["symbol"] for f in out["fills"]], ["HIGH"])
        self.assertEqual(out["rejected"]["no_cash"], 1)

    def test_tie_breaks_on_symbol(self):
        bars = {"B": flat(), "A": flat()}
        out = replay(bars, [trade("B", DAYS[1], 100.0), trade("A", DAYS[1], 100.0)], config(), DAYS)
        self.assertEqual(out["fills"][0]["symbol"], "A")

    def test_max_positions(self):
        bars = {"A": flat(), "B": flat()}
        out = replay(bars, [trade("A", DAYS[1], 100.0), trade("B", DAYS[1], 100.0)], config(cash=10000, pct=10, slots=1), DAYS)
        self.assertEqual(len(out["fills"]), 1)
        self.assertEqual(out["rejected"]["max_positions"], 1)

    def test_zero_cash_rejects_entry(self):
        out = replay({"A": flat(5000.0)}, [trade("A", DAYS[1], 5000.0)], config(), DAYS)
        self.assertEqual(out["fills"], [])
        self.assertEqual(out["rejected"]["no_cash"], 1)

    def test_open_exit_funds_same_day_entry(self):
        bars = {"A": flat(), "B": flat()}
        cands = [trade("A", DAYS[1], 100.0, [leg(DAYS[3], 100.0)]), trade("B", DAYS[3], 100.0)]
        out = replay(bars, cands, config(), DAYS)
        self.assertEqual([f["side"] + f["symbol"] for f in out["fills"]], ["buyA", "sellA", "buyB"])

    def test_intraday_exit_does_not_fund_same_day_entry(self):
        bars = {"A": flat(), "B": flat()}
        cands = [trade("A", DAYS[1], 100.0, [leg(DAYS[3], 95.0, why="stop")]), trade("B", DAYS[3], 100.0)]
        out = replay(bars, cands, config(), DAYS)
        self.assertEqual(out["rejected"]["no_cash"], 1)
        self.assertEqual([f["symbol"] for f in out["fills"]], ["A", "A"])

    def test_same_bar_entry_and_stop(self):
        out = replay({"A": flat()}, [trade("A", DAYS[2], 100.0, [leg(DAYS[2], 90.0, why="stop")])], config(), DAYS)
        self.assertEqual(out["closed"][0]["exitDate"], DAYS[2])
        self.assertAlmostEqual(out["curve"][-1]["equity"], 1000 - 10 * 10)

    def test_partial_exit_then_final(self):
        cand = trade("A", DAYS[1], 100.0, [leg(DAYS[3], 130.0, 0.5, "3R"), leg(DAYS[5], 100.0, 0.5, "ema")])
        out = replay({"A": flat()}, [cand], config(), DAYS)
        self.assertEqual([f["shares"] for f in out["fills"]], [10, 5, 5])
        self.assertAlmostEqual(out["curve"][-1]["equity"], 1000 + 5 * 30)

    def test_open_trade_is_marked_not_closed(self):
        out = replay({"A": flat(120.0)}, [trade("A", DAYS[1], 100.0)], config(), DAYS)
        self.assertEqual(out["closed"], [])
        self.assertEqual(out["open"][0]["shares"], 10)
        self.assertAlmostEqual(out["curve"][-1]["equity"], 1200.0)

    def test_rejected_trade_exits_are_ignored(self):
        out = replay({"A": flat(5000.0)}, [trade("A", DAYS[1], 5000.0, [leg(DAYS[3], 5000.0)])], config(), DAYS)
        self.assertEqual(out["fills"], [])

    def test_baseline_day_takes_no_trades(self):
        out = replay({"A": flat()}, [trade("A", DAYS[0], 100.0)], config(), DAYS)
        self.assertEqual(out["fills"], [])

    def test_missing_bar_carries_last_close(self):
        rows = [b for b in flat(110.0) if b["date"] != DAYS[4]]
        out = replay({"A": rows}, [trade("A", DAYS[1], 100.0)], config(), DAYS)
        self.assertAlmostEqual(out["curve"][4]["equity"], 1100.0)

    def test_short_calendar_is_refused(self):
        with self.assertRaises(ReplayError):
            replay({"A": flat()}, [], config(), DAYS[:1])


class Dividends(unittest.TestCase):
    def test_recovered_from_adjusted_close(self):
        rows = flat()
        for i, row in enumerate(rows):
            row["adj"] = 99.0 if i < 4 else 100.0  # 1.00 dividend, ex on DAYS[4]
        self.assertAlmostEqual(derive_dividends(rows)[DAYS[4]], 1.0)
        self.assertEqual(len(derive_dividends(rows)), 1)

    def test_credited_on_shares_held(self):
        rows = flat()
        for i, row in enumerate(rows):
            row["adj"] = 99.0 if i < 4 else 100.0
        out = replay({"A": rows}, [trade("A", DAYS[1], 100.0)], config(), DAYS)
        self.assertAlmostEqual(out["dividends"][0]["amount"], 10.0)
        self.assertAlmostEqual(out["curve"][-1]["equity"], 1010.0)

    def test_dividends_count_in_trade_pnl_and_win_rate(self):
        rows = flat()
        for i, row in enumerate(rows):
            row["adj"] = 99.0 if i < 4 else 100.0
        out = replay({"A": rows}, [trade("A", DAYS[1], 100.0, [leg(DAYS[5], 99.5)])], config(), DAYS)
        self.assertAlmostEqual(out["curve"][-1]["equity"], 1005.0)
        self.assertAlmostEqual(out["closed"][0]["pnl"], 5.0)
        self.assertAlmostEqual(trading(out)["winRatePct"], 100.0)
        self.assertAlmostEqual(trading(out)["expectancyPct"], 0.5)

    def test_open_position_pnl_includes_dividends(self):
        rows = flat()
        for i, row in enumerate(rows):
            row["adj"] = 99.0 if i < 4 else 100.0
        out = replay({"A": rows}, [trade("A", DAYS[1], 100.0)], config(), DAYS)
        self.assertAlmostEqual(out["open"][0]["unrealizedPnl"], 10.0)

    def test_missing_adjusted_close_yields_none(self):
        self.assertEqual(derive_dividends(flat()), {})


class Metrics(unittest.TestCase):
    def test_known_values(self):
        dates = ["2020-01-01", "2021-01-01"]
        result = performance(dates, [100.0, 110.0], 0.0)
        self.assertAlmostEqual(result["totalReturnPct"], 10.0)
        self.assertAlmostEqual(result["cagrPct"], (1.1 ** (365.25 / 366) - 1) * 100)
        self.assertIsNone(result["sharpe"])

    def test_drawdown_and_underwater(self):
        dates = DAYS[:5]
        result = performance(dates, [100.0, 120.0, 90.0, 100.0, 130.0], 0.0)
        self.assertAlmostEqual(result["maxDrawdownPct"], -25.0)
        self.assertEqual(result["maxDrawdownPeak"], DAYS[1])
        self.assertEqual(result["maxDrawdownTrough"], DAYS[2])
        self.assertEqual(result["longestUnderwaterDays"], 2)

    def test_sharpe_uses_sample_deviation_and_risk_free(self):
        dates = DAYS[:4]
        series = [100.0, 101.0, 100.0, 102.0]
        rets = [series[i + 1] / series[i] - 1 for i in range(3)]
        mean = sum(rets) / 3
        sd = math.sqrt(sum((r - mean) ** 2 for r in rets) / 2)
        self.assertAlmostEqual(performance(dates, series, 0.0)["sharpe"], mean / sd * math.sqrt(252))
        self.assertAlmostEqual(performance(dates, series, 2.52)["sharpe"], (mean - 0.0001) / sd * math.sqrt(252))


class Worker(unittest.TestCase):
    def request(self):
        return {"version": 1, "calendar": DAYS, "bars": {"A": flat(110.0)}, "benchmark": {"symbol": "SPY", "bars": flat()},
                "candidates": [trade("A", DAYS[1], 100.0)],
                "config": {"initialCash": 1000.0, "positionPct": 100.0, "maxPositions": 5, "costBps": 0.0, "extraSlippageBps": 0.0, "riskFreePct": 0.0}}

    def test_is_deterministic(self):
        self.assertEqual(json.dumps(run(self.request())), json.dumps(run(self.request())))

    def test_warns_on_small_sample_and_price_only(self):
        warnings = " ".join(run(self.request())["warnings"])
        self.assertIn("too few", warnings)
        self.assertIn("dividends on these are not counted", warnings)
        self.assertIn("benchmark", warnings)

    def test_rejects_unknown_contract(self):
        with self.assertRaises(ReplayError):
            run({**self.request(), "version": 99})


class WorkerIsolation(unittest.TestCase):
    def attempt(self, action):
        script = ("import io, os, socket, subprocess, sys\nfrom finsight_quant.__main__ import main\nsys.stdin = io.StringIO('{}')\nmain()\n"
                  f"try:\n    {action}\nexcept PermissionError as error:\n    print('BLOCKED', error)\n")
        return subprocess.run([sys.executable, "-c", script], cwd=QUANT_ROOT, capture_output=True, text=True, timeout=30).stdout

    def test_worker_cannot_open_a_socket(self):
        self.assertIn("BLOCKED", self.attempt("socket.create_connection(('127.0.0.1', 9), 1)"))

    def test_worker_cannot_resolve_a_host(self):
        self.assertIn("BLOCKED", self.attempt("socket.getaddrinfo('example.com', 443)"))

    def test_worker_cannot_start_a_process(self):
        self.assertIn("BLOCKED", self.attempt("subprocess.run(['/bin/echo', 'x'])"))
        self.assertIn("BLOCKED", self.attempt("os.system('true')"))


if __name__ == "__main__":
    unittest.main()
