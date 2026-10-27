import { Component, useState, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { UiView as Schema, type UiSpec } from '../../../../../agent/src/ui/schema.ts';
import type { Turn } from '../turns.ts';

type TableSpec = Extract<UiSpec['components'][number], { kind: 'table' }>;
function Table({ c }: { c: TableSpec }) {
  const [sort, setSort] = useState<{ col: number; desc: boolean } | null>(null);
  const rows = c.rows.map((cells, i) => ({ cells, i }));
  if (sort) rows.sort((a, b) => {
    const av = a.cells[sort.col]?.value ?? null, bv = b.cells[sort.col]?.value ?? null;
    if (av === null) return bv === null ? a.i - b.i : 1;
    if (bv === null) return -1;
    const n = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv));
    return (sort.desc ? -n : n) || a.i - b.i;
  });
  return <>
    <div className="kx-ui-scroll" role="region" aria-label={`${c.source.tool} snapshot table`} tabIndex={0}>
      <table><caption>{c.source.tool} · snapshot</caption><thead><tr>{c.columns.map((col, i) =>
        <th key={col.field} scope="col" aria-sort={sort?.col === i ? (sort.desc ? 'descending' : 'ascending') : 'none'}>
          <button onClick={() => setSort({ col: i, desc: sort?.col === i ? !sort.desc : false })}>{col.label}<span aria-hidden="true">{sort?.col === i ? (sort.desc ? ' ↓' : ' ↑') : ' ↕'}</span></button>
        </th>)}</tr></thead><tbody>{rows.map(({ cells, i }) => <tr key={i}>{cells.map((v, j) => <td key={j} className={typeof v.value === 'number' ? 'num' : undefined}>{v.text}</td>)}</tr>)}</tbody></table>
    </div><p className="kx-ui-source">Showing {c.shown} of {c.available} source rows. Sorting affects these rows only.</p>
  </>;
}
type PriceChartSpec = Extract<UiSpec['components'][number], { kind: 'price_chart' }>;
function PriceChart({ c }: { c: PriceChartSpec }) {
  const [index, setIndex] = useState(c.points.length - 1);
  const point = c.points[Math.min(index, c.points.length - 1)]!;
  const values = c.points.map((p) => p.close), low = Math.min(...values), high = Math.max(...values);
  const spread = high - low || Math.max(Math.abs(high) * 0.01, 0.01);
  const firstTime = c.points[0]!.time, lastTime = c.points[c.points.length - 1]!.time;
  const x = (time: number) => (time - firstTime) / (lastTime - firstTime) * 600;
  const coords = c.points.map((p) => `${x(p.time).toFixed(2)},${(160 - (p.close - low) / spread * 140).toFixed(2)}`).join(' ');
  const date = new Date(point.time).toISOString().slice(0, 10);
  const format = (n: number) => n.toLocaleString('en-US', { maximumSignificantDigits: 12 });
  return <div className="kx-price-chart">
    <div className="kx-price-chart-head"><strong>{c.symbol}</strong><span>Close · {c.currency}</span></div>
    <div className="kx-price-chart-value" aria-live="polite">{c.currency} {format(point.close)} <time dateTime={new Date(point.time).toISOString()}>{date}</time></div>
    <svg viewBox="0 0 600 180" role="img" aria-label={`${c.symbol} historical closing prices in ${c.currency}`} preserveAspectRatio="none">
      <line x1="0" y1="160" x2="600" y2="160" stroke="currentColor" opacity="0.18" />
      <polyline points={coords} fill="none" stroke="currentColor" strokeWidth="3" vectorEffect="non-scaling-stroke" />
      <circle cx={x(point.time)} cy={160 - (point.close - low) / spread * 140} r="4" fill="currentColor" />
    </svg>
    <label>Inspect price history <input aria-label={`${c.symbol} chart date`} type="range" min="0" max={c.points.length - 1} value={Math.min(index, c.points.length - 1)} onChange={(e) => setIndex(Number(e.target.value))} aria-valuetext={`${date}: ${c.currency} ${format(point.close)}`} /></label>
    <div className="kx-price-chart-axis"><span>{new Date(c.points[0]!.time).toISOString().slice(0, 10)}</span><span>{new Date(c.points[c.points.length - 1]!.time).toISOString().slice(0, 10)}</span></div>
  </div>;
}
class ViewBoundary extends Component<{ children: ReactNode; fallback: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <pre className="kx-ui-fallback">{this.props.fallback}</pre> : this.props.children; }
}
export default function UiView({ view }: { view: unknown }) {
  const peek = useStore(window.FinSight.store, (s) => s.peek);
  if (!peek) return <div className="kx-ui-hidden">Snapshot hidden by UNPEEK.</div>;
  const parsed = Schema.safeParse(view);
  if (!parsed.success) return <div className="agent-notice warn">This snapshot is unavailable in this version. Ask Kestrel for a text answer.</div>;
  const { spec } = parsed.data;
  return <ViewBoundary fallback={spec.fallback}><div className="kx-ui" data-ui-id={parsed.data.id}>
    {spec.components.map((c) => <section key={c.id} aria-label={`${c.source.tool} snapshot`}>
      <div className="kx-ui-source"><strong>Snapshot</strong> · {c.source.tool} · <time dateTime={c.source.asOf}>{new Date(c.source.asOf).toLocaleString()}</time></div>
      <p className="kx-ui-source">{c.source.scope}</p>
      {c.kind === 'price_chart' ? <PriceChart c={c} /> : c.kind === 'stat_grid' ? <dl className="kx-ui-stats">{c.items.map((i) => <div key={i.field}><dt>{i.label}</dt><dd>{i.cell.text}</dd></div>)}</dl> : <Table c={c} />}
      {c.source.note && <p className="kx-ui-source">{c.source.note}</p>}
    </section>)}
    <details className="kx-ui-fallback"><summary>Text equivalent</summary><pre>{spec.fallback}</pre></details>
  </div></ViewBoundary>;
}
export function answerText(t: Turn, peek: boolean): string {
  return t.parts.map((p) => {
    if (p.kind === 'text') return p.text;
    if (p.kind !== 'ui') return '';
    if (!peek) return '[Snapshot hidden by UNPEEK]';
    const parsed = Schema.safeParse(p.view);
    return parsed.success ? parsed.data.spec.fallback : '[Snapshot unavailable in this version]';
  }).filter(Boolean).join('\n\n');
}
