"""Executable specification of the portfolio replay, in exact rational arithmetic.

Deliberately shares no code or structure with finsight_quant.portfolio: it scans
the inputs afresh each day instead of building indexes, and uses Fractions, so
floating-point drift and indexing mistakes in the implementation cannot be
mirrored here.
"""
from fractions import Fraction as F
from math import floor


def _bar(rows, day):
    return next((b for b in rows if b["date"] == day), None)


def _latest_close(rows, day):
    known = [b for b in rows if b["date"] <= day]
    return F(known[-1]["c"]) if known else None


def _dividend(rows, day):
    today = _bar(rows, day)
    earlier = [b for b in rows if b["date"] < day]
    if today is None or not earlier:
        return F(0)
    before = earlier[-1]
    if not today.get("adj") or not before.get("adj"):
        return F(0)
    amount = F(before["c"]) - F(before["adj"]) * F(today["c"]) / F(today["adj"])
    return amount if amount / F(before["c"]) > F(1, 100000) else F(0)


def _liquidity(rows, day):
    window = [b for b in rows if b["date"] < day][-20:]
    if not window:
        return F(0)
    return sum(F(b["c"]) * F(b.get("v") or 0) for b in window) / len(window)


def _legs(candidate):
    """Exit legs annotated with whether they empty the position."""
    out, total = [], F(0)
    for leg in candidate["exits"]:
        total += F(leg["qty"])
        out.append((leg, total >= 1))
    return out


def reference_replay(bars, candidates, config, calendar):
    commission = F(config.cost_bps) / 10000
    slippage = F(config.extra_slippage_bps) / 10000
    cash = F(config.initial_cash)
    book = {}  # trade number -> {shares, initial, entry, pnl, symbol, day}
    fills, closed, ledger = [], [], []
    rejected = {"max_positions": 0, "no_cash": 0, "already_held": 0}
    reduced = 0
    dividends_paid = F(0)
    equity_prior = cash
    first, last = calendar[0], calendar[-1]
    canonical = sorted(candidates, key=lambda c: (c["symbol"], c["entryDate"]))
    live = [(n, c) for n, c in enumerate(canonical) if first < c["entryDate"] <= last]

    def settle(number, leg, final, day):
        nonlocal cash
        lot = book[number]
        quantity = lot["shares"] if final else min(lot["shares"], floor(lot["initial"] * F(leg["qty"])))
        if quantity == 0:
            return
        price = F(leg["px"]) * (1 - slippage)
        fee = quantity * price * commission
        cash += quantity * price - fee
        lot["shares"] -= quantity
        lot["pnl"] += quantity * (price - lot["entry"]) - fee
        fills.append((day, lot["symbol"], "sell", quantity))
        if lot["shares"] == 0:
            closed.append((lot["symbol"], lot["day"], day, lot["pnl"], lot["pnl"] / (lot["initial"] * lot["entry"]) * 100))
            del book[number]

    for position, day in enumerate(calendar):
        if position:
            for number in sorted(book):
                lot = book[number]
                paid = lot["shares"] * _dividend(bars[lot["symbol"]], day)
                cash += paid
                lot["pnl"] += paid
                dividends_paid += paid

            todays = [(n, c, leg, final) for n, c in live for leg, final in _legs(c) if leg["date"] == day]

            def at_open(c, leg):
                bar = _bar(bars[c["symbol"]], day)
                return bar is not None and day != c["entryDate"] and leg["px"] == bar["o"]

            for n, c, leg, final in todays:
                if n in book and at_open(c, leg):
                    settle(n, leg, final, day)

            arrivals = sorted((c for c in live if c[1]["entryDate"] == day),
                              key=lambda item: (-_liquidity(bars[item[1]["symbol"]], day), item[1]["symbol"], item[0]))
            for n, c in arrivals:
                if any(lot["symbol"] == c["symbol"] for lot in book.values()):
                    rejected["already_held"] += 1
                elif len(book) >= config.max_positions:
                    rejected["max_positions"] += 1
                else:
                    price = F(c["entry"]) * (1 + slippage)
                    wanted = equity_prior * F(config.position_pct) / 100
                    allowed = min(wanted, cash / (1 + commission))
                    quantity = floor(allowed / price)
                    if quantity < 1:
                        rejected["no_cash"] += 1
                        continue
                    if allowed < wanted and quantity < floor(wanted / price):
                        reduced += 1
                    fee = quantity * price * commission
                    cash -= quantity * price + fee
                    book[n] = {"shares": quantity, "initial": quantity, "entry": price, "pnl": -fee, "symbol": c["symbol"], "day": day}
                    fills.append((day, c["symbol"], "buy", quantity))

            for n, c, leg, final in todays:
                if n in book and not at_open(c, leg):
                    settle(n, leg, final, day)

        holdings = [lot["shares"] * _latest_close(bars[lot["symbol"]], day) for lot in book.values()]
        value = sum(holdings, F(0))
        ledger.append({"date": day, "cash": cash, "value": value, "equity": cash + value, "positions": len(book),
                       "maxWeight": max(holdings) / (cash + value) if holdings else F(0)})
        equity_prior = cash + value

    return {"fills": fills, "closed": closed, "rejected": rejected, "reduced": reduced, "ledger": ledger, "dividends": dividends_paid,
            "open": sorted((lot["symbol"], lot["day"], lot["shares"]) for lot in book.values())}
