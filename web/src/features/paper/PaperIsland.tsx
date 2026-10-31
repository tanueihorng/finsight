import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useStore } from 'zustand';
import { api } from '../../api/client.ts';
import { queryDefaults } from '../../api/queries.ts';
import { showToast } from '../../ui/toast.tsx';
import { closeTrade, tradeSheet } from '../trade/trade.ts';
import { useBook } from './book.ts';
import {
  dayChange, emptyForm, fillText, formOrder, limitsBody, limitsText, orderLabel, originLabel, streamLabel, usd,
  type Form, type PaperState, type Settings,
} from './paper.ts';
import s from './Paper.module.css';

// The PAPER panel (FEAT-011): Alpaca paper account, order ticket, Kestrel's
// pending tickets, open and recent orders, and the user's settings for
// Kestrel's orders. Live: the server pushes order, ticket and book events over
// /api/paper/stream; each refetches the state and refreshes the book panels.
const post = <T,>(path: string, body: unknown) => api<T>(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const fail = (e: unknown) => showToast((e as Error).message, { kind: 'err' });

function usePaperState(enabled: boolean) {
  return useQuery({ queryKey: ['paper-state'], enabled, staleTime: 5_000, refetchInterval: 30_000, ...queryDefaults,
    queryFn: () => api<PaperState>('/api/paper/state') });
}

function Connect({ onDone }: { onDone: () => void }) {
  const [keyId, setKeyId] = useState(''), [secret, setSecret] = useState(''), [busy, setBusy] = useState(false), [err, setErr] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { await post('/api/paper/connect', { keyId, secret }); setKeyId(''); setSecret(''); showToast('Alpaca paper connected'); onDone(); }
    catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  };
  return (
    <form className={s.body} onSubmit={(e) => void submit(e)} aria-label="Connect Alpaca paper">
      <p className={s.muted}>Connect a free Alpaca <b>paper</b> account (fake money, US stocks and ETFs). Create one at alpaca.markets, switch to the paper account, and generate API keys there. Paper key ids start with <b>PK</b>; live keys are refused. Keys stay on this computer and are never shown to Kestrel.</p>
      <div className={s.form}>
        <label className={s.field}>API key id<input className={s.input} value={keyId} onChange={(e) => setKeyId(e.target.value)} autoComplete="off" spellCheck={false} placeholder="PK…" /></label>
        <label className={s.field}>Secret key<input className={s.input} type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="off" /></label>
        <button className={`${s.btn} ${s.primary}`} disabled={busy || !keyId || !secret}>{busy ? 'Checking…' : 'Connect paper'}</button>
      </div>
      {err && <div role="alert" className={s.err}>{err}</div>}
    </form>
  );
}

function OrderTicket({ prefill, onPlaced }: { prefill: Form | null; onPlaced: () => void }) {
  const [f, setF] = useState<Form>(emptyForm());
  const [busy, setBusy] = useState(false), [err, setErr] = useState('');
  const symRef = useRef<HTMLInputElement>(null), amtRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (prefill) { setF(prefill); setErr(''); setTimeout(() => (prefill.symbol ? amtRef : symRef).current?.focus(), 30); } }, [prefill]);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const r = formOrder(f);
    if ('error' in r) return setErr(r.error);
    setBusy(true); setErr('');
    try {
      const out = await post<{ placed: boolean; order?: { status: string } }>('/api/paper/orders', r.body);
      showToast(`Paper order sent: ${f.side.toUpperCase()} ${f.symbol.toUpperCase()} (${out.order?.status ?? 'sent'})`);
      setF(emptyForm('', f.side)); onPlaced();
    } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  };
  return (
    <form className={s.sect} onSubmit={(e) => void submit(e)} aria-label="Paper order ticket">
      <h3 className={s.sectH}>ORDER TICKET · PAPER</h3>
      <div className={s.form}>
        <label className={s.field}>Symbol<input id="paper-symbol" ref={symRef} className={s.input} value={f.symbol} onChange={(e) => set('symbol', e.target.value.toUpperCase())} placeholder="AAPL" autoComplete="off" spellCheck={false} /></label>
        <div className={s.field}>Side
          <span className={s.seg} role="group" aria-label="Side">
            <button type="button" className={`${s.segBtn} ${f.side === 'buy' ? s.segBuy : ''}`} aria-pressed={f.side === 'buy'} onClick={() => set('side', 'buy')}>BUY</button>
            <button type="button" className={`${s.segBtn} ${f.side === 'sell' ? s.segSell : ''}`} aria-pressed={f.side === 'sell'} onClick={() => set('side', 'sell')}>SELL</button>
          </span>
        </div>
        <label className={s.field}>Size by
          <select className={s.select} value={f.sizeBy} onChange={(e) => set('sizeBy', e.target.value as Form['sizeBy'])}><option value="qty">Shares</option><option value="usd">USD amount</option></select>
        </label>
        <label className={s.field}>{f.sizeBy === 'qty' ? 'Shares' : 'USD'}<input id="paper-amount" ref={amtRef} className={s.input} inputMode="decimal" value={f.amount} onChange={(e) => set('amount', e.target.value)} placeholder={f.sizeBy === 'qty' ? '10' : '500'} /></label>
        <label className={s.field}>Type
          <select className={s.select} value={f.type} onChange={(e) => set('type', e.target.value as Form['type'])}><option value="market">Market</option><option value="limit">Limit</option></select>
        </label>
        {f.type === 'limit' && <label className={s.field}>Limit price<input className={s.input} inputMode="decimal" value={f.limitPrice} onChange={(e) => set('limitPrice', e.target.value)} /></label>}
        <label className={s.field}>Time in force
          <select className={s.select} value={f.tif} onChange={(e) => set('tif', e.target.value as Form['tif'])}><option value="day">Day</option><option value="gtc">Good till cancelled</option></select>
        </label>
        <button id="paper-submit" className={`${s.btn} ${s.primary}`} disabled={busy}>{busy ? 'Sending…' : `Place paper ${f.side}`}</button>
      </div>
      {err && <div role="alert" className={s.err} style={{ marginTop: 6 }}>{err}</div>}
    </form>
  );
}

function KestrelSettings({ settings, onSaved }: { settings: Settings; onSaved: () => void }) {
  const l = settings.limits;
  const [approval, setApproval] = useState(settings.approval);
  const [v, setV] = useState({ maxOrderUsd: l.maxOrderUsd?.toString() ?? '', maxOrdersPerDay: l.maxOrdersPerDay?.toString() ?? '', maxPositionPct: l.maxPositionPct?.toString() ?? '', symbols: (l.symbols ?? []).join(', ') });
  const [busy, setBusy] = useState(false);
  const save = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true);
    try { await post('/api/paper/settings', { approval, limits: limitsBody(v) }); showToast('Kestrel paper settings saved'); onSaved(); }
    catch (x) { fail(x); } finally { setBusy(false); }
  };
  const field = (k: keyof typeof v, label: string, ph: string) => (
    <label className={s.field}>{label}<input className={s.input} value={v[k]} onChange={(e) => setV((x) => ({ ...x, [k]: e.target.value }))} placeholder={ph} /></label>
  );
  return (
    <form className={s.sect} onSubmit={(e) => void save(e)} aria-label="Kestrel paper trading settings">
      <h3 className={s.sectH}>KESTREL'S PAPER ORDERS</h3>
      <div className={s.radio} role="radiogroup" aria-label="Approval">
        <label><input type="radio" name="paper-approval" checked={approval === 'ask'} onChange={() => setApproval('ask')} />
          <span>Ask me first<small>Each Kestrel order waits here for your Approve or Reject.</small></span></label>
        <label><input type="radio" name="paper-approval" checked={approval === 'auto'} onChange={() => setApproval('auto')} />
          <span>Autonomous<small>Kestrel's orders go to Alpaca paper at once, within the limits below.</small></span></label>
      </div>
      <p className={s.muted} style={{ margin: '8px 0 6px' }}>Limits for Kestrel's orders (leave empty for none). Now: {limitsText(l)}.</p>
      <div className={s.form}>
        {field('maxOrderUsd', 'Max order (US$)', 'none')}
        {field('maxOrdersPerDay', 'Orders per day', 'none')}
        {field('maxPositionPct', 'Max position %', 'none')}
        {field('symbols', 'Only these symbols', 'any')}
        <button className={s.btn} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </form>
  );
}

export default function PaperIsland() {
  const current = useBook();
  const paper = current === 'paper';
  const qc = useQueryClient();
  const { data, error, refetch } = usePaperState(paper);
  const [prefill, setPrefill] = useState<Form | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const refresh = () => { void refetch(); };
  // Live updates from the server.
  useEffect(() => {
    if (!paper || typeof EventSource !== 'function') return;
    const es = new EventSource('/api/paper/stream');
    // One order arrives as several events (new, fill, book): refresh once per burst.
    let t: ReturnType<typeof setTimeout> | undefined, book = false;
    es.onmessage = (m) => {
      let e: { kind?: string } = {};
      try { e = JSON.parse(m.data); } catch { return; }
      if (e.kind === 'hello') return;
      book ||= e.kind === 'book';
      clearTimeout(t);
      t = setTimeout(() => {
        void qc.invalidateQueries({ queryKey: ['paper-state'] });
        if (book) { book = false; void window.FinSight.bus.write('buy'); }
      }, 200);
    };
    return () => { clearTimeout(t); es.close(); };
  }, [paper, qc]);
  // Buy/Sell on a position row or + ADD opens this ticket instead of the REAL trade sheet.
  const sheet = useStore(tradeSheet, (x) => x.sheet);
  useEffect(() => {
    if (!paper || !sheet) return;
    setPrefill(emptyForm(sheet.symbol || '', sheet.mode === 'sell' ? 'sell' : 'buy'));
    closeTrade();
    hostRef.current?.closest('.panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [paper, sheet]);

  if (!paper) return null;
  if (error && !data) return <div className={s.body}><span className={s.err}>{(error as Error).message}</span></div>;
  if (!data) return <div className={s.body}><span className={s.muted}>Loading paper account…</span></div>;
  if (!data.connected) return <div ref={hostRef}><Connect onDone={refresh} /></div>;
  const a = data.account, chg = dayChange(a), pending = data.tickets.filter((t) => t.status === 'pending');
  const decide = async (id: string, approve: boolean) => {
    try { const r = await post<{ status: string }>('/api/paper/tickets/decide', { id, approve }); showToast(approve ? 'Approved: sent to Alpaca paper' : 'Rejected'); void r; }
    catch (x) { fail(x); } finally { refresh(); }
  };
  const cancel = async (id: string) => { try { await post('/api/paper/orders/cancel', { id }); showToast('Cancel sent'); } catch (x) { fail(x); } finally { refresh(); } };
  const disconnect = async () => { try { await post('/api/paper/disconnect', {}); refresh(); } catch (x) { fail(x); } };
  return (
    <div className={s.body} ref={hostRef}>
      <div className={s.row}>
        <span><i className={`${s.dot} ${data.stream.state === 'live' ? s.live : ''}`} aria-hidden="true" />Order stream {streamLabel[data.stream.state]}</span>
        {a && <span className={s.muted}>Alpaca paper {a.number} · {a.status}</span>}
        {data.sync.syncedAt && <span className={s.muted}>book synced {new Date(data.sync.syncedAt).toLocaleTimeString([], { hour12: false })}</span>}
      </div>
      {data.error && <div role="alert" className={s.err}>{data.error}</div>}
      {data.sync.error && <div role="alert" className={s.err}>Book sync: {data.sync.error}</div>}
      {data.sync.drift.length > 0 && <div className={s.err}>Book differs from Alpaca: {data.sync.drift.join('; ')}</div>}
      {data.sync.skipped.length > 0 && <div className={s.muted}>Not mirrored in the book: {data.sync.skipped.map((x) => `${x.side} ${x.qty} ${x.symbol} (${x.reason})`).join('; ')}</div>}
      {a && (
        <div className={s.stats}>
          <div className={s.stat}><span className={s.statK}>EQUITY</span><span className={s.statV}>{usd(a.equity)}</span></div>
          <div className={s.stat}><span className={s.statK}>DAY</span><span className={`${s.statV} ${chg && chg.abs < 0 ? s.down : s.up}`}>{chg ? `${chg.abs >= 0 ? '+' : ''}${usd(chg.abs)} (${chg.pct.toFixed(2)}%)` : '—'}</span></div>
          <div className={s.stat}><span className={s.statK}>CASH</span><span className={s.statV}>{usd(a.cash)}</span></div>
          <div className={s.stat}><span className={s.statK}>BUYING POWER</span><span className={s.statV}>{usd(a.buyingPower)}</span></div>
        </div>
      )}

      {pending.length > 0 && (
        <section className={s.sect} aria-label="Kestrel orders awaiting approval">
          <h3 className={s.sectH}>KESTREL WANTS TO PLACE · {pending.length}</h3>
          <ul className={s.list}>
            {pending.map((t) => (
              <li key={t.id} className={s.item} data-ticket={t.id}>
                <span className={`${s.tag} ${s.tagK}`}>KESTREL</span>
                <span className={s.itemMain}>{orderLabel(t.order)}{t.estimate?.valueUsd != null && <span className={s.muted}> · ≈{usd(t.estimate.valueUsd)} ({t.estimate.priceSource})</span>}</span>
                <button className={`${s.btn} ${s.primary}`} onClick={() => void decide(t.id, true)}>Approve</button>
                <button className={s.btn} onClick={() => void decide(t.id, false)}>Reject</button>
                {t.note && <span className={s.note}>{t.note}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <OrderTicket prefill={prefill} onPlaced={refresh} />

      <section className={s.sect} aria-label="Open paper orders">
        <h3 className={s.sectH}>OPEN ORDERS · {data.openOrders.length}</h3>
        {data.openOrders.length === 0 ? <span className={s.muted}>None.</span> : (
          <ul className={s.list}>
            {data.openOrders.map((o) => (
              <li key={o.id} className={s.item}>
                <span className={`${s.tag} ${o.origin === 'kestrel' ? s.tagK : ''}`}>{originLabel(o.origin)}</span>
                <span className={s.itemMain}>{orderLabel(o)} · {fillText(o)}</span>
                <button className={s.btn} onClick={() => void cancel(o.id)}>Cancel</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={s.sect} aria-label="Recent paper orders">
        <h3 className={s.sectH}>RECENT ORDERS</h3>
        {data.recentOrders.length === 0 ? <span className={s.muted}>No orders yet.</span> : (
          <ul className={s.list}>
            {data.recentOrders.slice(0, 12).map((o) => (
              <li key={o.id} className={s.item}>
                <span className={`${s.tag} ${o.origin === 'kestrel' ? s.tagK : ''}`}>{originLabel(o.origin)}</span>
                <span className={s.itemMain}>{orderLabel(o)} · {fillText(o)}</span>
                <span className={s.muted}>{new Date(o.filledAt || o.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <KestrelSettings key={JSON.stringify(data.settings)} settings={data.settings} onSaved={refresh} />

      <div className={s.row}>
        <span className={s.muted}>Fake money on Alpaca's paper API. Prices in the book come from FinSight's usual quotes; fills come from Alpaca.</span>
        {data.keySource === 'file' && <button className={s.btn} onClick={() => void disconnect()}>Disconnect</button>}
      </div>
    </div>
  );
}
