import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useStore } from 'zustand';
import { api } from '../../api/client.ts';
import { queryDefaults, useHistory, useQuote } from '../../api/queries.ts';
import { loadChartScripts } from '../../legacy/chartScripts.ts';
import type { PriceChartInstance } from '../../legacy/chart.d.ts';
import { showToast } from '../../ui/toast.tsx';
import { fmt, signClass, signStr } from '../../ui/format.ts';
import { CHART_TF_RANGE, fetchRangeFor, RANGES, visibleStart, type DetailRange } from '../detail/detail.ts';
import { closeTrade, tradeSheet } from '../trade/trade.ts';
import { useBook } from './book.ts';
import {
  bookSymbol, chartOrders, dayChange, emptyForm, estimate, fillText, formOrder, limitsBody, limitsText, orderLabel, originLabel, quickAmount, streamLabel, usd,
  type Form, type PaperState, type Settings, type Ticket,
} from './paper.ts';
import s from './Paper.module.css';

// The PAPER trade desk (FEAT-011), laid out like a broker's trading screen:
// account strip, the symbol's chart (fills as B/S markers, open limit orders
// as price lines) with the order ticket docked beside it, and tabs below for
// positions, open orders, history, Kestrel's tickets and Kestrel's settings.
// Live: the server pushes order, ticket and book events over /api/paper/stream;
// each refetches the state, the chart overlay and the book panels.
const post = <T,>(path: string, body: unknown) => api<T>(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const fail = (e: unknown) => showToast((e as Error).message, { kind: 'err' });
const SYMBOL_KEY = 'finsight-paper-symbol';
const savedSymbol = () => { try { return localStorage.getItem(SYMBOL_KEY) || ''; } catch { return ''; } };
const saveSymbol = (v: string) => { try { localStorage.setItem(SYMBOL_KEY, v); } catch { /* per-browser convenience only */ } };
const when = (iso: string) => new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });

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
      <h2 className={s.deskH}>PAPER TRADING · ALPACA <span className={s.muted}>fake money</span></h2>
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

// ---- chart --------------------------------------------------------------------------
// Its own instance of the retained chart (public/chart.js), with its own saved
// settings (cfgKey), so the detail chart and its grid are untouched.
interface DeskChartInstance extends PriceChartInstance { setTrades(symbol: string, data: unknown): void; setWatchlist(items: unknown[]): void }
function DeskChart({ symbol, overlay, watch, onSymbol }: { symbol: string; overlay: { key: string; orders: ReturnType<typeof chartOrders> }; watch: unknown[]; onSymbol: (s: string) => void }) {
  const wrap = useRef<HTMLDivElement>(null), chart = useRef<DeskChartInstance | null>(null), pick = useRef(onSymbol);
  pick.current = onSymbol;
  const [scripts, setScripts] = useState(false), [loaded, setLoaded] = useState('');
  const [r, setR] = useState<DetailRange>({ range: '6mo', interval: '1d' });
  const fetchRange = fetchRangeFor(r);
  const history = useHistory(symbol, fetchRange, r.interval);
  useEffect(() => { let live = true; loadChartScripts().then(() => { if (live) setScripts(true); }, () => { /* no chart, as when chart.js failed */ }); return () => { live = false; }; }, []);
  useEffect(() => {
    const PriceChart = window.PriceChart;
    if (!scripts || !PriceChart || !wrap.current) return;
    const host = document.createElement('div');
    wrap.current.appendChild(host);
    const c = new PriceChart(host, { cfgKey: 'finsight-paper-chart' }) as DeskChartInstance;
    c.onRequest = ({ interval }) => setR({ range: CHART_TF_RANGE[interval] || '1y', interval, tf: true });
    c.onSymbol = (sym) => pick.current(sym);
    chart.current = c;
    return () => { if (c.maxed) c.toggleMax(false); c.destroy(); host.remove(); chart.current = null; };
  }, [scripts]);
  useEffect(() => { chart.current?.setWatchlist(watch); }, [watch, scripts]);
  const ready = !!history.data && !history.isPlaceholderData;
  useEffect(() => {
    const c = chart.current;
    if (!c || !ready) return;
    const points = history.data!.points || [];
    c.load(symbol, points, history.data!.meta || {}, { range: r.range, interval: r.interval, visibleFrom: r.tf ? null : visibleStart(points, r.range), fetchRange });
    c.resize();
    setLoaded(`${symbol}|${r.range}|${r.interval}|${history.dataUpdatedAt}`);
  }, [ready, history.data, scripts, r]); // eslint-disable-line react-hooks/exhaustive-deps
  // Fills from the paper book (B/S markers, average cost) plus the open limit orders.
  useEffect(() => {
    const c = chart.current;
    if (!c || !loaded) return;
    let live = true;
    api(`/api/chart-trades?symbol=${encodeURIComponent(symbol)}&account=ALL`).catch(() => null)
      .then((d) => { if (live) c.setTrades(symbol, { ...((d as object | null) ?? {}), orders: overlay.orders }); });
    return () => { live = false; };
  }, [loaded, overlay.key]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className={s.chartBox}>
      <div className={s.ranges} role="group" aria-label="Chart range">
        {RANGES.map((x) => {
          const on = !r.tf && r.range === x.range && r.interval === x.interval;
          return <button key={x.range} type="button" className={`${s.rangeBtn} ${on ? s.rangeOn : ''}`} aria-pressed={on} onClick={() => setR({ range: x.range, interval: x.interval })}>{x.label}</button>;
        })}
        {history.error && <span className={s.err}>{(history.error as Error).message}</span>}
      </div>
      <div ref={wrap} className={s.chartWrap} id="paper-chart" />
    </div>
  );
}

// ---- order ticket -------------------------------------------------------------------
function OrderTicket({ f, set, last, buyingPower, held, onSymbol, onPlaced }: {
  f: Form & { focus?: number }; set: (patch: Partial<Form>) => void; last: number | null; buyingPower: number | null; held: number; onSymbol: (s: string) => void; onPlaced: () => void;
}) {
  const [busy, setBusy] = useState(false), [err, setErr] = useState('');
  const [sym, setSym] = useState(f.symbol);
  useEffect(() => setSym(f.symbol), [f.symbol]);
  const amtRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (f.focus) setTimeout(() => amtRef.current?.focus(), 30); }, [f.focus]);
  const commit = () => { const v = sym.trim().toUpperCase(); if (v && v !== f.symbol) onSymbol(v); return v || f.symbol; };
  const est = estimate(f, last, buyingPower);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const r = formOrder({ ...f, symbol: commit() });
    if ('error' in r) return setErr(r.error);
    setBusy(true); setErr('');
    try {
      const out = await post<{ placed: boolean; order?: { status: string } }>('/api/paper/orders', r.body);
      showToast(`Paper order sent: ${f.side.toUpperCase()} ${String(r.body.symbol)} (${out.order?.status ?? 'sent'})`);
      set({ amount: '', limitPrice: '' }); onPlaced();
    } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  };
  const buy = f.side === 'buy';
  const tab = (on: boolean, cls: string | undefined) => `${s.tabBtn} ${on ? cls : ''}`;
  const sizeLabel = f.amount && Number(f.amount) > 0 ? (f.sizeBy === 'usd' ? usd(Number(f.amount)) : `${f.amount}`) : '';
  return (
    <form className={s.ticket} onSubmit={(e) => void submit(e)} aria-label="Paper order ticket">
      <div className={s.sideTabs} role="group" aria-label="Side">
        <button type="button" className={tab(buy, s.buyOn)} aria-pressed={buy} onClick={() => set({ side: 'buy' })}>BUY</button>
        <button type="button" className={tab(!buy, s.sellOn)} aria-pressed={!buy} onClick={() => set({ side: 'sell' })}>SELL</button>
      </div>
      <label className={s.field}>Symbol
        <input id="paper-symbol" className={s.input} value={sym} onChange={(e) => setSym(e.target.value.toUpperCase())} onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); amtRef.current?.focus(); } }} placeholder="AAPL" autoComplete="off" spellCheck={false} />
      </label>
      <div className={s.typeTabs} role="group" aria-label="Order type">
        {(['market', 'limit'] as const).map((t) => <button key={t} type="button" className={`${s.segBtn} ${f.type === t ? s.segOn : ''}`} aria-pressed={f.type === t} onClick={() => set({ type: t })}>{t === 'market' ? 'Market' : 'Limit'}</button>)}
      </div>
      {f.type === 'limit' && (
        <label className={s.field}>Limit price
          <span className={s.inRow}>
            <input className={s.input} inputMode="decimal" value={f.limitPrice} onChange={(e) => set({ limitPrice: e.target.value })} placeholder={last ? last.toFixed(2) : ''} />
            <button type="button" className={s.btn} disabled={!last} onClick={() => last && set({ limitPrice: last.toFixed(2) })} title="Use the last price">Last</button>
          </span>
        </label>
      )}
      <label className={s.field}>
        <span className={s.inRow}>{f.sizeBy === 'qty' ? 'Shares' : 'Amount (US$)'}
          <span className={s.seg} role="group" aria-label="Size by" style={{ marginLeft: 'auto' }}>
            <button type="button" className={`${s.segBtn} ${f.sizeBy === 'qty' ? s.segOn : ''}`} aria-pressed={f.sizeBy === 'qty'} onClick={() => set({ sizeBy: 'qty', amount: '' })}>Shares</button>
            <button type="button" className={`${s.segBtn} ${f.sizeBy === 'usd' ? s.segOn : ''}`} aria-pressed={f.sizeBy === 'usd'} onClick={() => set({ sizeBy: 'usd', amount: '', type: 'market' })}>US$</button>
          </span>
        </span>
        <input id="paper-amount" ref={amtRef} className={s.input} inputMode="decimal" value={f.amount} onChange={(e) => set({ amount: e.target.value })} placeholder={f.sizeBy === 'qty' ? '10' : '500'} />
      </label>
      <div className={s.quick} role="group" aria-label={buy ? 'Share of buying power' : 'Share of position'}>
        {[25, 50, 75, 100].map((p) => <button key={p} type="button" className={s.quickBtn} onClick={() => set({ amount: quickAmount(f, p, last, buyingPower, held) })}>{p}%</button>)}
      </div>
      <label className={s.field}>Time in force
        <select className={s.select} value={f.tif} onChange={(e) => set({ tif: e.target.value as Form['tif'] })}><option value="day">Day</option><option value="gtc">Good till cancelled</option></select>
      </label>
      <dl className={s.summary}>
        <dt>{f.type === 'limit' ? 'Limit' : 'Est. price'}</dt><dd>{usd(est.price)}</dd>
        {f.sizeBy === 'usd' && <><dt>Est. shares</dt><dd>{est.qty != null ? fmt(est.qty, 4) : '—'}</dd></>}
        <dt>{buy ? 'Est. cost' : 'Est. proceeds'}</dt><dd>{usd(est.value)}</dd>
        <dt>Buying power</dt><dd>{usd(buyingPower)}</dd>
        {buy && <><dt>After order</dt><dd className={est.after != null && est.after < 0 ? s.down : ''}>{usd(est.after)}</dd></>}
        {!buy && <><dt>You hold</dt><dd>{fmt(held, 4)}</dd></>}
      </dl>
      <button id="paper-submit" className={`${s.submit} ${buy ? s.submitBuy : s.submitSell}`} disabled={busy}>
        {busy ? 'Sending…' : `${buy ? 'Buy' : 'Sell'} ${sizeLabel} ${f.symbol || ''}`.replace(/\s+/g, ' ').trim()}
      </button>
      {err && <div role="alert" className={s.err}>{err}</div>}
      <span className={s.fine}>Paper · fake money. {f.type === 'market' ? 'A market order fills at Alpaca\'s price, not the estimate.' : 'Fills only at the limit or better.'}</span>
    </form>
  );
}

// ---- Kestrel ------------------------------------------------------------------------
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
    <form className={s.body} onSubmit={(e) => void save(e)} aria-label="Kestrel paper trading settings">
      <div className={s.radio} role="radiogroup" aria-label="Approval">
        <label><input type="radio" name="paper-approval" checked={approval === 'ask'} onChange={() => setApproval('ask')} />
          <span>Ask me first<small>Each Kestrel order waits on this desk for your Approve or Reject.</small></span></label>
        <label><input type="radio" name="paper-approval" checked={approval === 'auto'} onChange={() => setApproval('auto')} />
          <span>Autonomous<small>Kestrel's orders go to Alpaca paper at once, within the limits below.</small></span></label>
      </div>
      <p className={s.muted} style={{ margin: 0 }}>Limits for Kestrel's orders (leave empty for none). Now: {limitsText(l)}.</p>
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
const ticketStatus: Record<Ticket['status'], string> = { pending: 'waiting for you', approved: 'approved', rejected: 'rejected', failed: 'failed' };

// ---- desk ---------------------------------------------------------------------------
type Tab = 'positions' | 'orders' | 'history' | 'kestrel' | 'settings';
function Table({ head, children, empty }: { head: string[]; children: ReactNode[]; empty: string }) {
  if (!children.length) return <div className={s.body}><span className={s.muted}>{empty}</span></div>;
  return (
    <div className={s.tableWrap}>
      <table className={s.table}><thead><tr>{head.map((h, i) => <th key={i}>{h}</th>)}</tr></thead><tbody>{children}</tbody></table>
    </div>
  );
}

export default function PaperIsland() {
  const current = useBook();
  const paper = current === 'paper';
  const qc = useQueryClient();
  const { data, error, refetch } = usePaperState(paper);
  const hostRef = useRef<HTMLDivElement>(null);
  const refresh = () => { void refetch(); };
  const [f, setF] = useState<Form & { focus?: number }>(() => emptyForm(savedSymbol()));
  const set = (patch: Partial<Form & { focus?: number }>) => setF((x) => ({ ...x, ...patch }));
  const [tab, setTab] = useState<Tab>('positions');
  const selectSym = (sym: string, patch: Partial<Form & { focus?: number }> = {}) => { saveSymbol(sym); setF((x) => ({ ...x, symbol: sym, amount: '', limitPrice: '', ...patch })); };
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
    if (sheet.symbol) selectSym(sheet.symbol, { side: sheet.mode === 'sell' ? 'sell' : 'buy', focus: Date.now() });
    else set({ side: 'buy', focus: Date.now() });
    closeTrade();
    hostRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [paper, sheet]); // eslint-disable-line react-hooks/exhaustive-deps
  // No symbol yet: the first paper position, else SPY.
  useEffect(() => {
    if (data && !f.symbol) selectSym(data.positions[0]?.bookSymbol || 'SPY');
  }, [data, f.symbol]); // eslint-disable-line react-hooks/exhaustive-deps
  const quote = useQuote(paper && f.symbol ? f.symbol : null);
  const positions = data?.positions ?? [];
  const watch = useMemo(() => positions.map((p) => ({ symbol: p.bookSymbol, price: p.currentPrice, changePct: null, group: 'Paper positions' })), [JSON.stringify(positions.map((p) => [p.bookSymbol, p.currentPrice]))]); // eslint-disable-line react-hooks/exhaustive-deps
  const orders = useMemo(() => chartOrders(data?.openOrders ?? [], f.symbol), [data?.openOrders, f.symbol]);
  const overlay = useMemo(() => ({ key: JSON.stringify(orders) + (data?.sync.syncedAt ?? ''), orders }), [orders, data?.sync.syncedAt]);

  if (!paper) return null;
  if (error && !data) return <div className={s.body}><span className={s.err}>{(error as Error).message}</span></div>;
  if (!data) return <div className={s.body}><span className={s.muted}>Loading paper account…</span></div>;
  if (!data.connected) return <div ref={hostRef}><Connect onDone={refresh} /></div>;
  const a = data.account, chg = dayChange(a), pending = data.tickets.filter((t) => t.status === 'pending');
  const pos = positions.find((p) => p.bookSymbol === f.symbol);
  const q = quote.data && (quote.data.symbol || '').toUpperCase() === f.symbol ? quote.data : null;
  const last = q?.price ?? pos?.currentPrice ?? null;
  const decide = async (id: string, approve: boolean) => {
    try { await post('/api/paper/tickets/decide', { id, approve }); showToast(approve ? 'Approved: sent to Alpaca paper' : 'Rejected'); }
    catch (x) { fail(x); } finally { refresh(); }
  };
  const cancel = async (id: string) => { try { await post('/api/paper/orders/cancel', { id }); showToast('Cancel sent'); } catch (x) { fail(x); } finally { refresh(); } };
  const disconnect = async () => { try { await post('/api/paper/disconnect', {}); refresh(); } catch (x) { fail(x); } };
  const tabs: [Tab, string][] = [['positions', `Positions (${positions.length})`], ['orders', `Open orders (${data.openOrders.length})`], ['history', 'History'],
    ['kestrel', `Kestrel${pending.length ? ` (${pending.length})` : ''}`], ['settings', 'Settings']];
  const stat = (k: string, v: ReactNode, cls = '') => <div className={s.stat}><span className={s.statK}>{k}</span><span className={`${s.statV} ${cls}`}>{v}</span></div>;
  return (
    <div className={s.desk} ref={hostRef}>
      <div className={s.strip}>
        <h2 className={s.deskH}>PAPER TRADING · ALPACA</h2>
        {a && <>
          {stat('EQUITY', usd(a.equity))}
          {stat('DAY P/L', chg ? `${chg.abs >= 0 ? '+' : ''}${usd(chg.abs)} (${chg.pct.toFixed(2)}%)` : '—', chg && chg.abs < 0 ? s.down : chg ? s.up : '')}
          {stat('CASH', usd(a.cash))}
          {stat('BUYING POWER', usd(a.buyingPower))}
        </>}
        <span className={s.streamTag}><i className={`${s.dot} ${data.stream.state === 'live' ? s.live : ''}`} aria-hidden="true" />Order stream {streamLabel[data.stream.state]}</span>
      </div>
      {data.error && <div role="alert" className={s.err}>{data.error}</div>}
      {data.sync.error && <div role="alert" className={s.err}>Book sync: {data.sync.error}</div>}
      {data.sync.drift.length > 0 && <div className={s.err}>Book differs from Alpaca: {data.sync.drift.join('; ')}</div>}

      {pending.length > 0 && (
        <section className={s.pending} aria-label="Kestrel orders awaiting approval">
          <h3 className={s.sectH}>KESTREL WANTS TO PLACE · {pending.length}</h3>
          <ul className={s.list}>
            {pending.map((t) => (
              <li key={t.id} className={s.item} data-ticket={t.id}>
                <span className={`${s.tag} ${s.tagK}`}>KESTREL</span>
                <button type="button" className={s.linkBtn} onClick={() => selectSym(t.order.symbol)} title="Show on the chart">{orderLabel(t.order)}</button>
                {t.estimate?.valueUsd != null && <span className={s.muted}>≈{usd(t.estimate.valueUsd)} ({t.estimate.priceSource})</span>}
                <span className={s.grow} />
                <button className={`${s.btn} ${s.approve}`} onClick={() => void decide(t.id, true)}>Approve</button>
                <button className={s.btn} onClick={() => void decide(t.id, false)}>Reject</button>
                {t.note && <span className={s.note}>{t.note}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className={s.main}>
        <div className={s.chartCol}>
          <div className={s.symHead}>
            <span className={s.sym}>{f.symbol}</span>
            <span className={s.symName}>{q?.name || ''}</span>
            <span className={s.price}>{last != null ? fmt(last) : '—'}</span>
            {q && <span className={signClass(q.change)}>{signStr(q.change)} ({signStr(q.changePct)}%)</span>}
            {pos && <span className={s.muted}>· holding {fmt(pos.qty, 4)} @ {fmt(pos.avgEntryPrice)} · <span className={signClass(pos.unrealizedPl)}>{signStr(pos.unrealizedPl)}</span></span>}
          </div>
          <DeskChart symbol={f.symbol} overlay={overlay} watch={watch} onSymbol={(sym) => selectSym(sym)} />
        </div>
        <OrderTicket f={f} set={set} last={last} buyingPower={a?.buyingPower ?? null} held={pos?.qty ?? 0} onSymbol={(sym) => selectSym(sym)} onPlaced={refresh} />
      </div>

      <div className={s.tabs} role="tablist" aria-label="Paper account">
        {tabs.map(([id, label]) => <button key={id} type="button" role="tab" id={`paper-tab-${id}`} aria-selected={tab === id} aria-controls="paper-tabpanel" className={`${s.tab} ${tab === id ? s.tabOn : ''}`} onClick={() => setTab(id)}>{label}</button>)}
      </div>
      <div role="tabpanel" id="paper-tabpanel" aria-labelledby={`paper-tab-${tab}`} className={s.tabPanel}>
        {tab === 'positions' && (
          <section aria-label="Paper positions">
            <Table head={['Symbol', 'Qty', 'Avg price', 'Last', 'Market value', 'Unrealized P/L', '']} empty="No positions yet. Place an order with the ticket.">
              {positions.map((p) => (
                <tr key={p.symbol} className={p.bookSymbol === f.symbol ? s.rowOn : ''} onClick={() => selectSym(p.bookSymbol)}>
                  <td className={s.symCell}>{p.bookSymbol}</td><td>{fmt(p.qty, 4)}</td><td>{fmt(p.avgEntryPrice)}</td><td>{fmt(p.currentPrice)}</td>
                  <td>{usd(p.marketValue)}</td><td className={signClass(p.unrealizedPl)}>{signStr(p.unrealizedPl)}</td>
                  <td className={s.actions} onClick={(e) => e.stopPropagation()}>
                    <button className={s.btn} onClick={() => selectSym(p.bookSymbol, { side: 'buy', focus: Date.now() })}>Buy</button>
                    <button className={s.btn} onClick={() => selectSym(p.bookSymbol, { side: 'sell', focus: Date.now() })}>Sell</button>
                    <button className={s.btn} title="Fill the ticket to sell the whole position at market; you still press Sell" onClick={() => selectSym(p.bookSymbol, { side: 'sell', sizeBy: 'qty', type: 'market', amount: String(p.qty), focus: Date.now() })}>Close</button>
                  </td>
                </tr>
              ))}
            </Table>
          </section>
        )}
        {tab === 'orders' && (
          <section aria-label="Open paper orders">
            <Table head={['By', 'Order', 'Status', 'Placed', '']} empty="No open orders.">
              {data.openOrders.map((o) => (
                <tr key={o.id} onClick={() => selectSym(bookSymbol(o.symbol))}>
                  <td><span className={`${s.tag} ${o.origin === 'kestrel' ? s.tagK : ''}`}>{originLabel(o.origin)}</span></td>
                  <td>{orderLabel(o)}</td><td>{fillText(o)}</td><td className={s.muted}>{when(o.createdAt)}</td>
                  <td className={s.actions} onClick={(e) => e.stopPropagation()}><button className={s.btn} onClick={() => void cancel(o.id)}>Cancel</button></td>
                </tr>
              ))}
            </Table>
          </section>
        )}
        {tab === 'history' && (
          <section aria-label="Recent paper orders">
            <Table head={['By', 'Order', 'Fill', 'Time']} empty="No orders yet.">
              {data.recentOrders.map((o) => (
                <tr key={o.id} onClick={() => selectSym(bookSymbol(o.symbol))}>
                  <td><span className={`${s.tag} ${o.origin === 'kestrel' ? s.tagK : ''}`}>{originLabel(o.origin)}</span></td>
                  <td>{orderLabel(o)}</td><td>{fillText(o)}</td><td className={s.muted}>{when(o.filledAt || o.createdAt)}</td>
                </tr>
              ))}
            </Table>
          </section>
        )}
        {tab === 'kestrel' && (
          <section aria-label="Kestrel paper tickets">
            <div className={s.body} style={{ paddingBottom: 0 }}><span className={s.muted}>Kestrel's orders: {data.settings.approval === 'ask' ? 'ask me first' : 'autonomous'} · {limitsText(data.settings.limits)}. Change this under Settings.</span></div>
            <Table head={['Order', 'Status', 'Note', 'Time']} empty="Kestrel has not proposed a paper order yet. Ask it in the Kestrel panel.">
              {data.tickets.map((t) => (
                <tr key={t.id} onClick={() => selectSym(t.order.symbol)}>
                  <td>{orderLabel(t.order)}</td><td className={t.status === 'failed' ? s.down : t.status === 'pending' ? s.amber : ''}>{ticketStatus[t.status]}{t.error ? `: ${t.error}` : ''}</td>
                  <td className={s.muted}>{t.note || ''}</td><td className={s.muted}>{when(new Date(t.createdAt).toISOString())}</td>
                </tr>
              ))}
            </Table>
          </section>
        )}
        {tab === 'settings' && (
          <>
            <KestrelSettings key={JSON.stringify(data.settings)} settings={data.settings} onSaved={refresh} />
            <div className={`${s.body} ${s.row}`}>
              {a && <span className={s.muted}>Alpaca paper {a.number} · {a.status}</span>}
              {data.sync.syncedAt && <span className={s.muted}>book synced {new Date(data.sync.syncedAt).toLocaleTimeString([], { hour12: false })}</span>}
              {data.sync.skipped.length > 0 && <span className={s.muted}>Not mirrored in the book: {data.sync.skipped.map((x) => `${x.side} ${x.qty} ${x.symbol} (${x.reason})`).join('; ')}</span>}
              <span className={s.grow} />
              {data.keySource === 'file' && <button className={s.btn} onClick={() => void disconnect()}>Disconnect</button>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
