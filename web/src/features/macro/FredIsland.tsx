import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useFred } from '../../api/queries.ts';
import { PanelHeadSlot } from '../../ui/PanelHeadSlot.tsx';
import { Spark } from '../../ui/Spark.tsx';
import { fmt, fmtBig } from '../../ui/format.ts';
import { fredOptions } from './options.ts';
export default function FredIsland() {
  const [value, setValue] = useState('DGS10|lin');
  const [series = '', transform = 'lin'] = value.split('|');
  const q = useFred(series, transform), client = useQueryClient();
  const load = (next: string) => {
    if (next === value) { void q.refetch(); return; }
    const [s, t = 'lin'] = next.split('|');
    void client.invalidateQueries({ queryKey: ['fred', s, t], refetchType: 'none' }); setValue(next);
  };
  const head = <PanelHeadSlot island="fred"><select id="fred-series" aria-label="FRED series" value={value} onChange={(e) => load(e.target.value)}>{fredOptions.map((o) => <option value={o.value} key={o.value}>{o.label}</option>)}</select><button id="fred-go" className="mini-btn" onClick={() => load(value)}>LOAD</button></PanelHeadSlot>;
  if (q.isFetching || (!q.data && !q.isError)) return <>{head}<span className="muted">Loading FRED…</span></>;
  if (q.isError) return <>{head}<span className="down">FRED error: {q.error.message}</span></>;
  const d = q.data, last = d?.points.at(-1);
  if (!d || !last) return <>{head}<span className="muted">No data.</span></>;
  return <>{head}<div className="wb-headline"><span className="wb-val">{/GDP/.test(series) && transform !== 'pc1' ? fmtBig(last.value) : fmt(last.value, 2) + '%'}</span><span className="wb-yr">{last.date}</span></div><div className="wb-label">{fredOptions.find((o) => o.value === value)?.label} · FRED</div><Spark points={d.points.map((p) => ({ c: p.value }))} up={last.value >= d.points[0]!.value} /></>;
}
