import { useState } from 'react';
import { useInflation } from '../../api/queries.ts';
import { PanelHeadSlot } from '../../ui/PanelHeadSlot.tsx';
import { fmt } from '../../ui/format.ts';
import { INFL_GAUGES, inflClass } from './macro.ts';
export default function InflationIsland() {
  const [requested, setRequested] = useState(false), q = useInflation(requested);
  const head = <PanelHeadSlot island="inflation"><button id="infl-go" className="mini-btn" onClick={() => { if (requested) void q.refetch(); else setRequested(true); }}>LOAD</button></PanelHeadSlot>;
  if (!requested) return <>{head}Press LOAD — official CPI/PCE plus the trimmed-mean gauges Fed Chair Warsh watches.</>;
  if (q.isFetching || (!q.data && !q.isError)) return <>{head}<span className="muted">Loading inflation gauges…</span></>;
  if (q.isError) return <>{head}<span className="down">Inflation gauges error: {q.error.message}</span></>;
  const funds = q.data?.funds?.points.at(-1)?.value;
  return <>{head}{INFL_GAUGES.map((g, i) => {
    const points = q.data?.gauges[i]?.points, last = points?.at(-1), prev = points?.at(-2);
    if (!last) return <div className="infl-row" key={g.s}><span className="infl-name">{g.name}</span><span className="muted small">n/a</span></div>;
    const mom = prev ? last.value - prev.value : 0;
    return <div className="infl-row" title={g.src} key={g.s}><span className="infl-name">{g.name} <span className="dim small">{g.src}</span></span><span className={`infl-mom ${mom > .005 ? 'down' : mom < -.005 ? 'up' : 'dim'}`}>{mom > .005 ? '▲' : mom < -.005 ? '▼' : '·'} {fmt(Math.abs(mom), 2)}</span><span className={`infl-val ${inflClass(last.value)}`}>{fmt(last.value, 2)}%</span><span className="infl-date dim">{new Date(last.date).toLocaleDateString('en-US', { month: 'short', year: '2-digit' })}</span></div>;
  })}<div className="infl-note">Fed target: 2% (PCE){funds != null ? ` · Fed funds: ${fmt(funds, 2)}%` : ''} · monthly YoY, latest release<br />★ Trimmed/median gauges — Chair Warsh's preferred read of underlying inflation: rank all price changes, drop the extreme tails (Dallas trims bottom 24% / top 31% of the PCE basket), average the rest. ▲▼ = change vs prior month.</div></>;
}
