import { useEffect, useRef } from 'react';
import { selectSymbol } from './app.ts';
import type { ChartLoadContext, PriceChartInstance } from './chart.d.ts';
import type { HistoryPoint, QuotedQuote } from '../../../shared/types.ts';
import { CHART_TF_RANGE } from '../features/detail/detail.ts';

// Wraps the legacy canvas chart (public/chart.js) without rewriting it (E2).
// React owns only the wrapper div. The chart's own root (#detail-chart-host)
// is created here, because chart.js moves it to <body> when expanded and into
// the multi-chart grid. The instance survives range switches and refreshes,
// so zoom, drawings and indicators stay. window.detailChart is kept for
// agent-panel.js and the legacy chart hooks (watch feed, grid, trades).
export interface ChartData { symbol: string; points: HistoryPoint[]; meta: Partial<QuotedQuote>; ctx: ChartLoadContext }
const store = () => window.FinSight.store;
const hooks = () => window.FinSightChartHooks;

export function ChartHost({ data, tradesKey }: { data: ChartData | null; tradesKey: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const chart = useRef<PriceChartInstance | null>(null);

  useEffect(() => {
    const PriceChart = window.PriceChart;
    if (!PriceChart || !wrap.current) return;
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
  }, []);
  // New bars (symbol, range or an intraday refresh): load them. An identical
  // refetch keeps the same data object, so the chart is not reloaded.
  useEffect(() => {
    if (!data || !chart.current) return;
    chart.current.load(data.symbol, data.points, data.meta, data.ctx);
    // Legacy created and loaded the chart in one tick, so its first size
    // counted the indicator panes. Here the chart mounts before data: re-size.
    chart.current.resize();
    hooks()?.loaded();
  }, [data]);
  // Trade markers: on each symbol/range load and whenever a write changes trades.
  useEffect(() => {
    const c = chart.current, symbol = data?.symbol;
    if (!c || !symbol) return;
    void hooks()?.trades(c, symbol);
    return window.FinSight.bus.on('chart-trades', () => hooks()?.trades(c, symbol));
  }, [tradesKey]); // deliberately not [data]: a quote/bar refresh is not a new load
  return <div ref={wrap} className="detail-chart-wrap" />;
}
