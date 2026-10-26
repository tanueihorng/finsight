import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useStore } from 'zustand';
import { api } from '../../api/client.ts';
import { useAccounts, usePortfolio } from '../../api/queries.ts';
import { setStatus } from '../../legacy/app.ts';
import { fmt, money, moneySigned, signClass, signStr } from '../../ui/format.ts';
import { showToast } from '../../ui/toast.tsx';
import ui from '../../ui/overlay.module.css';
import type { Portfolio, Quote, SearchResult, Position } from '../../../../shared/types.ts';
import { buyStatus } from '../addform/addform.ts';
import { booksFor, closeTrade, localDate, previewBuy, previewSell, sellQty, tradeError, tradeSheet, undoLabel, type Mode } from './trade.ts';
import s from './Trade.module.css';

// Trade sheet: slides in from the right over the page (non-modal, so the
// positions table stays visible) to buy more of or sell a holding, with a
// live preview of cost, new average or realized P&L. Opened from the row
// Buy/Sell buttons and B/S on a focused row.
const store = () => window.FinSight.store;
const FRACS: [number, string][] = [[0.25, '25%'], [0.5, '50%'], [0.75, '75%'], [1, 'All']];
const qty = (n: number) => fmt(n, n % 1 ? 4 : 0);

export default function TradeSheetIsland() {
  const sheet = useStore(tradeSheet, (x) => x.sheet);
  const account = useStore(store(), (x) => x.account);
  const base = useStore(store(), (x) => x.base);
  const selected = useStore(store(), (x) => x.selected);
  const portfolio = usePortfolio().data;
  const accounts = useAccounts().data?.accounts ?? [];
  const [quote, setQuote] = useState<Position>();
  const [searchTerm, setSearchTerm] = useState('');
  const [query, setQuery] = useState(''), [results, setResults] = useState<SearchResult[]>([]), [idx, setIdx] = useState(-1);
  const searchRef = useRef<HTMLInputElement>(null), quoteSeq = useRef(0);
  const heldPosition = portfolio?.positions.find((x) => x.symbol === sheet?.symbol);
  const p = heldPosition ?? (quote?.symbol === sheet?.symbol ? quote : undefined);
  const holdingBooks = booksFor(heldPosition, account, accounts.find((a) => a.id === account)?.name || 'Account');
  const books = sheet?.mode === 'buy' ? accounts.filter((a) => account === 'ALL' || a.id === account).map((a) => {
    const h = holdingBooks.find((b) => b.accountId === a.id);
    return { accountId: a.id, account: a.name, quantity: h?.quantity ?? 0, avgCost: h?.avgCost ?? 0 };
  }) : holdingBooks;
  const [toId, setToId] = useState('');

  const [bookId, setBookId] = useState(''), [q, setQ] = useState(''), [px, setPx] = useState(''), [date, setDate] = useState(localDate());
  const [err, setErr] = useState(''), [busy, setBusy] = useState(false);
  const qtyRef = useRef<HTMLInputElement>(null), sheetRef = useRef<HTMLDivElement>(null);
  const mode: Mode = sheet?.mode ?? 'buy';
  const book = books.find((b) => b.accountId === bookId) ?? books[0];
  const held = book?.quantity ?? 0, avg = book?.avgCost ?? 0;

  useEffect(() => {
    if (!sheet?.newSymbol || sheet.symbol) return;
    quoteSeq.current++; setQuote(undefined); setSearchTerm(''); setQuery(''); setResults([]); setErr('');
    const t = setTimeout(() => searchRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [sheet?.newSymbol, sheet?.symbol === '']);
  useEffect(() => {
    if (!sheet?.newSymbol || !searchTerm.trim()) { setResults([]); return; }
    const ctrl = new AbortController();
    const t = setTimeout(() => { void api<SearchResult[]>('/api/search?q=' + encodeURIComponent(searchTerm.trim()), { signal: ctrl.signal })
      .then((r) => { if (!ctrl.signal.aborted) { setResults(r); setIdx(-1); } }).catch(() => {}); }, 200);
    return () => { ctrl.abort(); clearTimeout(t); };
  }, [searchTerm, sheet?.newSymbol]);
  async function pick(result: SearchResult) {
    const opening = tradeSheet.getState().sheet, request = ++quoteSeq.current;
    setErr('');
    try {
      const quotes = await api<{ quotes: Quote[] }>('/api/quote?symbols=' + encodeURIComponent(result.symbol));
      if (tradeSheet.getState().sheet !== opening || request !== quoteSeq.current) return;
      const q = quotes.quotes[0];
      if (!q || !('price' in q) || q.price == null) throw new Error('Quote unavailable. Try again.');
      setQuote({ symbol: result.symbol, name: q.name || result.name, currency: q.currency || 'USD', last: q.price, changePct: q.changePct ?? 0 } as Position);
      setQuery(result.symbol); setSearchTerm(''); setResults([]);
      tradeSheet.setState({ sheet: { symbol: result.symbol, mode: 'buy', newSymbol: true } });
    } catch (e) { if (request === quoteSeq.current) setErr((e as Error).message); }
  }
  // Fresh fields whenever the sheet opens on a symbol or switches mode.
  useEffect(() => {
    if (!sheet || !p) return;
    const b = books.find((x) => x.accountId === sheet.accountId) ?? books[0];
    setBookId(b?.accountId ?? ''); setToId('');
    setQ(sheet.mode !== 'buy' ? String(b?.quantity ?? '') : '1');
    setPx(p.last ? p.last.toFixed(2) : ''); setDate(localDate()); setErr('');
    // Typing replaces the prefilled count (onFocus selects it).
    setTimeout(() => { const el = qtyRef.current; if (el) { el.focus({ preventScroll: true }); el.select(); } }, 0);
  }, [sheet?.symbol, sheet?.mode, sheet?.accountId, !!p]);
  // Clicking another holding while the sheet is open retargets it.
  useEffect(() => {
    const cur = tradeSheet.getState().sheet;
    if (cur && !cur.newSymbol && selected && selected !== cur.symbol && portfolio?.positions.some((x) => x.symbol === selected)) tradeSheet.setState({ sheet: { symbol: selected, mode: cur.mode } });
  }, [selected]);
  // Esc closes unless focus is in another panel's input (the command bar, a modal).
  useEffect(() => {
    if (!sheet) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.getElementById('app-dialog')) return;
      const a = document.activeElement;
      if (sheetRef.current?.contains(a) || a === document.body || a?.closest('#positions-body')) { e.preventDefault(); closeTrade(); if (sheet.newSymbol) document.getElementById('add-toggle')?.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [!!sheet]);
  // A holding that disappears (sold out elsewhere, account switched) closes the sheet.
  useEffect(() => { if (sheet && !sheet.newSymbol && portfolio && !p) closeTrade(); }, [portfolio, sheet?.symbol]);

  const open = !!sheet;
  const nq = Number(q), npx = Number(px), ccy = p?.currency || 'USD', rate = p?.fxRate ?? 1;
  const buy = previewBuy(held, avg, nq || 0, npx || 0), sell = previewSell(held, avg, nq || 0, npx || 0);
  const setMode = (m: Mode) => { if (sheet) tradeSheet.setState({ sheet: { ...sheet, mode: m, accountId: bookId } }); };

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!p || !book || busy) return;
    if (mode === 'transfer' && (!toId || toId === book.accountId)) return setErr('Choose a different destination account.');
    const today = localDate(), problem = tradeError(mode, nq, npx, held, date, today);
    if (problem) return setErr(problem);
    // Today's trades take the live FX; only a past date asks for that day's rate.
    const d = date && date < today ? date : null;
    const qs = `?base=${encodeURIComponent(base)}&account=${encodeURIComponent(book.accountId)}`;
    const json = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    setBusy(true); setErr('');
    try {
      if (mode === 'buy') {
        await api('/api/portfolio/buy' + qs, json({ symbol: p.symbol, quantity: nq, price: npx, date: d }));
        setStatus(buyStatus(p.symbol, String(nq), String(npx), d), 'ok');
        showToast(`Bought ${qty(nq)} ${p.symbol} at ${money(ccy, npx)}`, { undoLabel: undoLabel('buy', nq, p.symbol) });
        closeTrade(); await window.FinSight.bus.write('buy');
      } else if (mode === 'transfer') {
        await api('/api/portfolio/transfer' + qs, json({ symbol: p.symbol, quantity: nq, toAccount: toId }));
        setStatus(`TRANSFERRED ${nq} ${p.symbol}`, 'ok');
        showToast(`Transferred ${qty(nq)} ${p.symbol}`, { undoLabel: `Transfer ${nq} ${p.symbol}` });
        closeTrade(); await window.FinSight.bus.write('transfer');
      } else {
        const res = await api<Portfolio>('/api/portfolio/sell' + qs, json({ symbol: p.symbol, quantity: nq, price: npx, date: d }));
        setStatus(`SOLD ${nq} ${p.symbol} · realized ${signStr(res.lastRealized)}`, (res.lastRealized ?? 0) >= 0 ? 'ok' : 'err');
        showToast(`Sold ${qty(nq)} ${p.symbol} · ${moneySigned(ccy, res.lastRealized)} realized`, { undoLabel: undoLabel('sell', nq, p.symbol) });
        closeTrade(); await window.FinSight.bus.write('sell');
      }
    } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  }

  return (
    <aside id="trade-sheet" ref={sheetRef} className={`${s.sheet} ${open ? s.open : ''}`} aria-hidden={!open} inert={!open}
      role="dialog" aria-label={p ? `${mode === 'buy' ? 'Buy' : mode === 'transfer' ? 'Transfer' : 'Sell'} ${p.symbol}` : 'Add holding'}>
      {sheet?.newSymbol && <div className={s.search}>
        <label className={s.label} htmlFor="trade-symbol">Find a symbol</label>
        <input id="trade-symbol" ref={searchRef} className={s.input} value={query} role="combobox" aria-label="Symbol" aria-expanded={results.length > 0} aria-controls="trade-suggest" aria-autocomplete="list" aria-activedescendant={idx >= 0 && results[idx] ? `trade-option-${idx}` : undefined}
          onChange={(e) => { quoteSeq.current++; setQuery(e.target.value); setSearchTerm(e.target.value); setIdx(-1); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => results.length ? (i + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length : -1); }
            if (e.key === 'Enter' && results.length) { e.preventDefault(); void pick(results[idx >= 0 ? idx : 0]!); }
            if (e.key === 'Escape' && results.length) { e.stopPropagation(); setResults([]); }
          }} />
        <div id="trade-suggest" role="listbox" aria-label="Symbol suggestions">{results.map((r, i) => <div id={`trade-option-${i}`} key={r.symbol} role="option" aria-selected={i === idx} className={`${s.result} ${i === idx ? s.active : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={() => void pick(r)}>{r.symbol} <span>{r.name}</span></div>)}</div>
        {!p && <><div role="alert" className={s.error}>{err}</div><button type="button" className={s.close} aria-label="Close" onClick={closeTrade}>✕</button></>}
      </div>}
      {p && <form className={s.form} onSubmit={(e) => void submit(e)} autoComplete="off" noValidate>
        <header className={s.head}>
          <div>
            <div className={s.sym}>{p.symbol}</div>
            <div className={s.name}>{p.name || p.symbol}</div>
          </div>
          <div className={s.quote}>
            <div className={s.last}>{fmt(p.last)} <span className={s.ccy}>{ccy}</span></div>
            <div className={`${s.chg} ${signClass(p.changePct)}`}>{signStr(p.changePct)}%</div>
          </div>
          <button type="button" id="trade-close" className={s.close} aria-label="Close" onClick={closeTrade}>✕</button>
        </header>

        <div className={s.seg} role="tablist" aria-label="Trade side">
          {(sheet?.newSymbol ? ['buy'] : ['buy', 'sell', 'transfer'] as Mode[]).map((m) => (
            <button key={m} type="button" role="tab" id={`trade-mode-${m}`} aria-selected={mode === m}
              className={`${s.segBtn} ${mode === m ? (m === 'buy' ? s.segBuy : s.segSell) : ''}`} onClick={() => setMode(m as Mode)}>{m === 'buy' ? 'Buy' : m === 'transfer' ? 'Transfer' : 'Sell'}</button>
          ))}
        </div>

        <label className={s.label} htmlFor="trade-account">Account</label>
        {books.length > 1
          ? <select id="trade-account" className={s.input} value={book?.accountId} onChange={(e) => setBookId(e.target.value)}>
            {books.map((b) => <option key={b.accountId} value={b.accountId}>{b.account} · {qty(b.quantity)} sh</option>)}
          </select>
          : <div id="trade-account" className={s.static}>{book?.account}</div>}

        {mode === 'transfer' && <><label className={s.label} htmlFor="trade-to">To account</label><select id="trade-to" className={s.input} value={toId} onChange={(e) => setToId(e.target.value)}><option value="">Choose account</option>{accounts.filter((a) => a.id !== book?.accountId).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></>}
        <div className={s.row2}>
          <div>
            <label className={s.label} htmlFor="trade-qty">Shares</label>
            <input id="trade-qty" ref={qtyRef} className={`${s.input} ${s.num}`} type="number" inputMode="decimal" step="any" min="0" value={q}
              onFocus={(e) => e.currentTarget.select()} onChange={(e) => { setQ(e.target.value); setErr(''); }} />
          </div>
          {mode !== 'transfer' && <div>
            <label className={s.label} htmlFor="trade-price">Price <span className={s.hint}>{ccy}</span></label>
            <input id="trade-price" className={`${s.input} ${s.num}`} type="number" inputMode="decimal" step="any" min="0" value={px}
              onChange={(e) => { setPx(e.target.value); setErr(''); }} />
          </div>}
        </div>
        <div className={s.helpers}>
          {mode !== 'buy'
            ? FRACS.map(([f, l]) => <button key={l} type="button" className={s.chip} onClick={() => { setQ(String(sellQty(held, f))); setErr(''); }}>{l}</button>)
            : <span className={s.hint}>&nbsp;</span>}
          {mode !== 'transfer' && p.last > 0 && Number(px) !== Number(p.last.toFixed(2)) &&
            <button type="button" className={`${s.chip} ${s.chipLink}`} onClick={() => setPx(p.last.toFixed(2))}>Use last {fmt(p.last)}</button>}
        </div>

        {mode !== 'transfer' && <><label className={s.label} htmlFor="trade-date">Trade date</label>
        <input id="trade-date" className={s.input} type="date" max={localDate()} value={date} onChange={(e) => { setDate(e.target.value); setErr(''); }} />
        {date && date < localDate() && <div className={s.note}>Records that day's exchange rate for the FX split.</div>}</>}

        <dl className={s.summary} id="trade-preview">
          <div><dt>You hold</dt><dd>{qty(held)} @ {fmt(avg)}</dd></div>
          {mode === 'transfer' ? <><div><dt>Position after</dt><dd>{qty(Math.max(0, held - nq))} sh</dd></div><div className={s.note}>Original lot dates, cost and FX are preserved. No realized P&amp;L.</div></> : mode === 'buy' ? <>
            <div><dt>Cost</dt><dd>{money(ccy, buy.cost)}{ccy !== base && p.fxRate != null && <span className={s.dim}> ≈ {money(base, buy.cost * rate)}</span>}</dd></div>
            <div><dt>New average</dt><dd>{fmt(buy.newAvg)}{held > 0 && nq > 0 && <span className={s.dim}> {buy.newAvg >= avg ? '▲' : '▼'} {fmt(Math.abs(buy.newAvg - avg))}</span>}</dd></div>
            <div><dt>Position after</dt><dd>{qty(buy.after)} sh</dd></div>
          </> : <>
            <div><dt>Proceeds</dt><dd>{money(ccy, sell.proceeds)}{ccy !== base && p.fxRate != null && <span className={s.dim}> ≈ {money(base, sell.proceeds * rate)}</span>}</dd></div>
            <div><dt>Realized P&amp;L</dt><dd id="trade-realized" className={signClass(sell.realized)}>{moneySigned(ccy, sell.realized)} <span>({signStr(sell.realizedPct, 1)}%)</span></dd></div>
            <div><dt>Position after</dt><dd>{sell.after > 1e-9 ? `${qty(sell.after)} sh` : 'Closed'}</dd></div>
          </>}
        </dl>

        <div id="trade-error" className={s.error} role="alert">{err}</div>
        <button type="submit" id="trade-submit" className={`${ui.btn} ${s.submit} ${mode === 'buy' ? ui.primary : ui.danger}`} disabled={busy || !book || (!!sheet?.newSymbol && query.trim().toUpperCase() !== p.symbol)}>
          {busy ? 'Recording…' : mode === 'buy' ? 'Record buy' : mode === 'transfer' ? 'Record transfer' : 'Record sell'}
        </button>
        <div className={s.keys}><span><kbd>↵</kbd> record</span><span><kbd>esc</kbd> close</span></div>
      </form>}
    </aside>
  );
}
