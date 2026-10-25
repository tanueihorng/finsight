import { keyboardClick } from '../../ui/keyboard.ts';
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAlerts } from '../../api/queries.ts';
import { api } from '../../api/client.ts';
import type { Alert } from '../../../../shared/types.ts';
import { selectSymbol, setStatus, requestNotify, publishAlerts, subscribeChartAlerts } from '../../legacy/app.ts';
import { PanelHeadSlot } from '../../ui/PanelHeadSlot.tsx';
import { fmt } from '../../ui/format.ts';
import { createTriggerTracker } from './triggers.ts';
import { createNotifier } from './notify.ts';
export default function AlertsIsland() {
  const q = useAlerts(), client = useQueryClient();
  const [shown, setShown] = useState(false), [symbol, setSymbol] = useState(''), [price, setPrice] = useState(''), [op, setOp] = useState('>');
  const input = useRef<HTMLInputElement>(null), fromChart = useRef(false);
  const [track] = useState(createTriggerTracker), [notifier] = useState(createNotifier);
  useEffect(() => () => notifier.dispose(), []);
  useEffect(() => { if (shown) input.current?.focus(); }, [shown]);
  useEffect(() => {
    let active = true;
    const off = subscribeChartAlerts((alerts) => {
      void client.cancelQueries({ queryKey: ['alerts'] }).then(() => { if (active) { fromChart.current = true; client.setQueryData(['alerts'], { alerts }); } });
    });
    return () => { active = false; off(); };
  }, [client]);
  useEffect(() => {
    if (!q.data) return;
    for (const a of track(q.data.alerts)) notifier.notify('ALERT', `${a.label || a.symbol} — now ${a.currentValue != null ? fmt(a.currentValue) : fmt(a.currentPrice)}`);
    publishAlerts(q.data.alerts, !fromChart.current); fromChart.current = false;
  }, [q.data, q.dataUpdatedAt]);
  const change = async (body: object, remove = false) => {
    const result = await api<{ alerts: Alert[] }>(`/api/alerts/${remove ? 'remove' : 'add'}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    await client.cancelQueries({ queryKey: ['alerts'] }); client.setQueryData(['alerts'], result);
    await window.FinSight.bus.write(remove ? 'alerts-remove' : 'alerts-add');
  };
  const head = <PanelHeadSlot island="alerts"><button id="alert-toggle" aria-expanded={shown} aria-controls="alert-form" className="mini-btn" onClick={() => { setShown((s) => !s); input.current?.focus(); requestNotify(); }}>+ ALERT</button></PanelHeadSlot>;
  const form = <PanelHeadSlot island="alerts-form"><form id="alert-form" className={`alert-form ${shown ? '' : 'hidden'}`} autoComplete="off" onSubmit={async (e) => {
    e.preventDefault(); const s = symbol.trim().toUpperCase(); if (!s || !price) return setStatus('Alert needs a symbol and a price.', 'err');
    try { await change({ symbol: s, op, price }); setSymbol(''); setPrice(''); setStatus(`Alert set: ${s} ${op} ${price}`, 'ok'); requestNotify(); }
    catch (error) { setStatus('Alert failed: ' + (error as Error).message, 'err'); }
  }}><input ref={input} id="alert-symbol" aria-label="Alert symbol" value={symbol} placeholder="SYMBOL" onChange={(e) => setSymbol(e.target.value)} /><select id="alert-op" aria-label="Alert condition" value={op} onChange={(e) => setOp(e.target.value)}><option value=">">rises above ≥</option><option value="<">falls below ≤</option></select><input id="alert-price" aria-label="Alert price" type="number" step="any" min="0" placeholder="PRICE" value={price} onChange={(e) => setPrice(e.target.value)} /><button type="submit" className="mini-btn solid">SET</button></form></PanelHeadSlot>;
  return <>{head}{form}{q.data?.alerts.length ? q.data.alerts.map((a) => <div className={`al-row ${a.met ? 'met' : ''}`} key={a.id}><div><span className="al-sym" role="button" tabIndex={0} onKeyDown={keyboardClick} aria-label={`View ${a.symbol}`} data-sym={a.symbol} onClick={() => selectSymbol(a.symbol)}>{a.symbol}</span> <span className="al-cond">{(a.label || '').replace(a.symbol + ' ', '')}</span><span className="muted small">now {a.currentValue != null ? fmt(a.currentValue) : '—'}{a.level != null && a.kind !== 'price' ? ' · level ' + fmt(a.level) : ''}</span></div><span className="al-badge">{a.met ? 'TRIGGERED' : 'armed'}</span><button className="al-x" aria-label={`Remove alert for ${a.symbol}`} data-id={a.id} onClick={() => { void change({ id: a.id }, true).catch(() => {}); }}>✕</button></div>) : q.data && <div className="al-empty">No alerts — add one above, type <b>ALERT AAPL &gt; 320</b>, or use the bell on the chart (price, trend line, RSI, moving average).</div>}</>;
}
