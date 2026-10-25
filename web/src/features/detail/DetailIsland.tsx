import { useEffect, useMemo, useRef } from 'react';
import { useStore } from 'zustand';
import { useHistory, usePortfolio, useQuote } from '../../api/queries.ts';
import { selectSymbol } from '../../legacy/app.ts';
import { ChartHost, type ChartData } from '../../legacy/ChartHost.tsx';
import { fmt, fmtBig, money, signClass, signStr } from '../../ui/format.ts';
import { PanelHeadSlot } from '../../ui/PanelHeadSlot.tsx';
import type { QuotedQuote } from '../../../../shared/types.ts';
import { fetchRangeFor, firstSelectable, mergeMeta, RANGES, rangeChange, rangeLabel, visibleStart } from './detail.ts';

// Security detail (E1 + E2): header, chart and stats for store.selected.
// selectSymbol() stays global (10 callers) and writes the store; selecting
// the same symbol again refreshes through the 'detail' bus key.
const store = () => window.FinSight.store;

function Stat({ k, v }: { k: string; v: string }) {
  return <div className="stat-row"><span className="k">{k}</span><span className="v">{v}</span></div>;
}
function Header({ m, symbol, tf, range, pct, chg }: { m: Partial<QuotedQuote>; symbol: string; tf?: boolean; range: string; pct: number | null; chg: number | null }) {
  return (
    <>
      <div className="detail-top">
        <div><span className="detail-sym">{m.symbol || symbol}</span> <span className="detail-name">{m.name || ''}</span></div>
      </div>
      <div className="detail-top" style={{ marginTop: 4 }}>
        <span className="detail-price">{fmt(m.price)}</span>{' '}
        <span className={`detail-chg ${signClass(m.change)}`}>{signStr(m.change)} ({signStr(m.changePct)}%) <span className="muted small">today</span></span>{' '}
        {!tf && range !== '1d' && pct != null && <><span className={`small ${signClass(chg)}`}>{signStr(pct)}% <span className="muted">{rangeLabel(range)}</span></span>{' '}</>}
        <span className="muted small">{m.currency || ''} · {m.exchange || ''}</span>
      </div>
    </>
  );
}

export default function DetailIsland() {
  const selected = useStore(store(), (s) => s.selected);
  const dr = useStore(store(), (s) => s.detailRange);
  const portfolio = usePortfolio();
  const positions = portfolio.data?.positions;
  const manual = positions?.find((p) => p.symbol === selected && p.quoted === false);
  const fetchRange = fetchRangeFor(dr);
  const history = useHistory(manual ? null : selected, fetchRange, dr.interval);
  const quote = useQuote(manual ? null : selected);

  // Nothing selected (first load, or the selected holding was removed): on each
  // portfolio load pick the first quoted holding, as legacy renderPortfolio did.
  // Keyed on the load, not the selection, so a removal waits for the fresh list.
  useEffect(() => {
    if (!store().getState().selected && positions?.length) { const s = firstSelectable(positions); if (s) selectSymbol(s); }
  }, [portfolio.dataUpdatedAt]); // deliberately not [selected]
  useEffect(() => {
    const title = document.getElementById('detail-title');
    if (title && selected) title.textContent = selected + ' · DETAIL';
  }, [selected]);
  // Same symbol selected again (Q, a row click): refresh it, like legacy loadDetail().
  const { refetch: refetchHistory } = history, { refetch: refetchQuote } = quote;
  useEffect(() => window.FinSight.bus.on('detail', () => {
    if (store().getState().selected !== selected) return;
    return Promise.all([refetchHistory(), refetchQuote()]).then(() => window.FinSight.bus.invalidate('chart-trades'));
  }), [selected, refetchHistory, refetchQuote]);

  // Header, stats and chart switch together once history and quote for the
  // current key have both arrived (legacy awaited both); until then the
  // previous symbol stays on screen. A 30 s quote refresh updates the header
  // only: the chart reloads for new bars, not for a new quote.
  const ready = !!history.data && !history.isPlaceholderData && !quote.isPlaceholderData && !quote.isPending;
  const quoteAtLoad = useRef(quote.data);
  if (ready) quoteAtLoad.current = quote.data;
  const loaded = useMemo<ChartData | null>(() => {
    if (!ready || !selected) return null;
    const points = history.data!.points || [];
    const visibleFrom = dr.tf ? null : visibleStart(points, dr.range);
    return { symbol: selected, points, meta: mergeMeta(history.data!.meta, quoteAtLoad.current), ctx: { range: dr.range, interval: dr.interval, visibleFrom, fetchRange } };
  }, [ready, history.data]); // deliberately: a new key always brings new history data
  const lastChart = useRef<ChartData | null>(null), lastMeta = useRef<Partial<QuotedQuote> | null>(null), lastTf = useRef<boolean | undefined>(undefined);
  if (loaded) { lastChart.current = loaded; lastMeta.current = mergeMeta(history.data!.meta, quote.data); lastTf.current = dr.tf; }
  const chart = lastChart.current, meta = lastMeta.current;

  const head = (
    <PanelHeadSlot island="detail">
      <div className="ranges" id="ranges">
        {RANGES.map((r) => (
          <button key={r.range} data-range={r.range} data-interval={r.interval}
            className={!dr.tf && dr.range === r.range && dr.interval === r.interval ? 'active' : ''}
            onClick={() => store().setState({ detailRange: { range: r.range, interval: r.interval } })}>{r.label}</button>
        ))}
      </div>
    </PanelHeadSlot>
  );
  if (!selected) return <>{head}<div className="muted">Click a position or run <b>Q SYMBOL</b> to inspect a security.</div></>;
  if (manual) {
    return (
      <>
        {head}
        <div className="sym amber">{selected}</div><div className="muted small">{manual.name || ''}</div>
        <div className="muted small" style={{ marginTop: 8 }}>Manual holding · no market data feed. Valued at the price you entered:{' '}
          <b>{manual.currency} {fmt(manual.last)}</b> × {fmt(manual.quantity, 4)} = <b>{money(portfolio.data!.base, manual.marketValue)}</b>.
          {' '}To update it, edit its price in the ledger.</div>
      </>
    );
  }
  const error = history.error && !history.isFetching ? history.error : null;
  const change = chart ? rangeChange(chart.points, chart.ctx.visibleFrom) : null;
  return (
    <>
      {head}
      <div id="detail-hdr">
        {error ? <div className="down">Could not load {selected}: {error.message}</div>
          : chart && meta ? <Header m={meta} symbol={chart.symbol} tf={lastTf.current} range={chart.ctx.range} pct={change!.pct} chg={change!.chg} />
          : <div className="muted">Loading {selected}…</div>}
      </div>
      <ChartHost data={chart} tradesKey={chart ? `${chart.symbol}|${chart.ctx.range}|${chart.ctx.interval}` : ''} />
      <div id="detail-stats" className="stats">
        {meta && !error && <>
          <Stat k="Prev Close" v={fmt(meta.prevClose)} />
          <Stat k="Day Range" v={`${fmt(meta.dayLow)} – ${fmt(meta.dayHigh)}`} />
          <Stat k="52W High" v={fmt(meta.weekHigh52)} />
          <Stat k="52W Low" v={fmt(meta.weekLow52)} />
          <Stat k="Volume" v={fmtBig(meta.volume)} />
          <Stat k="Type" v={meta.type || '—'} />
        </>}
      </div>
    </>
  );
}
