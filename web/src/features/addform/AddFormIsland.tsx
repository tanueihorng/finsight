import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useStore } from 'zustand';
import { api } from '../../api/client.ts';
import { blockIfAll, setStatus } from '../../legacy/app.ts';
import type { SearchResult } from '../../../../shared/types.ts';
import { buyQS, buyStatus, moveIndex } from './addform.ts';

// Add form + symbol search (D2). The + ADD button stays in the legacy panel
// head (it is shared with CASH/IMPORT/EXPORT/UNDO until D3/D4) and toggles
// store.addFormOpen, as does the setup wizard's "add manually" choice. Keeps the legacy ids and classes for specs and styles.css.
export default function AddFormIsland() {
  const open = useStore(window.FinSight.store, (s) => s.addFormOpen);
  const [symbol, setSymbol] = useState(''), [qty, setQty] = useState(''), [price, setPrice] = useState(''), [date, setDate] = useState('');
  // query follows typing only: picking a suggestion sets the value without a new search, like legacy.
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<SearchResult[]>([]), [shown, setShown] = useState(false), [idx, setIdx] = useState(-1);
  const symbolRef = useRef<HTMLInputElement>(null), qtyRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (open) symbolRef.current?.focus(); }, [open]);
  useEffect(() => {
    const outside = (e: MouseEvent) => { if (!(e.target as Element | null)?.closest?.('.add-field')) setShown(false); };
    document.addEventListener('click', outside);
    return () => document.removeEventListener('click', outside);
  }, []);

  // 200 ms debounce; a newer keystroke cancels the older request.
  useEffect(() => {
    const q = query.trim();
    if (!q) { setShown(false); return; }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await api<SearchResult[]>('/api/search?q=' + encodeURIComponent(q), { signal: ctrl.signal });
        setItems(res); setIdx(-1); setShown(res.length > 0);
      } catch { if (!ctrl.signal.aborted) setShown(false); }
    }, 200);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [query]);

  const pick = (s: SearchResult | undefined) => {
    if (!s) return;
    setSymbol(s.symbol); setShown(false);
    qtyRef.current?.focus();
  };

  const onKey = (e: KeyboardEvent) => {
    if (!shown) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => moveIndex(i, e.key === 'ArrowDown' ? 1 : -1, items.length)); }
    else if (e.key === 'Enter' && idx >= 0) { e.preventDefault(); pick(items[idx]); }
    else if (e.key === 'Escape') setShown(false);
  };
  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const sym = symbol.trim().toUpperCase(), d = date || null;
    if (!sym || !qty || !price) return setStatus('Fill symbol, quantity and average price.', 'err');
    if (blockIfAll()) return;
    try {
      await api('/api/portfolio/buy' + buyQS(window.FinSight.store.getState()), { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: sym, quantity: qty, price, date: d }) });
      setStatus(buyStatus(sym, qty, price, d), 'ok');
      setSymbol(''); setQuery(''); setQty(''); setPrice(''); setDate(''); setShown(false);
      await window.FinSight.bus.write('buy');
    } catch (err) { setStatus('ADD failed: ' + (err as Error).message, 'err'); }
  };

  return (
    <form id="add-form" className={open ? 'add-form' : 'add-form hidden'} autoComplete="off" onSubmit={(e) => void onSubmit(e)}>
      <div className="add-field">
        <input id="add-symbol" ref={symbolRef} placeholder="SYMBOL (e.g. AAPL)" value={symbol} onChange={(e) => { setSymbol(e.target.value); setQuery(e.target.value); }} onKeyDown={onKey} />
        <div id="add-suggest" className={shown ? 'suggest' : 'suggest hidden'}>
          {items.map((s, i) => (
            <div key={s.symbol + i} data-i={i} className={i === idx ? 'active' : undefined} onClick={() => pick(s)}>
              <span className="s-sym">{s.symbol}</span> <span className="s-meta">{s.name.slice(0, 30)} · {s.exchange} · {s.type}</span>
            </div>
          ))}
        </div>
      </div>
      <input id="add-qty" ref={qtyRef} type="number" step="any" min="0" placeholder="QTY" value={qty} onChange={(e) => setQty(e.target.value)} />
      <input id="add-price" type="number" step="any" min="0" placeholder="AVG PRICE" value={price} onChange={(e) => setPrice(e.target.value)} />
      <input id="add-date" type="date" title="Optional purchase date — records the real FX rate for an accurate Stock vs FX split" value={date} onChange={(e) => setDate(e.target.value)} />
      <button type="submit" className="mini-btn solid">BUY</button>
    </form>
  );
}
