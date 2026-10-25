import { useRef, useState, type MouseEvent } from 'react';
import { usePerformance } from '../../api/queries.ts';
import { money, moneySigned, signClass, signStr } from '../../ui/format.ts';
import { PanelHeadSlot } from '../../ui/PanelHeadSlot.tsx';
import type { Performance } from '../../../../shared/types.ts';
import { holdingsSig, perfCrossX, perfPaths, PERF_H, PERF_W } from './analytics.ts';
import { usePositions } from './usePositions.ts';

// Portfolio performance (C3): replays the real buys/sells with historical
// prices and FX against a benchmark. The benchmark choice is saved
// (finsight-bench); the range is not, like legacy.
const RANGES: [string, string][] = [['1mo', '1M'], ['6mo', '6M'], ['ytd', 'YTD'], ['1y', '1Y'], ['5y', '5Y'], ['max', 'MAX']];
const BENCHES: [string, string][] = [['^GSPC', 'vs S&P 500'], ['URTH', 'vs MSCI World'], ['VT', 'vs All-World'], ['^IXIC', 'vs Nasdaq'], ['^STI', 'vs STI'], ['none', 'no benchmark']];
const BENCH_KEY = 'finsight-bench';
const readBench = () => { try { return localStorage.getItem(BENCH_KEY) || '^GSPC'; } catch { return '^GSPC'; } };
const pct = (v: number | null | undefined) => (v == null ? '—' : signStr(v) + '%');

function Stat({ k, v, cls, title }: { k: string; v: string; cls?: string; title: string }) {
  return <div className="pf-stat" title={title}><span className="k">{k}</span><span className={`v ${cls || ''}`}>{v}</span></div>;
}

function Chart({ d, base }: { d: Performance; base: string }) {
  const points = d.points!, b = d.benchmark;
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<{ i: number; left: number } | null>(null);
  if (points.length < 2) return <div className="chart muted small">Not enough history yet.</div>;
  const paths = perfPaths(points, !!b);
  const col = paths.up ? 'var(--up)' : 'var(--down)';
  const onMove = (e: MouseEvent) => {
    const r = svgRef.current!.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    setHover({ i: Math.round(f * (points.length - 1)), left: Math.min(r.width - 150, Math.max(0, e.clientX - r.left + 10)) });
  };
  const p = hover ? points[hover.i]! : null, cx = hover ? perfCrossX(hover.i, points.length) : 0;
  return (
    <>
      <div className="pf-chart-wrap">
        <svg ref={svgRef} className="chart pf-chart" viewBox={`0 0 ${PERF_W} ${PERF_H}`} preserveAspectRatio="none" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
          <defs><linearGradient id="pfg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={col} stopOpacity="0.22" /><stop offset="100%" stopColor={col} stopOpacity="0" /></linearGradient></defs>
          <path d={paths.area} fill="url(#pfg)" />
          <path d={paths.invested} fill="none" stroke="var(--muted)" strokeWidth="1" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
          {paths.bench && <path d={paths.bench} fill="none" stroke="var(--cyan)" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />}
          <path d={paths.value} fill="none" stroke={col} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
          <line id="pf-cross" x1={cx} x2={cx} y1="0" y2={PERF_H} stroke="var(--dim)" strokeWidth="1" vectorEffect="non-scaling-stroke" visibility={hover ? 'visible' : 'hidden'} />
        </svg>
        <div id="pf-tip" className={p ? 'pf-tip' : 'pf-tip hidden'} style={hover ? { left: hover.left + 'px' } : undefined}>
          {p && <>
            <b>{new Date(p.t).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: '2-digit', timeZone: 'UTC' })}</b>
            <div>Portfolio {money(base, p.value, 0)}</div><div className="muted">Invested {money(base, p.invested, 0)}</div>
            {b && p.bench != null && <div className="cyan">{b.name} {money(base, p.bench, 0)}</div>}
          </>}
        </div>
      </div>
      <div className="pf-legend"><span><i style={{ background: col }}></i>Portfolio</span><span><i className="dash"></i>Net invested</span>
        {b && <span><i style={{ background: 'var(--cyan)' }}></i>Same cash in {b.name}</span>}</div>
    </>
  );
}

function Body({ d, fallbackBase }: { d: Performance; fallbackBase: string }) {
  if (!d.points || !d.points.length) return <span className="muted">No data.</span>;
  const base = d.base || fallbackBase, b = d.benchmark, long = d.spanDays >= 365;
  const notes: string[] = [];
  if (d.transfers?.length) notes.push(`${d.transfers.length} holding(s) entered at market value — no purchase date, so gains before that aren't counted (${d.transfers.slice(0, 6).join(', ')}${d.transfers.length > 6 ? '…' : ''}). Add dates on import for full history.`);
  if (d.approx?.length) notes.push(`No trade history for ${d.approx.slice(0, 6).join(', ')} — treated as held for the whole window.`);
  if (d.missing?.length) notes.push(`No price history for ${d.missing.join(', ')} — held flat.`);
  return (
    <>
      <div className="perf-headline"><span className="pv">{money(base, d.end)}</span><span className="muted small">net invested {money(base, d.start + d.netInvested, 0)}</span></div>
      <div className="pf-stats">
        <Stat k="GAIN" v={moneySigned(base, d.gain)} cls={signClass(d.gain)} title="Money made in the window: value change minus net money added, plus dividends" />
        <Stat k={long ? 'TWR p.a.' : 'TWR'} v={pct(long ? d.twrAnnual : d.twr)} cls={signClass(d.twr)} title="Time-weighted return: how your holdings performed, ignoring when you added or withdrew money. Compare this with the index." />
        <Stat k={long ? 'XIRR p.a.' : 'MONEY-WTD'} v={pct(long ? d.xirr : d.mwr)} cls={signClass(d.mwr)} title="Money-weighted return (XIRR): your personal return including the timing of your buys and sells." />
        {b && <Stat k={b.name} v={pct(long ? b.twrAnnual : b.twr)} cls={signClass(b.twr)} title={`${b.name} return in ${base} (price index, FX-adjusted) over the same window`} />}
        {b && <Stat k="VS INDEX" v={pct(long ? d.twrAnnual - b.twrAnnual : d.twr - b.twr)} cls={signClass(d.twr - b.twr)} title="Your TWR minus the benchmark TWR" />}
      </div>
      <Chart d={d} base={base} />
      <div className="perf-note">Replays your actual buys &amp; sells with historical prices and FX. {notes.join(' ')}</div>
    </>
  );
}

export default function PerformanceIsland() {
  const { loaded, positions, base } = usePositions();
  const [range, setRange] = useState('1y');
  const [bench, setBench] = useState(readBench);
  const perf = usePerformance(range, bench, holdingsSig(positions));
  const head = (
    <PanelHeadSlot island="performance">
      <select id="perf-bench" className="mini-sel" title="Benchmark — the same cash flows put into this index on the same days" value={bench}
        onChange={(e) => { setBench(e.target.value); try { localStorage.setItem(BENCH_KEY, e.target.value); } catch { /* storage blocked */ } }}>
        {BENCHES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      <div className="ranges" id="perf-ranges">
        {RANGES.map(([v, l]) => <button key={v} data-range={v} className={range === v ? 'active' : ''} onClick={() => setRange(v)}>{l}</button>)}
      </div>
    </PanelHeadSlot>
  );
  let body;
  if (!loaded || !positions.length) body = <span className="muted">Add positions to see performance over time.</span>;
  else if (perf.isFetching || !perf.data && !perf.error) body = <span className="muted">Replaying your trades…</span>;
  else if (perf.error) body = <span className="down">{perf.error.message}</span>;
  else body = <Body d={perf.data!} fallbackBase={base} />;
  return <>{head}{body}</>;
}
