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
      {c.kind === 'stat_grid' ? <dl className="kx-ui-stats">{c.items.map((i) => <div key={i.field}><dt>{i.label}</dt><dd>{i.cell.text}</dd></div>)}</dl> : <Table c={c} />}
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
