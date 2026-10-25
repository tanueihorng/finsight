import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSearch, useWatchlist } from '../../api/queries.ts';
import { api } from '../../api/client.ts';
import type { WatchItem } from '../../../../shared/types.ts';
import { selectSymbol, setChartWatch, setStatus } from '../../legacy/app.ts';
import { PanelHeadSlot } from '../../ui/PanelHeadSlot.tsx';
import { fmt, signClass, signStr } from '../../ui/format.ts';

export default function WatchlistIsland() {
  const q = useWatchlist(), client = useQueryClient();
  const [shown, setShown] = useState(false), [value, setValue] = useState(''), [raw, setRaw] = useState(''), [term, setTerm] = useState(''), [suggest, setSuggest] = useState(false);
  const input = useRef<HTMLInputElement>(null), form = useRef<HTMLFormElement>(null);
  const search = useSearch(term);
  useEffect(() => { const timer = setTimeout(() => setTerm(raw.trim()), 200); return () => clearTimeout(timer); }, [raw]);
  useEffect(() => {
    const click = (e: MouseEvent) => { if (!form.current?.contains(e.target as Node)) setSuggest(false); };
    document.addEventListener('click', click); return () => document.removeEventListener('click', click);
  }, []);
  useEffect(() => { if (q.data) setChartWatch(q.data.watchlist); }, [q.data]);
  useEffect(() => { if (shown) input.current?.focus(); }, [shown]);
  const change = async (symbol: string, remove: boolean) => {
    const result = await api<{ watchlist: WatchItem[] }>(`/api/watchlist/${remove ? 'remove' : 'add'}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ symbol }) });
    await client.cancelQueries({ queryKey: ['watchlist'] }); client.setQueryData(['watchlist'], result);
    await window.FinSight.bus.write(remove ? 'watchlist-remove' : 'watchlist-add');
  };
  const head = <PanelHeadSlot island="watchlist"><button id="watch-toggle" className="mini-btn" onClick={() => { setShown((s) => !s); input.current?.focus(); }}>+ WATCH</button></PanelHeadSlot>;
  const editor = <PanelHeadSlot island="watchlist-form"><form ref={form} id="watch-form" className={`watch-form ${shown ? '' : 'hidden'}`} autoComplete="off" onSubmit={async (e) => {
    e.preventDefault(); const symbol = value.trim().toUpperCase(); if (!symbol) return;
    try { await change(symbol, false); setValue(''); setRaw(''); setSuggest(false); setStatus(`Watching ${symbol}`, 'ok'); }
    catch (error) { setStatus('Watch failed: ' + (error as Error).message, 'err'); }
  }}><div className="add-field"><input ref={input} id="watch-symbol" value={value} placeholder="SYMBOL to watch (e.g. NVDA)" onChange={(e) => { setValue(e.target.value); setRaw(e.target.value); setSuggest(true); }} /><div id="watch-suggest" className={`suggest ${suggest && raw.trim() && search.data?.length && !search.isError ? '' : 'hidden'}`}>{search.data?.map((item, i) => <div data-i={i} key={item.symbol} onClick={() => { setValue(item.symbol); setSuggest(false); }}><span className="s-sym">{item.symbol}</span> <span className="s-meta">{item.name.slice(0, 26)} · {item.exchange}</span></div>)}</div></div><button type="submit" className="mini-btn solid">ADD</button></form></PanelHeadSlot>;
  const list = q.data?.watchlist;
  return <>{head}{editor}{list?.length ? list.map((w) => {
    const remove = <button className="wl-x" data-sym={w.symbol} onClick={(e) => { e.stopPropagation(); void change(w.symbol, true).catch(() => {}); }}>✕</button>;
    if ('error' in w) return <div className="wl-row" key={w.symbol}><span className="wl-sym">{w.symbol}</span><span className="muted small">n/a</span><span />{remove}</div>;
    return <div className="wl-row" data-sym={w.symbol} key={w.symbol} onClick={() => selectSymbol(w.symbol)}><div><span className="wl-sym">{w.symbol}</span> <span className="wl-name">{(w.name || '').slice(0, 16)}</span></div><span className="wl-px">{fmt(w.price, w.price != null && w.price < 10 ? 4 : 2)}</span><span className={`wl-chg ${signClass(w.changePct)}`}>{signStr(w.changePct)}%</span>{remove}</div>;
  }) : q.data && <div className="wl-empty">Empty — add a symbol above, or type <b>WATCH NVDA</b>.</div>}</>;
}
