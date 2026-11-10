"""Systematic mutation testing: proves the checks can actually catch bugs.

Every operator, comparison, constant and side-effect statement in the worker is
broken one at a time, generated from the syntax tree rather than picked by hand.
A mutant that survives is either equivalent to the original or a verification gap.
The run fails unless the unmodified code passes, every mutant finishes, and every
survivor is listed in REVIEWED with the reason it cannot change a result.

Run: .venv-verify/bin/python -m verify.mutate [workers]
"""
import ast
import concurrent.futures as futures
import copy
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TARGETS = ["portfolio.py", "metrics.py", "validation.py", "__main__.py"]
COMPARE = {ast.Lt: ast.LtE, ast.LtE: ast.Lt, ast.Gt: ast.GtE, ast.GtE: ast.Gt, ast.Eq: ast.NotEq, ast.NotEq: ast.Eq,
           ast.In: ast.NotIn, ast.NotIn: ast.In, ast.Is: ast.IsNot, ast.IsNot: ast.Is}
BINARY = {ast.Add: ast.Sub, ast.Sub: ast.Add, ast.Mult: ast.Div, ast.Div: ast.Mult, ast.Pow: ast.Mult}
NAMES = {"min": "max", "max": "min", "floor": "round"}
ATTRIBUTES = {"minimum": "maximum", "maximum": "minimum", "mean": "median", "argmin": "argmax", "argmax": "argmin"}
EXACT_BOUNDARY = "differs only when two floats are exactly equal at a tolerance boundary"
QUANTITY_NOISE = "the tolerance only absorbs float noise in quantity fractions, which is far below 1e-9"
REVIEWED = {
    ("portfolio.py", "Gt->GtE", "if abs(ledger_cash - cash) > RECONCILE_TOLERANCE * max(1.0, config.initial_cash):"): EXACT_BOUNDARY,
    ("portfolio.py", "Gt->GtE", "if abs(ledger_equity - final_equity) > RECONCILE_TOLERANCE * max(1.0, config.initial_cash):"): EXACT_BOUNDARY,
    ("portfolio.py", "Gt->GtE", "if dividend_yield > MIN_DIVIDEND_YIELD:"): EXACT_BOUNDARY,
    ("portfolio.py", "Lt->LtE", "if cash < -RECONCILE_TOLERANCE:"): EXACT_BOUNDARY,
    ("portfolio.py", "GtE->Gt", 'legs.append({**leg, "final": sold >= 1 - 1e-9})'): EXACT_BOUNDARY,
    ("portfolio.py", "1e-09->2e-09", 'legs.append({**leg, "final": sold >= 1 - 1e-9})'): QUANTITY_NOISE,
    ("portfolio.py", "1e-09->2e-09", 'shares = pos.shares if leg["final"] else min(pos.shares, floor(pos.initial_shares * leg["qty"] + 1e-9))'): QUANTITY_NOISE,
    ("validation.py", "Lt->LtE", "restart = rng.random(resamples) < 1 / block_days"): "a random draw exactly equal to 1/21 has probability near zero",
    ("validation.py", "1->2", "levels = np.concatenate([np.ones((resamples, 1)), np.cumprod(1 + paths, axis=1)], axis=1)"): "a second starting 1.0 before the path cannot change a drawdown",
    ("metrics.py", "LtE->Lt", "losses = pnl[pnl <= 0]"): "losses is only summed, and a zero P&L adds zero",
}


def sites(tree):
    """Yields (node, description, mutate) for every place a single fault can go."""
    skip = set()
    for node in ast.walk(tree):
        entry_guard = isinstance(node, ast.If) and isinstance(node.test, ast.Compare) and getattr(node.test.left, "id", "") == "__name__"
        if entry_guard or isinstance(node, ast.Raise) or (isinstance(node, ast.FunctionDef) and node.name == "main"):
            skip.update(id(n) for n in ast.walk(node))
        if isinstance(node, (ast.arg, ast.AnnAssign)) or getattr(node, "returns", None) is not None:
            for annotation in (getattr(node, "annotation", None), getattr(node, "returns", None)):
                if annotation is not None:
                    skip.update(id(n) for n in ast.walk(annotation))
    for node in ast.walk(tree):
        if id(node) in skip:
            continue
        if isinstance(node, ast.Compare):
            for i, op in enumerate(node.ops):
                if type(op) in COMPARE:
                    yield node, f"{type(op).__name__}->{COMPARE[type(op)].__name__}", ("ops", i, COMPARE[type(op)]())
        elif isinstance(node, (ast.BinOp, ast.AugAssign)) and type(node.op) in BINARY:
            yield node, f"{type(node.op).__name__}->{BINARY[type(node.op)].__name__}", ("op", None, BINARY[type(node.op)]())
        elif isinstance(node, ast.BoolOp):
            swap = ast.Or if isinstance(node.op, ast.And) else ast.And
            yield node, f"{type(node.op).__name__}->{swap.__name__}", ("op", None, swap())
        elif isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.Not, ast.USub)):
            yield node, f"drop {type(node.op).__name__}", ("replace_self", None, node.operand)
        elif isinstance(node, ast.Constant) and type(node.value) in (int, float):
            value = node.value + 1 if isinstance(node.value, int) else (node.value * 2 or 1.0)
            yield node, f"{node.value}->{value}", ("value", None, value)
        elif isinstance(node, ast.Name) and node.id in NAMES and isinstance(node.ctx, ast.Load):
            yield node, f"{node.id}->{NAMES[node.id]}", ("id", None, NAMES[node.id])
        elif isinstance(node, ast.Attribute) and node.attr in ATTRIBUTES:
            yield node, f"{node.attr}->{ATTRIBUTES[node.attr]}", ("attr", None, ATTRIBUTES[node.attr])
    for parent in ast.walk(tree):
        for name in ("body", "orelse"):
            statements = getattr(parent, name, None)
            if not isinstance(statements, list):
                continue
            for i, statement in enumerate(statements):
                if id(statement) in skip:
                    continue
                docstring = isinstance(statement, ast.Expr) and isinstance(statement.value, ast.Constant)
                if isinstance(statement, (ast.AugAssign, ast.Continue)) or (isinstance(statement, ast.Expr) and not docstring):
                    yield parent, f"delete statement line {statement.lineno}", ("delete", (name, i), statement)


def build_mutants():
    mutants = []
    for filename in TARGETS:
        source = (ROOT / "finsight_quant" / filename).read_text()
        tree = ast.parse(source)
        count = sum(1 for _ in sites(tree))
        for index in range(count):
            copied = copy.deepcopy(tree)
            node, description, (kind, where, payload) = list(sites(copied))[index]
            line = getattr(node, "lineno", getattr(payload, "lineno", 0))
            if kind == "ops":
                node.ops[where] = payload
            elif kind == "delete":
                getattr(node, where[0])[where[1]] = ast.Pass()
            elif kind == "replace_self":
                for parent in ast.walk(copied):
                    for field, value in ast.iter_fields(parent):
                        if value is node:
                            setattr(parent, field, payload)
                        elif isinstance(value, list) and any(item is node for item in value):
                            value[[item is node for item in value].index(True)] = payload
            else:
                setattr(node, kind, payload)
            mutants.append({"file": filename, "line": line, "what": description, "code": ast.unparse(copied)})
    return mutants


def run_checks(mutant=None):
    """Runs the fast checks on a private copy. Returns the exit code, or None on timeout."""
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        shutil.copytree(ROOT / "finsight_quant", work / "finsight_quant", ignore=shutil.ignore_patterns("__pycache__"))
        shutil.copytree(ROOT / "verify", work / "verify", ignore=shutil.ignore_patterns("__pycache__"))
        if mutant:
            (work / "finsight_quant" / mutant["file"]).write_text(mutant["code"])
        try:
            for module in ("verify.check_replay", "verify.check_validation"):
                done = subprocess.run([str(ROOT / ".venv-verify/bin/python"), "-W", "ignore", "-m", module, "--fast"],
                                      cwd=work, capture_output=True, text=True, timeout=240, env={"PYTHONDONTWRITEBYTECODE": "1", "OMP_NUM_THREADS": "1", "OPENBLAS_NUM_THREADS": "1"})
                if done.returncode != 0:
                    return done.returncode
        except subprocess.TimeoutExpired:
            return None
    return 0


def run_mutant(mutant):
    code = run_checks(mutant)
    return mutant, "timeout" if code is None else "survived" if code == 0 else "killed"


def source_line(mutant):
    return (ROOT / "finsight_quant" / mutant["file"]).read_text().splitlines()[mutant["line"] - 1].strip()


def problems(results, reviewed, line_of=source_line):
    """Everything that stops this run from counting as evidence."""
    found = [] if results else ["no mutants were generated"]
    survivors = set()
    for mutant, outcome in results:
        label = (mutant["file"], mutant["what"], line_of(mutant))
        if outcome == "timeout":
            found.append(f"TIMEOUT {label}")
        elif outcome == "survived":
            survivors.add(label)
            if label not in reviewed:
                found.append(f"UNREVIEWED SURVIVOR {label}")
    found.extend(f"STALE REVIEW, now caught or gone: {label}" for label in reviewed if label not in survivors)
    return found


def main():
    workers = int(sys.argv[1]) if len(sys.argv) > 1 else 8
    if run_checks() != 0:
        print("FAILED: the checks do not pass on the unmodified code, so no mutant result means anything")
        return 1
    mutants = build_mutants()
    with futures.ThreadPoolExecutor(workers) as pool:
        results = list(pool.map(run_mutant, mutants))
    tally = {"killed": 0, "timeout": 0, "survived": 0}
    for mutant, outcome in results:
        tally[outcome] += 1
        if outcome == "survived":
            reason = REVIEWED.get((mutant["file"], mutant["what"], source_line(mutant)), "NOT REVIEWED")
            print(f"SURVIVED {mutant['file']}:{mutant['line']} [{mutant['what']}] {source_line(mutant)} :: {reason}")
    print(f"{len(mutants)} mutants: {tally}")
    found = problems(results, REVIEWED)
    for problem in found:
        print(problem)
    print("FAILED" if found else "OK: every mutant finished and every survivor has a recorded reason")
    return 1 if found else 0


if __name__ == "__main__":
    raise SystemExit(main())
