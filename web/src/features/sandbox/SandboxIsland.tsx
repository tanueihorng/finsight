import { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { api } from '../../api/client.ts';
import { useAccounts } from '../../api/queries.ts';
import { useBook } from '../paper/book.ts';
import { useModalFocus } from '../../ui/modalFocus.ts';
import overlay from '../../ui/overlay.module.css';
import styles from './sandbox.module.css';
import { closeSandbox } from './open.ts';
import { MAX_DRAFT_TRADES, QUOTE_AGE_LIMIT, SANDBOX_CURRENCY, SANDBOX_SYMBOL, previewSandbox, type DraftTrade, type SandboxSnapshot } from '../../../../shared/sandbox.ts';

type Row = { id: number; side: DraftTrade['side']; symbol: string; quantity: string; price: string; fee: string };
const blank = (id: number): Row => ({ id, side: 'buy', symbol: '', quantity: '', price: '', fee: '0' });
const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
const number = (raw: string) => DECIMAL.test(raw.trim()) ? Number(raw) : NaN;
const display = (n: number | null) => n === null || !Number.isFinite(n) ? '—' : n.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 });
const shares = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 8 });
const percent = (n: number | null) => n === null ? '—' : (n * 100).toFixed(1) + '%';
const time = (n: number) => new Date(n).toLocaleString();

export default function SandboxIsland() {
  const book = useBook();
  const { data, isError } = useAccounts();
  const current = useStore(window.FinSight.store, (s) => s.account);
  const base = useStore(window.FinSight.store, (s) => s.base);
  const [choice, setChoice] = useState('');
  const account = choice || (current && current !== 'ALL' ? current : '');
  const [currency, setCurrency] = useState(base);
  const [rows, setRows] = useState<Row[]>([blank(0)]);
  const [snapshot, setSnapshot] = useState<SandboxSnapshot | null>(null);
  const [cashOverride, setCashOverride] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const sequence = useRef(1);
  const box = useRef<HTMLDivElement>(null);
  const request = useRef<AbortController | null>(null);
  useModalFocus(true, closeSandbox, box);
  useEffect(() => {
    window.addEventListener('finsight:locked', closeSandbox);
    return () => {
      request.current?.abort();
      window.removeEventListener('finsight:locked', closeSandbox);
    };
  }, []);

  const pinned = snapshot?.book === book && snapshot.account === account && snapshot.currency === currency ? snapshot : null;
  const cash = cashOverride.trim() ? number(cashOverride) : pinned?.cash ?? null;
  const activeRows = rows.filter((r) => r.symbol || r.quantity || r.price || r.fee !== '0');
  const draft: DraftTrade[] = activeRows.map((r) => ({
    side: r.side, symbol: r.symbol.trim().toUpperCase(), quantity: number(r.quantity),
    price: r.price.trim() ? number(r.price) : null, fee: number(r.fee),
  }));
  const comparison = pinned ? previewSandbox(pinned, draft, cash) : null;
  const instruments = new Map(pinned?.instruments.map((p) => [p.symbol, p]));
  const change = (id: number, fields: Partial<Row>) => setRows((prev) => prev.map((r) => r.id === id ? { ...r, ...fields } : r));
  const move = (index: number, direction: number) => setRows((prev) => {
    const next = [...prev];
    [next[index], next[index + direction]] = [next[index + direction]!, next[index]!];
    return next;
  });
  const clearSnapshot = () => {
    request.current?.abort();
    setPending(false);
    setSnapshot(null);
    setCashOverride('');
    setError('');
  };
  async function pin() {
    const symbols = [...new Set(draft.map((r) => r.symbol).filter(Boolean))];
    if (symbols.some((s) => !SANDBOX_SYMBOL.test(s))) {
      setError('Check the draft ticker symbols before pinning prices.');
      return;
    }
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    setError('');
    const params = new URLSearchParams({ account, currency });
    symbols.forEach((s) => params.append('symbol', s));
    try {
      const result = await api<SandboxSnapshot>('/api/portfolio/sandbox?' + params, { signal: controller.signal });
      if (!controller.signal.aborted) setSnapshot(result);
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Could not pin a snapshot.');
    } finally {
      if (!controller.signal.aborted) setPending(false);
    }
  }

  return (
    <div className={overlay.scrim}>
      <div ref={box} role="dialog" aria-modal="true" aria-labelledby="sandbox-title" tabIndex={-1} className={`${overlay.dialog} ${styles.dialog}`}>
        <header className={styles.header}>
          <div>
            <h2 id="sandbox-title">Portfolio Sandbox</h2>
            <p>Compare draft trades with a pinned portfolio. This preview places no orders.</p>
          </div>
          <button className={overlay.btn} type="button" onClick={closeSandbox}>Close</button>
        </header>
        <div className={styles.toolbar}>
          <label>Account
            <select value={account} onChange={(e) => { setChoice(e.target.value); clearSnapshot(); }}>
              <option value="" disabled>Choose an account</option>
              {data?.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
          <label>Currency
            <input value={currency} maxLength={3} onChange={(e) => { setCurrency(e.target.value.toUpperCase()); clearSnapshot(); }} />
          </label>
          <button type="button" className={`${overlay.btn} ${overlay.primary}`} disabled={pending || !account || !data?.accounts.some((a) => a.id === account) || !SANDBOX_CURRENCY.test(currency)} onClick={() => void pin()}>
            {pending ? 'Pinning…' : pinned ? 'Refresh snapshot' : 'Pin snapshot'}
          </button>
          <button type="button" className={overlay.btn} onClick={() => { clearSnapshot(); setRows([blank(sequence.current++)]); }}>Reset</button>
        </div>
        {isError && <p role="alert" className={styles.error}>Could not load the account list.</p>}
        {error && <p role="alert" className={styles.error}>{error}</p>}
        {pinned && (
          <div className={styles.pin}>
            <span>{pinned.book.toUpperCase()} · {pinned.name} · {pinned.currency} · Pinned {time(pinned.capturedAt)}</span>
            <label>Opening cash override ({currency})
              <input type="text" inputMode="decimal" placeholder={pinned.cash === null ? 'No recorded balance' : String(pinned.cash)}
                value={cashOverride} onChange={(e) => setCashOverride(e.target.value)} />
            </label>
            <span>{cashOverride ? 'Opening cash uses your assumption.' : pinned.cash === null ? 'Enter a cash assumption, including zero if applicable.' : 'Opening cash uses the recorded balance.'}</span>
          </div>
        )}
        <section className={styles.section} aria-labelledby="sandbox-draft">
          <h3 id="sandbox-draft">Draft trades</h3>
          <p>Trades run from top to bottom. A blank price uses the pinned quote. Refresh the snapshot after adding a ticker that was outside it.</p>
          <datalist id="sandbox-holdings">{pinned?.instruments.filter((p) => !p.exclusion).map((p) => <option key={p.symbol} value={p.symbol} />)}</datalist>
          {rows.map((row, index) => {
            const reference = instruments.get(row.symbol.trim().toUpperCase());
            const rejected = comparison?.row != null && activeRows[comparison.row]?.id === row.id;
            return (
              <fieldset key={row.id} className={styles.trade}>
                <legend>Trade {index + 1}</legend>
                <div className={styles.fields}>
                  <label>Side<select value={row.side} onChange={(e) => change(row.id, { side: e.target.value as Row['side'] })}><option value="buy">Buy</option><option value="sell">Sell</option></select></label>
                  <label>Symbol<input list="sandbox-holdings" value={row.symbol} maxLength={24} placeholder="e.g. VOO" onChange={(e) => change(row.id, { symbol: e.target.value.toUpperCase() })} /></label>
                  <label>Shares<input type="number" min="0" step="any" value={row.quantity} onChange={(e) => change(row.id, { quantity: e.target.value })} /></label>
                  <label>Price<input type="text" inputMode="decimal" value={row.price} placeholder={reference?.price == null ? 'Quote' : String(reference.price)} onChange={(e) => change(row.id, { price: e.target.value })} /></label>
                  <label>Fee<input type="number" min="0" step="any" value={row.fee} onChange={(e) => change(row.id, { fee: e.target.value })} /></label>
                  <div className={styles.actions}>
                    <button type="button" className={overlay.btn} aria-label={`Move trade ${index + 1} up`} disabled={index === 0} onClick={() => move(index, -1)}>↑</button>
                    <button type="button" className={overlay.btn} aria-label={`Move trade ${index + 1} down`} disabled={index === rows.length - 1} onClick={() => move(index, 1)}>↓</button>
                    <button type="button" className={overlay.btn} aria-label={`Remove trade ${index + 1}`} onClick={() => setRows((prev) => prev.filter((r) => r.id !== row.id))}>×</button>
                  </div>
                </div>
                {reference && <p>{row.price.trim() ? 'Assumed execution price' : 'Pinned execution price'} · {quoteLabel(reference)}</p>}
                {rejected && <p role="alert" className={styles.error}>{comparison.error}</p>}
              </fieldset>
            );
          })}
          <button type="button" className={overlay.btn} disabled={rows.length >= MAX_DRAFT_TRADES} onClick={() => setRows((prev) => [...prev, blank(sequence.current++)])}>Add trade</button>
        </section>
        {pinned && comparison && <Results snapshot={pinned} comparison={comparison} cash={cash} />}
      </div>
    </div>
  );
}

function quoteLabel(p: SandboxSnapshot['instruments'][number]) {
  if (p.price === null) return 'Quote unavailable';
  const timestamp = p.marketTime === null ? 'time unavailable' : time(p.marketTime);
  const stale = p.stale || (p.marketTime !== null && Date.now() - p.marketTime > QUOTE_AGE_LIMIT);
  return `Market mark ${p.currency ?? ''} ${display(p.price)} · ${timestamp}${stale ? ' · stale or undated' : ''}`;
}

function Results({ snapshot, comparison, cash }: { snapshot: SandboxSnapshot; comparison: ReturnType<typeof previewSandbox>; cash: number | null }) {
  const { before, result } = comparison;
  const after = result?.after;
  const prior = new Map(before.rows.map((r) => [r.symbol, r]));
  const next = new Map(after?.rows.map((r) => [r.symbol, r]));
  const symbols = [...new Set([...prior.keys(), ...next.keys()])];
  const marks = new Map(snapshot.instruments.map((p) => [p.symbol, p]));
  const excluded = snapshot.instruments.filter((p) => p.exclusion && p.quantity !== 0);
  const concentration = (r: typeof before | undefined) => r?.largest ? `${r.largest.symbol} · ${percent(r.largest.weight)}` : '—';
  return (
    <section className={styles.section} aria-labelledby="sandbox-result">
      <h3 id="sandbox-result">Before and after · {snapshot.currency}</h3>
      <p>Weights use priced securities in this currency. Holdings are valued at pinned quotes, even when you assume a different execution price.</p>
      {comparison.error && comparison.row === null && <p className={styles.error} role="alert">{comparison.error}</p>}
      <table className={styles.table} aria-label="Cash and concentration">
        <thead><tr><th scope="col">Measure</th><th scope="col">Before</th><th scope="col">After</th></tr></thead>
        <tbody>
          <tr><th scope="row">Cash</th><td>{display(cash)}</td><td>{display(result?.cash ?? null)}</td></tr>
          <tr><th scope="row">Priced securities</th><td>{display(before.pricedValue)}</td><td>{display(after?.pricedValue ?? null)}</td></tr>
          <tr><th scope="row">Largest weight</th><td>{concentration(before)}</td><td>{concentration(after)}</td></tr>
          <tr><th scope="row">Draft fees</th><td>—</td><td>{display(result?.fees ?? null)}</td></tr>
        </tbody>
      </table>
      {symbols.length > 0 && (
        <div className={styles.tableScroll} tabIndex={0} role="region" aria-label="Position changes">
          <table className={styles.table}>
            <thead><tr><th scope="col">Position</th><th scope="col">Shares</th><th scope="col">Value</th><th scope="col">Weight</th></tr></thead>
            <tbody>{symbols.map((s) => {
              const a = prior.get(s), b = next.get(s);
              const value = (row: typeof a) => display(row ? row.value : 0);
              return <tr key={s}><th scope="row">{s}<small>{quoteLabel(marks.get(s)!)}</small></th>
                <td>{shares(a?.quantity ?? 0)} → {result ? shares(b?.quantity ?? 0) : '—'}</td>
                <td>{value(a)} → {result ? value(b) : '—'}</td>
                <td>{percent(a?.weight ?? null)} → {result ? percent(b?.weight ?? null) : '—'}</td></tr>;
            })}</tbody>
          </table>
        </div>
      )}
      {(excluded.length > 0 || snapshot.otherCash.length > 0 || before.unpriced > 0 || Boolean(after?.unpriced)) && (
        <div className={styles.coverage}>
          <h4>Outside the priced totals</h4>
          <ul>
            {excluded.map((p) => <li key={p.symbol}>{p.symbol} · {shares(p.quantity)} shares · {p.price !== null && p.currency && `${display(p.price * p.quantity)} ${p.currency} · `}{p.exclusion}</li>)}
            {snapshot.otherCash.map((c) => <li key={c.currency}>Cash · {c.currency} {display(c.amount)}</li>)}
            {before.unpriced > 0 || Boolean(after?.unpriced) ? <li>Positions without marks · {before.unpriced} before{after && ` / ${after.unpriced} after`}</li> : null}
          </ul>
        </div>
      )}
    </section>
  );
}
