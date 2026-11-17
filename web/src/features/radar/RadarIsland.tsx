// FEAT-015 §4 Event radar: the next weeks' earnings, ex-dividend dates and FOMC
// decisions, with what your own records ask you to prepare. Not a trade signal.
import { useEffect, useState } from 'react';
import { useRadar } from '../../api/queries.ts';
import { selectSymbol } from '../../legacy/app.ts';
import { PanelHeadSlot } from '../../ui/PanelHeadSlot.tsx';
import { fmt } from '../../ui/format.ts';

export default function RadarIsland() {
  useEffect(() => { const el = document.getElementById('radar'); if (el) { el.tabIndex = 0; el.setAttribute('aria-label', 'Event radar'); } }, []);
  const [heldOnly, setHeldOnly] = useState(true);
  const q = useRadar(), d = q.data;
  const head = <PanelHeadSlot island="radar">{d && <span className={d.counts.review ? 'warn' : ''}>{d.counts.review} TO PREPARE · {d.horizonDays}D</span>}</PanelHeadSlot>;
  if (q.isError) return <>{head}<span className="down">{q.error.message}</span></>;
  if (!d) return <>{head}<span className="muted">Loading…</span></>;
  const items = d.items.filter((x) => !heldOnly || x.held || x.kind === 'FOMC');
  return <>{head}
    <div className="gr-actions">
      <button className={'mini-btn' + (heldOnly ? ' active' : '')} aria-pressed={heldOnly} onClick={() => setHeldOnly(true)}>HELD</button>
      <button className={'mini-btn' + (heldOnly ? '' : ' active')} aria-pressed={!heldOnly} onClick={() => setHeldOnly(false)}>+ WATCHLIST</button>
    </div>
    {!items.length ? <div className="muted">Nothing in the next {d.horizonDays} days.</div> :
    <table className="tbl rd-tbl"><thead><tr><th>WHEN</th><th>EVENT</th><th className="r">WT%</th><th>PREPARE</th></tr></thead><tbody>
      {items.map((x, i) => <tr key={i} className={x.level === 'review' ? 'gr-near' : ''}>
        <td className="dim">{new Date(x.t).toISOString().slice(5, 10)}<div className="small">{x.inDays ? `${x.inDays}d` : 'today'}{x.estimated ? ' · est.' : ''}</div></td>
        <td>{x.symbol ? <button className="linkish" onClick={() => selectSymbol(x.symbol!)}>{x.symbol}</button> : 'FOMC'} <span className="dim">{x.kind === 'FOMC' ? '' : x.kind.toLowerCase()}</span>
          {x.detail && <div className="dim small">{x.detail}</div>}{!x.held && x.symbol && <div className="dim small">watchlist</div>}</td>
        <td className="r">{x.weightPct != null ? fmt(x.weightPct, 1) : '—'}</td>
        <td>{x.prompts.length ? x.prompts.map((p, k) => <div key={k} className="small">{p}</div>) : <span className="dim">—</span>}</td>
      </tr>)}
    </tbody></table>}
    <div className="fxr-note">{d.notes.join(' ')}</div>
  </>;
}
