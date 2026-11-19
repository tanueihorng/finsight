// Property tests for the ledger and import rules behind the SWEEP-002 defects.
// Each property is a rule that must hold for every input, checked against
// seeded random inputs rather than the audit's single examples. The seed is
// fixed so CI is deterministic; PROP_SEED=<n> explores other inputs locally,
// and every failure message carries the seed and the case to replay it.
import { setSymbol, reset } from './helpers.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as pf from '../lib/portfolio.ts';
import { loadPortfolio, viewPositions, viewTransactions, viewCash, viewDividends } from '../lib/store.ts';
import { parseCsv, parseNumberCell } from '../lib/csv.ts';

const SEED = Number(process.env.PROP_SEED ?? 20261119);
function rng(seed: number) { // mulberry32
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const R = rng(SEED);
const int = (lo: number, hi: number) => lo + Math.floor(R() * (hi - lo + 1));
const pick = <T>(xs: readonly T[]) => xs[int(0, xs.length - 1)]!;
const DAY = 864e5;
const day = (n: number) => Date.UTC(2026, 0, n);
const close = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
const main = () => loadPortfolio().accounts[0]!;

type Op = { kind: 'buy' | 'sell'; sym: string; q: number; px: number; d: number | null };
const fmtOp = (o: Op) => `${o.kind} ${o.q} ${o.sym} @${o.px} ${o.d == null ? 'now' : new Date(o.d).toISOString().slice(0, 10)}`;

test('ledger: any sequence of dated buys and sells keeps the ledger consistent', async () => {
  for (let run = 0; run < 40; run++) {
    reset();
    for (const s of ['AAA', 'BBB']) setSymbol(s, { currency: 'USD', price: 50 });
    const ops: Op[] = [];
    for (let i = int(3, 9); i > 0; i--) {
      ops.push({ kind: R() < 0.55 ? 'buy' : 'sell', sym: pick(['AAA', 'BBB']), q: int(1, 20) / pick([1, 2, 4]),
        px: int(0, 20000) / 100, d: R() < 0.15 ? null : day(int(1, 60)) });
    }
    const ctx = (i: number) => `seed ${SEED} run ${run}, op ${i}: ${ops.slice(0, i + 1).map(fmtOp).join(' → ')}`;
    for (const [i, op] of ops.entries()) {
      const before = JSON.stringify(main());
      let accepted = true, realized = 0;
      try {
        if (op.kind === 'buy') await pf.buy(op.sym, op.q, op.px, op.d);
        else ({ realized } = await pf.sell(op.sym, op.q, op.px, undefined, 'USD', op.d));
      } catch { accepted = false; }
      const acc = main();
      // A refused change leaves the account exactly as it was.
      if (!accepted) { assert.equal(JSON.stringify(acc), before, `refused op changed the account (${ctx(i)})`); continue; }
      if (op.kind === 'sell') {
        const tx = acc.transactions.at(-1)!;
        const sold = tx.lotsSold ?? [];
        // No look-ahead: a dated sale only draws on shares bought by its date (one day of slack).
        if (op.d != null) for (const l of sold) assert.ok(l.t == null || l.t < op.d + DAY, `sale drew on a later purchase (${ctx(i)})`);
        // Conservation: the lots drawn add up to the quantity sold.
        assert.ok(close(sold.reduce((s, l) => s + l.q, 0), op.q), `lots drawn ≠ quantity sold (${ctx(i)})`);
        // Realized P&L is costed from exactly those lots.
        assert.ok(close(realized, sold.reduce((s, l) => s + (op.px - l.px) * l.q, 0)), `realized P&L not from the lots drawn (${ctx(i)})`);
      }
      // Holdings agree three ways: position, its lots, and the transaction history.
      for (const sym of ['AAA', 'BBB']) {
        const pos = acc.positions.find((p) => p.symbol === sym);
        const net = acc.transactions.filter((t) => t.symbol === sym).reduce((s, t) => s + (t.type === 'BUY' ? 1 : -1) * (t.quantity ?? 0), 0);
        assert.ok(net > -1e-9, `negative holdings of ${sym} (${ctx(i)})`);
        if (!pos) { assert.ok(close(net, 0), `${sym} missing while ${net} held (${ctx(i)})`); continue; }
        assert.ok(pos.lots.every((l) => l.q > 0), `empty or negative lot in ${sym} (${ctx(i)})`);
        assert.ok(close(pos.quantity, pos.lots.reduce((s, l) => s + l.q, 0)), `${sym} quantity ≠ sum of lots (${ctx(i)})`);
        assert.ok(close(pos.quantity, net), `${sym} quantity ≠ buys − sells (${ctx(i)})`);
      }
    }
  }
});

// Numbers as brokers write them: plain, grouped thousands, scientific, with currency marks.
function randomNumber(): { x: number; dp: number } {
  const dp = int(0, 4);
  const x = int(0, 2_000_000_000) / 10 ** dp * (R() < 0.2 ? -1 : 1);
  return { x, dp };
}
const grouped = (s: string) => s.replace(/^(-?)(\d+)/, (_, sign: string, d: string) => sign + d.replace(/\B(?=(\d{3})+$)/g, ','));
function spellings(x: number, dp: number): string[] {
  const plain = x.toFixed(dp);
  return [plain, grouped(plain), x.toExponential(), `$${plain}`, `US$${grouped(plain)}`, `${plain}USD`, `USD ${grouped(plain)}`, ` ${plain} `];
}

test('numbers: every supported spelling parses to the same value', () => {
  for (let i = 0; i < 400; i++) {
    const { x, dp } = randomNumber();
    for (const s of spellings(x, dp)) assert.ok(close(parseNumberCell(s), x), `seed ${SEED}: "${s}" parsed as ${parseNumberCell(s)}, not ${x}`);
  }
});

test('numbers: malformed cells are rejected, never salvaged into other digits', () => {
  for (let i = 0; i < 400; i++) {
    const digits = String(int(10_000, 99_999_999));
    const at = int(1, digits.length - 1);
    const bad = [
      digits.slice(0, at) + pick(['a', 'x', 'k', '#', '/']) + digits.slice(at), // letter inside the number
      digits.slice(0, at) + ',' + digits.slice(at).padEnd(4, '0') + '0',       // a comma group that is not three digits
      digits + '.' + int(0, 99) + '.' + int(0, 9),                               // two decimal points
    ];
    for (const s of bad) assert.ok(Number.isNaN(parseNumberCell(s)), `seed ${SEED}: malformed "${s}" parsed as ${parseNumberCell(s)}`);
  }
});

test('csv: quantities and prices survive a round trip through a broker-style file', () => {
  for (let run = 0; run < 60; run++) {
    const rows = Array.from({ length: int(1, 6) }, (_, i) => {
      const q = int(1, 5_000_000) / 10 ** int(0, 3), px = int(0, 900_000) / 100;
      return { symbol: `S${run}X${i}`, q, px };
    });
    const cell = (v: number) => { const s = pick(spellings(v, 6).filter((t) => !t.startsWith('USD ') && !t.startsWith(' '))); return s.includes(',') ? `"${s}"` : s; };
    const text = 'Symbol,Quantity,Avg Cost\n' + rows.map((r) => `${r.symbol},${cell(r.q)},${cell(r.px)}`).join('\n');
    const parsed = parseCsv(text);
    assert.equal(parsed.length, rows.length, `seed ${SEED} run ${run}: rows lost\n${text}`);
    rows.forEach((r, i) => {
      assert.ok(close(parsed[i]!.quantity, r.q) && close(parsed[i]!.price, r.px), `seed ${SEED} run ${run}: row ${i} became ${parsed[i]!.quantity} @ ${parsed[i]!.price}\n${text}`);
    });
  }
});

test('imports: a replacement import that fails anywhere leaves the account unchanged', async () => {
  for (let run = 0; run < 15; run++) {
    reset();
    setSymbol('AAA', { currency: 'USD', price: 10 });
    await pf.buy('AAA', int(1, 50), int(1, 100), day(int(1, 30)));
    await pf.setCash('USD', int(0, 1000));
    const before = JSON.stringify(main());
    const good = Array.from({ length: int(0, 5) }, (_, i) => `G${i},${int(1, 9)},${int(1, 9)}`);
    good.splice(int(0, good.length), 0, 'X'.repeat(25) + ',1,1'); // one row with an invalid symbol, anywhere
    await assert.rejects(() => pf.importCsv('symbol,quantity,price\n' + good.join('\n'), true));
    assert.equal(JSON.stringify(main()), before, `seed ${SEED} run ${run}: failed replace changed the account`);
  }
});

test('accounts: a read for an account that does not exist is an error, never another account', async () => {
  reset();
  setSymbol('AAA', { currency: 'USD', price: 10 });
  await pf.buy('AAA', 3, 10);
  const removed = await pf.accountAdd('Temp', 'cash');
  await pf.accountRemove(removed);
  const p = loadPortfolio();
  const ids = [removed, ...Array.from({ length: 20 }, () => 'acc' + Math.floor(R() * 36 ** 8).toString(36))];
  for (const id of ids) {
    for (const read of [viewPositions, viewTransactions, viewCash, viewDividends]) {
      assert.throws(() => read(p, id), /Unknown account/, `seed ${SEED}: ${read.name}(${id}) did not refuse`);
    }
  }
});
