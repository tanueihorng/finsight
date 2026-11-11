import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { useQueries } from '@tanstack/react-query';
import { agentApi } from '../kestrel/api.ts';
import { queryDefaults } from '../../api/queries.ts';
import { downloadCsv, toCsv } from '../../ui/csv.ts';
import {
  answers, bar, CHECK_NAME, CHECK_ORDER, CHECK_SHORT, checkEvidence, comparable, compareOrder, dollars, equityChart, equityCsv, GLOSSARY, monthYear, nearestIndex, pct, place, plain, pts, scaleFor, shortDate, signed, STATUS_LABEL, STATUS_SHORT, statusOf, strategyLabel, tone, verdictLine, worstRemoval,
  type CheckId, type CheckStatus, type EquityPoint, type Interval, type Reproduced, type Robustness, type Run, type RunSummary,
} from './quant.ts';
import s from './Quant.module.css';

const toneClass = (v: number | null | undefined) => ({ up: s.up, down: s.down, '': '' })[tone(v)];
const statusClass: Record<CheckStatus, string> = { pass: s.pass!, fail: s.fail!, insufficient: s.unclear! };
export const Status = ({ status, short }: { status: CheckStatus; short?: boolean }) => <span className={`${s.status} ${statusClass[status]}`}>{short ? STATUS_SHORT[status] : STATUS_LABEL[status]}</span>;

// ---- equity chart --------------------------------------------------------------------
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null), [width, setWidth] = useState(720);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => { if (el.clientWidth) setWidth(el.clientWidth); };
    read();
    const watch = new ResizeObserver(read);
    watch.observe(el);
    return () => watch.disconnect();
  }, []);
  return [ref, width] as const;
}
const Key = ({ dashed, children }: { dashed?: boolean; children: ReactNode }) => <span className={s.key}><svg width="18" height="4" aria-hidden="true"><line x1="0" y1="2" x2="18" y2="2" className={dashed ? s.lineBench : s.lineMain} /></svg>{children}</span>;

export function EquityChart({ run, height = 230 }: { run: Run; height?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const points = run.monthlyEquity, holdout = run.robustness?.time.holdout?.start ?? null;
  const c = useMemo(() => equityChart(points, width, height, holdout), [points, width, height, holdout]);
  const [hover, setHover] = useState<number | null>(null), [table, setTable] = useState(false);
  if (points.length < 2) return <p className={s.muted}>Not enough months to draw a chart.</p>;
  const last = points[points.length - 1]!;
  const point: EquityPoint | null = hover == null ? null : points[hover]!;
  const move = (e: PointerEvent<SVGSVGElement>) => setHover(nearestIndex(c.x, e.clientX - e.currentTarget.getBoundingClientRect().left));
  const keys = (e: KeyboardEvent<SVGSVGElement>) => {
    const at = hover ?? points.length - 1;
    const to = e.key === 'ArrowLeft' ? Math.max(0, at - 1) : e.key === 'ArrowRight' ? Math.min(points.length - 1, at + 1) : e.key === 'Home' ? 0 : e.key === 'End' ? points.length - 1 : null;
    if (to != null) { e.preventDefault(); setHover(to); }
  };
  const flip = hover != null && c.x[hover]! > width * .65;
  return (
    <figure className={s.figure}>
      <figcaption className={s.chartHead}>
        <span className={s.chartTitle}>Value of {dollars(run.settings.initialCash)}, month by month</span>
        <Key>Strategy {dollars(last.strategy)}</Key>
        <Key dashed>{run.benchmark} {dollars(last.benchmark)}</Key>
        {holdout && <span className={s.holdoutKey}>Shaded: recent {run.robustness!.design.holdoutPercent}% from {shortDate(holdout)}</span>}
        <button type="button" className={s.linkBtn} aria-expanded={table} onClick={() => setTable((v) => !v)}>{table ? 'Show chart' : 'Show table'}</button>
      </figcaption>
      {table ? (
        <div className={s.scrollBox}><table className={s.table}>
          <thead><tr><th>Month</th><th className={s.num}>Strategy</th><th className={s.num}>{run.benchmark}</th></tr></thead>
          <tbody>{points.map((p) => <tr key={p.date}><td>{monthYear(p.date)}</td><td className={s.num}>{dollars(p.strategy)}</td><td className={s.num}>{dollars(p.benchmark)}</td></tr>)}</tbody>
        </table></div>
      ) : (
        <div ref={ref} className={s.chartBox} style={{ height }}>
          <svg width={width} height={height} className={s.chart} tabIndex={0} role="img" aria-label={`Strategy ended at ${dollars(last.strategy)} and ${run.benchmark} at ${dollars(last.benchmark)}. Use the left and right arrow keys to read each month.`}
            onPointerMove={move} onPointerLeave={() => setHover(null)} onKeyDown={keys} onBlur={() => setHover(null)}>
            {c.holdoutX != null && <rect x={c.holdoutX} y={c.plot.top} width={c.plot.right - c.holdoutX} height={c.plot.bottom - c.plot.top} className={s.holdout} />}
            {c.yTicks.map((t) => <g key={t.label}><line x1={c.plot.left} x2={c.plot.right} y1={t.at} y2={t.at} className={s.grid} /><text x={c.plot.left - 6} y={t.at + 3} textAnchor="end" className={s.axis}>{t.label}</text></g>)}
            {c.xTicks.map((t) => <text key={t.label} x={t.at} y={height - 5} textAnchor="middle" className={s.axis}>{t.label}</text>)}
            <path d={c.benchmark} className={s.lineBench} /><path d={c.strategy} className={s.lineMain} />
            {hover != null && <g><line x1={c.x[hover]} x2={c.x[hover]} y1={c.plot.top} y2={c.plot.bottom} className={s.cross} />
              <circle cx={c.x[hover]} cy={c.y(points[hover]!.benchmark)} r="4" className={s.dotBench} /><circle cx={c.x[hover]} cy={c.y(points[hover]!.strategy)} r="4" className={s.dotMain} /></g>}
          </svg>
          {point && <div className={s.tip} style={flip ? { right: width - c.x[hover!]! + 12 } : { left: c.x[hover!]! + 12 }} role="status">
            <b>{monthYear(point.date)}</b><span>Strategy {dollars(point.strategy)}</span><span>{run.benchmark} {dollars(point.benchmark)}</span>
          </div>}
        </div>
      )}
    </figure>
  );
}

// ---- small pieces --------------------------------------------------------------------
export function Stats({ items }: { items: [string, ReactNode, string?, string?][] }) {
  return <dl className={s.stats}>{items.map(([k, v, cls, help]) => <div key={k} title={help}><dt>{k}</dt><dd className={cls}>{v}</dd></div>)}</dl>;
}
function SignedBars({ rows, scale }: { rows: { label: string; value: number | null; text?: string }[]; scale: [number, number] }) {
  return <div className={s.bars}>{rows.map((r) => {
    const b = bar(r.value, scale);
    return <div className={s.barRow} key={r.label}><span className={s.barLabel}>{r.label}</span>
      <span className={s.track}><i className={s.zero} style={{ left: `${b.zero}%` }} /><i className={`${s.fillBar} ${(r.value ?? 0) >= 0 ? s.barUp : s.barDown}`} style={{ left: `${b.left}%`, width: `${b.width}%` }} /></span>
      <span className={`${s.barValue} ${toneClass(r.value)}`}>{r.text ?? pts(r.value)}</span></div>;
  })}</div>;
}
function IntervalLine({ interval, point, scale }: { interval: Interval; point: number | null; scale: [number, number] }) {
  if (!interval) return <span className={s.muted}>—</span>;
  return <span className={s.track}><i className={s.zero} style={{ left: `${place(0, scale)}%` }} />
    <i className={s.range} style={{ left: `${place(interval[0], scale)}%`, width: `${place(interval[1], scale) - place(interval[0], scale)}%` }} />
    {point != null && <i className={s.point} style={{ left: `${place(point, scale)}%` }} />}</span>;
}
export function NotChecked({ onRun, busy }: { onRun: () => void; busy: boolean }) {
  return <div className={s.notice}><div><b>These numbers have not been stress-tested.</b><p>The six checks replay this run on later dates, fewer stocks and higher costs. It takes under a minute and changes nothing else.</p></div>
    <button type="button" className={s.primary} disabled={busy} onClick={onRun}>{busy ? 'Working…' : 'Run the six checks'}</button></div>;
}
const Limits = ({ r }: { r: Robustness }) => <details className={s.limits}><summary>What these checks cannot show</summary><p>{r.label}</p><ul>{r.limits.map((x) => <li key={x}>{x}</li>)}</ul></details>;

// ---- overview ------------------------------------------------------------------------
export function Overview({ run, onCheck, busy }: { run: Run; onCheck: () => void; busy: boolean }) {
  const { strategy: p, benchmark: b, excess } = run.performance, [sub, setSub] = useState<'positions' | 'fills'>('positions');
  return <>
    {!run.robustness && <NotChecked onRun={onCheck} busy={busy} />}
    <Stats items={[
      ['CAGR', pct(p.cagrPct), '', 'Steady yearly growth rate over the window.'], [run.benchmark, pct(b.cagrPct)], ['VS ' + run.benchmark, pts(excess.cagrPct, 2), toneClass(excess.cagrPct)],
      ['SHARPE', plain(p.sharpe), '', 'Return per unit of volatility.'], ['MAX DROP', pct(p.maxDrawdownPct, 1), '', 'Largest fall from a peak.'], ['WIN RATE', pct(run.trading.winRatePct, 1)],
      ['INVESTED', pct(run.activity.averageExposurePct, 1), '', 'Average share of the portfolio in stocks.'], ['COSTS', dollars(run.activity.totalCosts)],
    ]} />
    <div className={s.pad}><EquityChart run={run} /></div>
    <div className={s.subTabs} role="group" aria-label="Holdings and fills">
      <button type="button" aria-pressed={sub === 'positions'} className={sub === 'positions' ? s.subOn : ''} onClick={() => setSub('positions')}>Open positions ({run.openPositions.length})</button>
      <button type="button" aria-pressed={sub === 'fills'} className={sub === 'fills' ? s.subOn : ''} onClick={() => setSub('fills')}>Latest fills ({run.recentFills.length})</button>
    </div>
    {sub === 'positions'
      ? run.openPositions.length ? <div className={s.scrollBox}><table className={s.table}>
        <thead><tr><th>Stock</th><th>Bought</th><th className={s.num}>Shares</th><th className={s.num}>Entry</th><th className={s.num}>Latest</th><th className={s.num}>Unrealized</th></tr></thead>
        <tbody>{run.openPositions.map((x) => <tr key={x.symbol}><td className={s.sym}>{x.symbol}</td><td className={s.muted}>{shortDate(x.entryDate)}</td><td className={s.num}>{x.shares}</td><td className={s.num}>{plain(x.entryPx)}</td><td className={s.num}>{plain(x.markPx)}</td><td className={`${s.num} ${toneClass(x.unrealizedPnl)}`}>{x.unrealizedPnl > 0 ? '+' : ''}{dollars(x.unrealizedPnl)}</td></tr>)}</tbody>
      </table></div> : <p className={s.emptyLine}>The backtest ended with no open positions.</p>
      : run.recentFills.length ? <div className={s.scrollBox}><table className={s.table}>
        <thead><tr><th>Date</th><th>Stock</th><th>Side</th><th className={s.num}>Shares</th><th className={s.num}>Price</th><th>Reason</th></tr></thead>
        <tbody>{[...run.recentFills].reverse().map((x, i) => <tr key={i}><td className={s.muted}>{shortDate(x.date)}</td><td className={s.sym}>{x.symbol}</td><td>{x.side}</td><td className={s.num}>{x.shares}</td><td className={s.num}>{plain(x.px)}</td><td className={s.muted}>{x.why}</td></tr>)}</tbody>
      </table></div> : <p className={s.emptyLine}>No fills in this run.</p>}
  </>;
}

// ---- evidence ------------------------------------------------------------------------
export function Evidence({ run, onCheck, busy }: { run: Run; onCheck: () => void; busy: boolean }) {
  const r = run.robustness, { strategy: p, benchmark: b, excess } = run.performance;
  if (!r) return <NotChecked onRun={onCheck} busy={busy} />;
  const total = r.summary.pass + r.summary.fail + r.summary.insufficient;
  return <>
    <div className={s.heroes}>
      <section className={s.hero} aria-label="Return">
        <h3>RETURN, {shortDate(run.window.start).toUpperCase()} TO {shortDate(run.window.end).toUpperCase()}</h3>
        <p className={s.big}>{pct(p.cagrPct)}<small>a year, against {run.benchmark} {pct(b.cagrPct)}</small></p>
        <Stats items={[['VS ' + run.benchmark, pts(excess.cagrPct, 2), toneClass(excess.cagrPct)], ['SHARPE', `${plain(p.sharpe)} / ${plain(b.sharpe)}`], ['MAX DROP', `${pct(p.maxDrawdownPct, 1)} / ${pct(b.maxDrawdownPct, 1)}`], ['TRADES', `${run.trading.closedTrades} + ${run.trading.openTrades} open`]]} />
      </section>
      <section className={s.hero} aria-label="Robustness">
        <h3>ROBUSTNESS WITH FROZEN RULES</h3>
        <p className={s.big}>{r.summary.pass} of {total}<small>checks passed</small></p>
        <div className={s.strip} aria-hidden="true">{CHECK_ORDER.map((id) => <i key={id} className={statusClass[statusOf(r, id)]} />)}</div>
        <p className={s.verdict}>{verdictLine(r)}</p>
      </section>
    </div>
    <div className={s.tiles}>{checkEvidence(r, run.benchmark).map((c) => (
      <article key={c.id} className={s.tile} title={c.rule}><header><h4>{c.name}</h4><Status status={c.status} /></header><p className={s.tileValue}>{c.value}</p><p className={s.muted}>{c.detail}</p></article>
    ))}</div>
    <div className={s.pad}><EquityChart run={run} height={200} /></div>
    <div className={s.pad}><Limits r={r} /></div>
  </>;
}

// ---- compare -------------------------------------------------------------------------
export function Compare({ runs, selected, names, onSelect, onCheck, busy }: { runs: RunSummary[]; selected: RunSummary; names: Record<string, string>; onSelect: (id: string) => void; onCheck: (id: string) => void; busy: boolean }) {
  const { rows, hidden } = comparable(runs, selected);
  const details = useQueries({ queries: rows.map((r) => ({ queryKey: ['quant-run', r.runId], staleTime: 60_000, ...queryDefaults, queryFn: () => agentApi<Run>(`/quant/runs/${r.runId}`) })) });
  const loaded = details.map((d) => d.data).filter((d): d is Run => !!d);
  if (loaded.length < rows.length) return <p className={s.emptyLine}>Loading {rows.length} runs…</p>;
  const ordered = compareOrder(loaded, names);
  const benchmark = selected.benchmarkSymbol;
  const checked = ordered.filter((r): r is Run & { robustness: Robustness } => !!r.robustness);
  const scale = scaleFor(checked.flatMap((r) => [...(r.robustness.bootstrap.intervals.excessCagrPct ?? []), r.performance.excess.cagrPct]));
  return <>
    <p className={s.caution}>{rows.length > 1 ? `Picking the best of ${rows.length} strategies on the same history raises the odds that it won by luck. These checks do not correct for that.` : 'Only one strategy has been run on this exact test. Run another with the same stocks and settings to compare them.'}</p>
    <div className={s.scrollBox}><table className={`${s.table} ${s.compare}`}>
      <thead><tr><th>Strategy</th>{CHECK_ORDER.map((id) => <th key={id} className={s.mid} title={CHECK_NAME[id]}>{CHECK_SHORT[id]}</th>)}<th className={s.num}>Passed</th><th className={s.num}>CAGR</th><th className={s.num}>vs {benchmark}</th><th className={s.num}>Max drop</th><th className={s.num}>Trades</th></tr></thead>
      <tbody>{ordered.map((r) => (
        <tr key={r.runId} className={r.runId === selected.runId ? s.rowOn : ''}>
          <th scope="row"><button type="button" className={s.linkBtn} onClick={() => onSelect(r.runId)}>{strategyLabel(r.strategy, names)}</button></th>
          {r.robustness ? CHECK_ORDER.map((id) => <td key={id} className={s.mid}><Status status={statusOf(r.robustness!, id)} short /></td>)
            : <td colSpan={6} className={s.mid}><button type="button" className={s.btn} disabled={busy} onClick={() => onCheck(r.runId)}>Run checks</button></td>}
          <td className={`${s.num} ${s.strong}`}>{r.robustness ? `${r.robustness.summary.pass}/6` : '—'}</td>
          <td className={s.num}>{pct(r.performance.strategy.cagrPct)}</td><td className={`${s.num} ${toneClass(r.performance.excess.cagrPct)}`}>{signed(r.performance.excess.cagrPct, 2)}</td><td className={s.num}>{pct(r.performance.strategy.maxDrawdownPct, 1)}</td><td className={s.num}>{r.trading.closedTrades}</td>
        </tr>
      ))}</tbody>
    </table></div>
    {hidden > 0 && <p className={s.emptyLine}>{hidden} other saved {hidden === 1 ? 'run is' : 'runs are'} left out because {hidden === 1 ? 'it uses' : 'they use'} different stocks, dates, settings, price data or replay code, or {hidden === 1 ? 'is' : 'are'} an older copy.</p>}
    {checked.length > 0 && <div className={s.halves}>
      <section className={s.pad} aria-label="Intervals">
        <h3 className={s.sectH}>Yearly lead over {benchmark}: run result and {checked[0]!.robustness.bootstrap.confidencePct}% interval</h3>
        <p className={s.fine}>Dot: the run's result. Line: the interval. Vertical mark: zero, level with {benchmark}.</p>
        <div className={s.bars}>{checked.map((r) => { const i = r.robustness.bootstrap.intervals.excessCagrPct; return <div className={s.barRow} key={r.runId}><span className={s.barLabel}>{strategyLabel(r.strategy, names)}</span><IntervalLine interval={i} point={r.performance.excess.cagrPct} scale={scale} /><span className={s.barWide}>{signed(i?.[0])} to {signed(i?.[1])}</span></div>; })}</div>
      </section>
      <section className={s.pad} aria-label="By period and cost">
        <h3 className={s.sectH}>Points over {benchmark}, by period and extra cost</h3>
        <div className={s.scrollBox}><table className={`${s.table} ${s.tight}`}>
          <thead><tr><th />{checked[0]!.robustness.time.periods.map((_, i) => <th key={i} className={s.num}>P{i + 1}</th>)}{checked[0]!.robustness.cost.grid.filter((c) => [0, 25, 100].includes(c.extraBpsPerSide)).map((c) => <th key={c.extraBpsPerSide} className={s.num}>+{c.extraBpsPerSide} bps</th>)}</tr></thead>
          <tbody>{checked.map((r) => <tr key={r.runId}><th scope="row" className={s.wrapName}>{strategyLabel(r.strategy, names)}</th>
            {r.robustness.time.periods.map((p, i) => <td key={i} className={`${s.num} ${toneClass(p?.excessCagrPct)}`}>{signed(p?.excessCagrPct)}</td>)}
            {r.robustness.cost.grid.filter((c) => [0, 25, 100].includes(c.extraBpsPerSide)).map((c) => <td key={c.extraBpsPerSide} className={`${s.num} ${toneClass(c.excessCagrPct)}`}>{signed(c.excessCagrPct)}</td>)}</tr>)}</tbody>
        </table></div>
        <p className={s.fine}>P1 onward are equal slices of the window, oldest first.</p>
      </section>
    </div>}
  </>;
}

// ---- plain English -------------------------------------------------------------------
const answerClass = { good: s.up, bad: s.down, unclear: s.amber };
export function Explain({ run, focus, onCheck, busy }: { run: Run; focus: CheckId | null; onCheck: () => void; busy: boolean }) {
  const r = run.robustness, root = useRef<HTMLDivElement>(null);
  useEffect(() => { if (focus) root.current?.querySelector<HTMLElement>(`[data-check~="${focus}"]`)?.scrollIntoView({ block: 'start' }); }, [focus]);
  if (!r) return <NotChecked onRun={onCheck} busy={busy} />;
  const list = answers(run, r), i = r.bootstrap.intervals.excessCagrPct;
  const visuals: ReactNode[] = [
    <EquityChart run={run} height={180} key="eq" />,
    <SignedBars key="p" scale={scaleFor(r.time.periods.map((p) => p?.excessCagrPct))} rows={r.time.periods.map((p, n) => ({ label: p ? `${monthYear(p.start)} – ${monthYear(p.end)}` : `Period ${n + 1}`, value: p?.excessCagrPct ?? null }))} />,
    <SignedBars key="u" scale={scaleFor(r.universe.removals.map((x) => x.excessCagrPct))} rows={[...r.universe.removals].sort((a, b) => (a.excessCagrPct ?? 0) - (b.excessCagrPct ?? 0)).map((x) => ({ label: `Without ${x.removed}`, value: x.excessCagrPct }))} />,
    <SignedBars key="c" scale={scaleFor(r.cost.grid.map((c) => c.excessCagrPct))} rows={r.cost.grid.map((c) => ({ label: `+${c.extraBpsPerSide} bps`, value: c.excessCagrPct }))} />,
    <div key="b" className={s.barRow}><span className={s.barLabel}>Yearly lead</span><IntervalLine interval={i} point={run.performance.excess.cagrPct} scale={scaleFor([...(i ?? []), run.performance.excess.cagrPct])} /><span className={s.barWide}>{signed(i?.[0])} to {signed(i?.[1])}</span></div>,
  ];
  return <div ref={root} className={s.explain}>
    {list.map((a, n) => <section key={a.question} data-check={a.checks.join(' ')} className={s.question}>
      <h3>{n + 1}. {a.question}</h3>
      <p><b className={answerClass[a.tone]}>{a.answer}.</b> {a.text}</p>
      {visuals[n]}
      {a.checks.length > 0 && <p className={s.fine}>{a.checks.map((id) => <span key={id} className={s.checkTag}><Status status={statusOf(r, id)} /> {CHECK_NAME[id]}</span>)}</p>}
    </section>)}
    <div className={s.pad}><Limits r={r} /></div>
  </div>;
}

// ---- details -------------------------------------------------------------------------
export function Details({ run, onReproduce, reproduced, busy }: { run: Run; onReproduce: () => void; reproduced: Reproduced | null; busy: boolean }) {
  const c = run.settings, t = run.trading, a = run.activity;
  const prov = Object.entries(run.provenance);
  return <div className={s.detailGrid}>
    <section><h3 className={s.sectH}>Settings</h3><Stats items={[['STOCKS', run.universe.length], ['YEARS', c.years], ['START', dollars(c.initialCash)], ['POSITION', `${c.positionPct}%`], ['MAX HELD', c.maxPositions], ['COMMISSION', `${c.costBps} bps`], ['EXTRA SLIPPAGE', `${c.extraSlippageBps} bps`], ['RISK-FREE', `${c.riskFreePct}%`]]} />
      <p className={s.fine}>{run.universe.join(', ')}</p></section>
    <section><h3 className={s.sectH}>Trading</h3><Stats items={[['CLOSED', t.closedTrades], ['OPEN', t.openTrades], ['WIN RATE', pct(t.winRatePct, 1)], ['AVG TRADE', pct(t.expectancyPct)], ['PROFIT FACTOR', plain(t.profitFactor)], ['AVG HOLD', `${plain(t.averageHoldCalendarDays, 0)} days`], ['TURNOVER', `${plain(a.annualTurnover)}x a year`], ['DIVIDENDS', dollars(a.dividendsReceived)]]} />
      <p className={s.fine}>Skipped entries: {Object.entries(run.rejected).filter(([, n]) => n).map(([k, n]) => `${n} ${k.replace(/_/g, ' ')}`).join(', ') || 'none'}. Reduced entries: {run.reducedEntries}.</p></section>
    <section><h3 className={s.sectH}>Warnings</h3><ul className={s.list}>{run.warnings.map((w) => <li key={w}>{w}</li>)}</ul></section>
    <section><h3 className={s.sectH}>Assumptions</h3><ul className={s.list}>{run.assumptions.map((w) => <li key={w}>{w}</li>)}</ul></section>
    <section><h3 className={s.sectH}>Can this be reproduced?</h3>
      <p className={s.muted}>Recomputes this run from its stored prices with the current engine.</p>
      <div className={s.actions}><button type="button" className={s.btn} disabled={busy} onClick={onReproduce}>Recompute</button>
        <button type="button" className={s.btn} onClick={() => downloadCsv(`${run.runId}-equity.csv`, toCsv(equityCsv(run)))}>Export monthly values (CSV)</button></div>
      {reproduced && <p role="status" className={reproduced.reproduced ? s.up : s.down}>{reproduced.reproduced ? 'Recomputed. It matches the saved run exactly.' : `Recomputed. It differs from the saved run${reproduced.changedSections.length ? ` in ${reproduced.changedSections.join(', ')}` : ''}${reproduced.engineChanged ? ' (the engine has changed)' : ''}.`}</p>}
      <details className={s.limits}><summary>Run fingerprint</summary><dl className={s.hashes}>{prov.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{String(v)}</dd></div>)}</dl></details></section>
    <section><h3 className={s.sectH}>Terms</h3><dl className={s.glossary}>{GLOSSARY.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl></section>
  </div>;
}

// ---- right-hand rail ----------------------------------------------------------------
export function CheckRail({ run, onOpen, onCheck, busy }: { run: Run; onOpen: (id: CheckId) => void; onCheck: () => void; busy: boolean }) {
  const r = run.robustness;
  if (!r) return <div className={s.railEmpty}><p className={s.muted}>No checks yet for this run.</p><button type="button" className={s.primary} disabled={busy} onClick={onCheck}>Run the six checks</button></div>;
  const { pass, fail, insufficient } = r.summary;
  const worst = worstRemoval(r);
  return <>
    <h3 className={s.railH}><span>CHECKS</span><span>{pass} PASS · {fail} FAIL{insufficient ? ` · ${insufficient} UNCLEAR` : ''}</span></h3>
    <ul className={s.checks}>{checkEvidence(r, run.benchmark).map((c) => <li key={c.id}><button type="button" onClick={() => onOpen(c.id)} title="Open the explanation">
      <Status status={c.status} short /><span className={s.checkName}>{c.name}</span><span className={s.muted}>{c.value}</span></button></li>)}</ul>
    <h3 className={s.railH}><span>LEAD OVER {run.benchmark} AT HIGHER COST</span></h3>
    <div className={s.railTable}>{r.cost.grid.map((c) => <div key={c.extraBpsPerSide}><span className={s.muted}>+{c.extraBpsPerSide} bps</span><span className={toneClass(c.excessCagrPct)}>{pts(c.excessCagrPct)}</span></div>)}</div>
    {worst && <p className={s.fine}>Weakest removal: {worst.removed}, {pts(worst.excessCagrPct)}.</p>}
    <p className={s.fine}>No check changes a strategy's status or authorises a paper order.</p>
  </>;
}
