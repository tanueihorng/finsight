import { useEffect, useRef, useState } from 'react';
import { selectSymbol } from './app.ts';
import type { ChartLoadContext, PriceChartInstance } from './chart.d.ts';
import type { HistoryPoint, QuotedQuote } from '../../../shared/types.ts';
import { CHART_TF_RANGE } from '../features/detail/detail.ts';
import { chartHooks } from '../shell/chartHooks.ts';
import { loadChartScripts } from './chartScripts.ts';

// Wraps the legacy canvas chart (public/chart.js) without rewriting it (E2).
// React owns only the wrapper div. The chart's own root (#detail-chart-host)
// is created here, because chart.js moves it to <body> when expanded and into
// the multi-chart grid. The instance survives range switches and refreshes,
// so zoom, drawings and indicators stay. window.detailChart is kept for
// the Kestrel page context, specs and the chart hooks (watch feed, grid, trades).
export interface ChartData { symbol: string; points: HistoryPoint[]; meta: Partial<QuotedQuote>; ctx: ChartLoadContext }
const store = () => window.FinSight.store;
const hooks = () => chartHooks;

export function ChartHost({ data, tradesKey }: { data: ChartData | null; tradesKey: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const chart = useRef<PriceChartInstance | null>(null);
  // chart.js loads after the app starts (H1); the chart is created once it is in.
  const [scripts, setScripts] = useState(() => !!window.PriceChart);
  useEffect(() => {
    if (scripts) return;
    let live = true;
    loadChartScripts().then(() => { if (live) setScripts(true); }, () => { /* no chart, as when chart.js failed to load */ });
    return () => { live = false; };
  }, [scripts]);

  useEffect(() => {
    const PriceChart = window.PriceChart;
    if (!scripts || !PriceChart || !wrap.current) return;
    const host = document.createElement('div');
    host.id = 'detail-chart-host';
    wrap.current.appendChild(host);
    const c = new PriceChart(host);
    c.onRequest = ({ interval }) => store().setState({ detailRange: { range: CHART_TF_RANGE[interval] || '1y', interval, tf: true } });
    c.onSymbol = (sym) => { if (c.maxed) c.symInput.value = sym; selectSymbol(sym); };
    hooks()?.attached(c);
    chart.current = c; window.detailChart = c;
    return () => {
      hooks()?.detached();
      if (c.maxed) c.toggleMax(false);
      c.destroy(); host.remove();
      chart.current = null;
      if (window.detailChart === c) window.detailChart = null;
    };
  }, [scripts]);
  // New bars (symbol, range or an intraday refresh): load them. An identical
  // refetch keeps the same data object, so the chart is not reloaded.
  useEffect(() => {
    if (!data || !chart.current) return;
    chart.current.load(data.symbol, data.points, data.meta, data.ctx);
    // Legacy created and loaded the chart in one tick, so its first size
    // counted the indicator panes. Here the chart mounts before data: re-size.
    chart.current.resize();
    hooks()?.loaded();
  }, [data, scripts]);
  // Trade markers: on each symbol/range load and whenever a write changes trades.
  useEffect(() => {
    const c = chart.current, symbol = data?.symbol;
    if (!c || !symbol) return;
    void hooks()?.trades(c, symbol);
    return window.FinSight.bus.on('chart-trades', () => hooks()?.trades(c, symbol));
  }, [tradesKey, scripts]); // deliberately not [data]: a quote/bar refresh is not a new load
  return <div ref={wrap} className="detail-chart-wrap" />;
}
