"""Replays per-symbol candidate trades through one cash-constrained portfolio.

The JavaScript strategy engines decide entries, exits and fill prices. This
module decides which candidates the portfolio can afford and at what size.

Order of events on each day, chosen so daily bars never imply knowledge of the
intraday sequence:
  1. dividends on shares held at the prior close
  2. exits that filled at the open (their cash is available today)
  3. entries, most liquid first
  4. intraday exits (their cash is available from tomorrow)
"""
from __future__ import annotations

from dataclasses import dataclass
from math import floor

MIN_DIVIDEND_YIELD = 1e-5  # below this an adjclose change is rounding noise
LIQUIDITY_LOOKBACK = 20
RECONCILE_TOLERANCE = 1e-6


class ReplayError(ValueError):
    """The input or the resulting ledger is inconsistent."""


@dataclass(frozen=True)
class Config:
    initial_cash: float
    position_pct: float
    max_positions: int
    cost_bps: float
    extra_slippage_bps: float


@dataclass
class Position:
    trade_id: int
    symbol: str
    entry_date: str
    entry_px: float
    initial_shares: int
    shares: int
    pnl: float
    exit_date: str | None = None


def derive_dividends(bars: list[dict]) -> dict[str, float]:
    """Per-share cash dividends by ex-date, recovered from the adjclose ratio.

    Bars are already split-adjusted, so a change in adj/close between two bars
    can only be a dividend: f[prev] = f[now] * (1 - D / close[prev]).
    """
    out: dict[str, float] = {}
    for prev, now in zip(bars, bars[1:]):
        if not prev.get("adj") or not now.get("adj"):
            continue
        ratio = (prev["adj"] / prev["c"]) / (now["adj"] / now["c"])
        dividend_yield = 1 - ratio
        if dividend_yield > MIN_DIVIDEND_YIELD:
            out[now["date"]] = prev["c"] * dividend_yield
    return out


def _legs_with_final_flag(candidate: dict) -> list[dict]:
    legs, sold = [], 0.0
    for leg in candidate.get("exits", []):
        sold += leg["qty"]
        legs.append({**leg, "final": sold >= 1 - 1e-9})
    return legs


def replay(bars: dict[str, list[dict]], candidates: list[dict], config: Config, calendar: list[str]) -> dict:
    if len(calendar) < 2:
        raise ReplayError("the test window needs at least two trading days")

    cost = config.cost_bps / 1e4
    slip = config.extra_slippage_bps / 1e4
    index = {sym: {b["date"]: i for i, b in enumerate(rows)} for sym, rows in bars.items()}
    dividends = {sym: derive_dividends(rows) for sym, rows in bars.items()}

    candidates = sorted(candidates, key=lambda c: (c["symbol"], c["entryDate"]))  # the result must not depend on input order
    entries_by_day: dict[str, list[tuple[int, dict]]] = {}
    legs_by_day: dict[str, list[tuple[int, dict]]] = {}
    for trade_id, cand in enumerate(candidates):
        if not cand["entry"] > 0:
            raise ReplayError(f"{cand['symbol']}: non-positive entry fill")
        if cand["symbol"] not in index:
            raise ReplayError(f"{cand['symbol']}: candidate has no bars")
        entries_by_day.setdefault(cand["entryDate"], []).append((trade_id, cand))
        for leg in _legs_with_final_flag(cand):
            if leg["date"] < cand["entryDate"] or not 0 < leg["qty"] <= 1 or not leg["px"] > 0:
                raise ReplayError(f"{cand['symbol']}: invalid exit leg on {leg['date']}")
            legs_by_day.setdefault(leg["date"], []).append((trade_id, leg))

    def average_dollar_volume(symbol: str, day: str) -> float:
        rows, i = bars[symbol], index[symbol][day]
        window = rows[max(0, i - LIQUIDITY_LOOKBACK):i]
        return sum(b["c"] * (b.get("v") or 0) for b in window) / len(window) if window else 0.0

    cash = config.initial_cash
    positions: dict[int, Position] = {}
    last_close: dict[str, float] = {}
    closed: list[Position] = []
    fills: list[dict] = []
    dividend_log: list[dict] = []
    rejected = {"max_positions": 0, "no_cash": 0, "already_held": 0}
    reduced = 0
    curve: list[dict] = []
    prev_equity = config.initial_cash

    def sell(trade_id: int, leg: dict, day: str) -> None:
        nonlocal cash
        pos = positions[trade_id]
        shares = pos.shares if leg["final"] else min(pos.shares, floor(pos.initial_shares * leg["qty"] + 1e-9))
        if shares <= 0:
            return
        px = leg["px"] * (1 - slip)
        gross = shares * px
        fee = gross * cost
        cash += gross - fee
        pos.shares -= shares
        pos.pnl += shares * (px - pos.entry_px) - fee
        fills.append({"date": day, "symbol": pos.symbol, "side": "sell", "shares": shares, "px": px, "fee": fee, "why": leg["why"]})
        if pos.shares == 0:
            pos.exit_date = day
            closed.append(positions.pop(trade_id))

    def filled_at_open(trade_id: int, leg: dict, day: str) -> bool:
        symbol = candidates[trade_id]["symbol"]
        row = index[symbol].get(day)
        return row is not None and leg["px"] == bars[symbol][row]["o"]  # engines copy the open price exactly

    for day_index, day in enumerate(calendar):
        for sym, row_by_date in index.items():
            if day in row_by_date:
                last_close[sym] = bars[sym][row_by_date[day]]["c"]
        if day_index == 0:  # baseline: all cash, same starting point as the benchmark
            curve.append({"date": day, "equity": cash, "cash": cash, "value": 0.0, "positions": 0, "maxWeight": 0.0})
            continue

        for trade_id in sorted(positions):
            pos = positions[trade_id]
            per_share = dividends[pos.symbol].get(day)
            if per_share:
                amount = pos.shares * per_share
                cash += amount
                pos.pnl += amount
                dividend_log.append({"date": day, "symbol": pos.symbol, "amount": amount})

        deferred = []
        for trade_id, leg in legs_by_day.get(day, []):
            if trade_id in positions and filled_at_open(trade_id, leg, day):
                sell(trade_id, leg, day)
            else:
                deferred.append((trade_id, leg))

        ordered = sorted(entries_by_day.get(day, []), key=lambda e: (-average_dollar_volume(e[1]["symbol"], day), e[1]["symbol"], e[0]))
        for trade_id, cand in ordered:
            if any(p.symbol == cand["symbol"] for p in positions.values()):
                rejected["already_held"] += 1
                continue
            if len(positions) >= config.max_positions:
                rejected["max_positions"] += 1
                continue
            target = prev_equity * config.position_pct / 100
            budget = min(target, cash / (1 + cost))
            fill = cand["entry"] * (1 + slip)
            shares = floor(budget / fill)
            if shares < 1:
                rejected["no_cash"] += 1
                continue
            if shares < floor(target / fill):
                reduced += 1
            fee = shares * fill * cost
            cash -= shares * fill + fee
            positions[trade_id] = Position(trade_id, cand["symbol"], day, fill, shares, shares, pnl=-fee)
            fills.append({"date": day, "symbol": cand["symbol"], "side": "buy", "shares": shares, "px": fill, "fee": fee, "why": "entry"})

        for trade_id, leg in deferred:
            if trade_id in positions:
                sell(trade_id, leg, day)

        if cash < -RECONCILE_TOLERANCE:
            raise ReplayError(f"cash went negative on {day}: {cash}")

        values = [p.shares * last_close[p.symbol] for p in positions.values()]
        value = sum(values)
        equity = cash + value
        curve.append({"date": day, "equity": equity, "cash": cash, "value": value, "positions": len(positions),
                      "maxWeight": max(values) / equity if values else 0.0})
        prev_equity = equity

    _reconcile(config, fills, dividend_log, positions, last_close, cash, curve[-1]["equity"])

    return {
        "curve": curve,
        "fills": fills,
        "dividends": dividend_log,
        "rejected": rejected,
        "reduced": reduced,
        "closed": [_closed_row(p) for p in closed],
        "open": [{"symbol": p.symbol, "entryDate": p.entry_date, "shares": p.shares, "entryPx": p.entry_px,
                  "markPx": last_close[p.symbol], "unrealizedPnl": p.pnl + p.shares * (last_close[p.symbol] - p.entry_px)}
                 for p in positions.values()],
        "reconciled": True,
    }


def _closed_row(p: Position) -> dict:
    basis = p.initial_shares * p.entry_px
    return {"symbol": p.symbol, "entryDate": p.entry_date, "exitDate": p.exit_date, "shares": p.initial_shares,
            "pnl": p.pnl, "returnPct": p.pnl / basis * 100}


def _reconcile(config: Config, fills: list[dict], dividend_log: list[dict], positions: dict[int, Position],
               last_close: dict[str, float], cash: float, final_equity: float) -> None:
    """Rebuilds cash and holdings from the ledger alone and checks they match."""
    ledger_cash = config.initial_cash + sum(d["amount"] for d in dividend_log)
    shares: dict[str, int] = {}
    for f in fills:
        notional = f["shares"] * f["px"]
        if f["side"] == "buy":
            ledger_cash -= notional + f["fee"]
            shares[f["symbol"]] = shares.get(f["symbol"], 0) + f["shares"]
        else:
            ledger_cash += notional - f["fee"]
            shares[f["symbol"]] = shares.get(f["symbol"], 0) - f["shares"]
    held = {p.symbol: p.shares for p in positions.values()}
    if {s: n for s, n in shares.items() if n} != held:
        raise ReplayError("ledger shares do not match open positions")
    if abs(ledger_cash - cash) > RECONCILE_TOLERANCE * max(1.0, config.initial_cash):
        raise ReplayError("ledger cash does not match replay cash")
    ledger_equity = ledger_cash + sum(n * last_close[s] for s, n in held.items())
    if abs(ledger_equity - final_equity) > RECONCILE_TOLERANCE * max(1.0, config.initial_cash):
        raise ReplayError("ledger equity does not match the equity curve")
