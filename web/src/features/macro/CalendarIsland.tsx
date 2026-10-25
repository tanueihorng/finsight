import { useCalendar, useEvents } from '../../api/queries.ts';
import { selectSymbol } from '../../legacy/app.ts';
import { fmt } from '../../ui/format.ts';
export default function CalendarIsland() {
  const calendar = useCalendar(), company = useEvents();
  if (calendar.isError) return <span className="muted">Calendar unavailable right now.</span>;
  if (!calendar.data || company.isPending) return <span className="muted">Loading upcoming Fed &amp; inflation events…</span>;
  const data = calendar.data, ev = company.data;
  const short = (s: string) => new Date(s + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: '2-digit' });
  const date = (ms: number) => new Date(ms).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: '2-digit' });
  const f = data.nextFomc, sep = data.nextSep;
  return <>
    {f && <div className="cal-anchor"><div className="cal-a"><span className="k">NEXT FED DECISION</span><span className="v amber">{short(f.end)}</span><span className="s">{Math.max(0, Math.round((f.decisionMs - Date.now()) / 86400000))}d · rate + statement{f.sep ? ' + dot plot' : ''}</span></div>
      {sep && <div className="cal-a"><span className="k">NEXT DOT PLOT</span><span className="v">{short(sep.start)}</span><span className="s"><a href={data.sepUrl} target="_blank" rel="noopener">FOMC projections ↗</a></span></div>}</div>}
    {ev && <><div className="fxr-sub">YOUR HOLDINGS · next 60 days (earnings · ex-dividend)</div>{ev.events.length ? ev.events.slice(0, 14).map((e, i) => <div className="cal-row" data-sym={e.symbol} style={{ cursor: 'pointer' }} onClick={() => selectSymbol(e.symbol)} key={i}>
      <span className="cal-when">{date(e.t)}{e.estimated && <> <span className="dim">~</span></>}</span><span className={`ev-kind ${e.kind === 'EARNINGS' ? 'earn' : 'div'}`}>{e.kind}</span>
      <span className="cal-title"><span className="sym amber">{e.symbol}</span>{!e.held && <> <span className="dim">watch</span></>}</span>{'amount' in e && !!e.amount && <span className="cal-fp">~{fmt(e.amount, 2)}/sh</span>}</div>) : <div className="muted small">{ev.ok ? 'No earnings or ex-dividend dates in the next 60 days.' : 'Company dates unavailable right now.'}</div>}</>}
    <div className="fxr-sub">THIS WEEK · high-impact (USD/SGD)</div>
    {data.events.length ? data.events.map((e, i) => {
      const ms = Date.parse(e.time);
      return <div className={`cal-row ${!isNaN(ms) && ms < Date.now() ? 'cal-past' : ''}`} key={i}><span className="cal-when">{isNaN(ms) ? e.time || '—' : new Date(e.time).toLocaleString('en-US', { weekday: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</span><span className="ccy">{e.country}</span><span className="cal-title">{e.title}</span>{(e.forecast || e.previous) && <span className="cal-fp">f {e.forecast || '—'} · p {e.previous || '—'}</span>}</div>;
    }) : <div className="muted small">{data.eventsOk ? 'No high-impact USD/SGD events this week.' : 'Live feed unavailable — Fed schedule shown above.'}</div>}
  </>;
}
