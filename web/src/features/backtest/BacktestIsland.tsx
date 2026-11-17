// FEAT-015 §6 Backtester and paper promotion. Runs the built-in strategy
// engines over a list of symbols with costs, an out-of-sample split and a
// buy-and-hold comparison. "Paper" is a status you record; it tracks signals
// from that date forward and never places, drafts or approves an order.
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client.ts';
import { useScope } from '../../api/queries.ts';
import { PanelHeadSlot } from '../../ui/PanelHeadSlot.tsx';
import { confirmDialog } from '../../ui/dialog.tsx';
import { fmt, signClass } from '../../ui/format.ts';
import type { BacktestRun, PaperTrack, StrategyRow, TradeStats } from '../../../../shared/backtest.ts';

interface Lib { strategies: StrategyRow[]; defaultUniverse: string[]; gate: { minTrades: number; minOutOfSample: number } }
const post = <T,>(url: string, body: unknown) => api<T>(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const pct = (v: number | null | undefined, d = 1) => v == null ? '—' : fmt(v, d) + '%';

function StatRow({ label, s, measure }: { label: string; s: TradeStats; measure: 'R' | 'pct' }) {
  return <tr><td>{label}</td><td className="r">{s.n}</td><td className="r">{pct(s.winRate, 0)}</td>
    <td className={'r ' + signClass(s.avgRetPct)}>{pct(s.avgRetPct, 2)}</td>
    {measure === 'R' && <td className={'r ' + signClass(s.expectancyR)}>{s.expectancyR == null ? '—' : fmt(s.expectancyR, 2) + 'R'}</td>}</tr>;
}

export default function BacktestIsland() {
  useEffect(() => { const el = document.getElementById('backtest'); if (el) { el.tabIndex = 0; el.setAttribute('aria-label', 'Strategy backtester'); } }, []);
  const { base, enabled } = useScope();
  const client = useQueryClient();
  const lib = useQuery({ queryKey: ['backtest-lib', base], enabled, staleTime: 600_000, queryFn: ({ signal }) => api<Lib>(`/api/backtest/strategies?base=${encodeURIComponent(base)}`, { signal }) });
  const paper = useQuery({ queryKey: ['backtest-paper'], enabled: enabled && !!lib.data?.strategies.some((s) => s.owner?.status === 'paper'), staleTime: 900_000,
    queryFn: ({ signal }) => api<{ tracks: PaperTrack[] }>('/api/backtest/paper', { signal }) });
  const [strategy, setStrategy] = useState('rsi2'), [symbols, setSymbols] = useState<string | null>(null), [range, setRange] = useState('5y');
  const [run, setRun] = useState<BacktestRun | null>(null), [busy, setBusy] = useState(''), [err, setErr] = useState(''), [bySym, setBySym] = useState(false);
  const universe = symbols ?? (lib.data?.defaultUniverse.join(' ') || '');
  const go = async () => {
    setBusy('run'); setErr(''); setRun(null);
    try { setRun(await post<BacktestRun>('/api/backtest/run', { strategy, symbols: universe, range })); } catch (e) { setErr((e as Error).message); } finally { setBusy(''); }
  };
  const refresh = (strategies: StrategyRow[]) => { client.setQueryData(['backtest-lib', base], { ...lib.data!, strategies }); void client.invalidateQueries({ queryKey: ['backtest-paper'] }); };
  const promote = async () => {
    if (!run) return;
    const ok = await confirmDialog({ title: `Record ${run.strategy.name} as paper?`,
      body: `FinSight re-runs this backtest and records "paper" from today for these ${run.universe.length} symbols, then shows the signals it gives from today onward. It does not place, draft or approve any order, and it is not acceptance into your policy.`, ok: 'Record paper' });
    if (!ok) return;
    setBusy('promote'); setErr('');
    try { refresh((await post<{ strategies: StrategyRow[] }>('/api/backtest/promote', { strategy: run.strategy.id, symbols: run.universe, range: run.range })).strategies); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(''); }
  };
  const setStatus = async (id: string, status: string) => {
    setErr('');
    try { refresh((await post<{ strategies: StrategyRow[] }>('/api/backtest/status', { strategy: id, status })).strategies); } catch (e) { setErr((e as Error).message); }
  };
  const d = lib.data;
  const nPaper = d?.strategies.filter((s) => s.owner?.status === 'paper').length ?? 0;
  const head = <PanelHeadSlot island="backtest">{d && <span>{nPaper} ON PAPER</span>}</PanelHeadSlot>;
  if (lib.isError) return <>{head}<span className="down">{lib.error.message}</span></>;
  if (!d) return <>{head}<span className="muted">Loading…</span></>;
  return <>{head}
    <div className="bt-form">
      <label>STRATEGY <select aria-label="Strategy" value={strategy} onChange={(e) => { setStrategy(e.target.value); setRun(null); }}>
        {d.strategies.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      <label>HISTORY <select aria-label="History" value={range} onChange={(e) => setRange(e.target.value)}><option value="2y">2y</option><option value="5y">5y</option><option value="10y">10y</option></select></label>
      <textarea aria-label="Symbols to test" rows={2} value={universe} onChange={(e) => setSymbols(e.target.value)} placeholder="Symbols, e.g. AAPL MSFT" />
      <div className="gr-actions"><button className="mini-btn" disabled={!!busy || !universe.trim()} onClick={go}>{busy === 'run' ? 'RUNNING…' : 'RUN BACKTEST'}</button>
        <span className="grow" />{err && <span className="down small" role="alert">{err}</span>}</div>
    </div>
    {run && <div className="bt-result">
      <table className="tbl bt-tbl"><thead><tr><th>{run.strategy.name}</th><th className="r">TRADES</th><th className="r">WIN</th><th className="r">AVG/TRADE</th>{run.strategy.measure === 'R' && <th className="r">EXPECT.</th>}</tr></thead><tbody>
        <StatRow label="All" s={run.total.all} measure={run.strategy.measure} />
        <StatRow label="In sample" s={run.total.inSample} measure={run.strategy.measure} />
        <StatRow label={`Out of sample (last ${run.splitPct}%)`} s={run.total.outOfSample} measure={run.strategy.measure} />
      </tbody></table>
      <div className="small">Beat buy-and-hold on {run.total.beatBuyHold} of {run.total.compared} symbols (compounded trade returns vs holding throughout).</div>
      <div className="gr-actions">
        <button className="mini-btn" aria-expanded={bySym} onClick={() => setBySym(!bySym)}>{bySym ? 'HIDE' : 'SHOW'} BY SYMBOL</button>
        <span className="grow" />
        {run.gate.passes ? <button className="mini-btn" disabled={!!busy} onClick={promote}>{busy === 'promote' ? 'RECORDING…' : 'RECORD AS PAPER'}</button>
          : <span className="dim small">Paper needs more evidence: {run.gate.reasons.join(' ')}</span>}
      </div>
      {bySym && <table className="tbl bt-tbl"><thead><tr><th>SYMBOL</th><th className="r">TRADES</th><th className="r">OOS</th><th className="r">STRATEGY</th><th className="r">BUY &amp; HOLD</th><th className="r">IN MKT</th></tr></thead><tbody>
        {run.symbols.map((s) => <tr key={s.symbol}><td>{s.symbol}{s.error && <div className="dim small">{s.error}</div>}</td><td className="r">{s.all.n}</td><td className="r">{s.outOfSample.n}</td>
          <td className={'r ' + signClass(s.strategyPct)}>{pct(s.strategyPct)}</td><td className={'r ' + signClass(s.buyHoldPct)}>{pct(s.buyHoldPct)}</td><td className="r">{pct(s.timeInMarketPct, 0)}</td></tr>)}
      </tbody></table>}
      <div className="fxr-note">{run.notes.join(' ')}</div>
    </div>}
    <table className="tbl bt-tbl"><thead><tr><th>STRATEGY</th><th>LIBRARY</th><th>YOURS</th><th></th></tr></thead><tbody>
      {d.strategies.map((s) => <tr key={s.id}><td>{s.name}</td><td className="dim">{s.libraryStatus ?? '—'}</td>
        <td>{s.owner ? <span className={s.owner.status === 'paper' ? 'up' : ''}>{s.owner.status} <span className="dim small">since {s.owner.since}</span></span> : <span className="dim">—</span>}</td>
        <td className="r">{s.owner?.status === 'paper' && <button className="mini-btn" onClick={() => setStatus(s.id, 'backtested')}>END PAPER</button>}
          {s.owner && <button className="mini-btn" onClick={() => setStatus(s.id, 'clear')}>CLEAR</button>}</td></tr>)}
    </tbody></table>
    {paper.data?.tracks.map((t) => <div key={t.id} className="bt-track">
      <div className="small"><b>{d.strategies.find((s) => s.id === t.id)?.name ?? t.id}</b> on paper since {t.since}: {t.stats.n} closed signal{t.stats.n === 1 ? '' : 's'}{t.stats.n ? `, avg ${pct(t.stats.avgRetPct, 2)}` : ''}.
        {t.live.length ? ` Now: ${t.live.map((l) => `${l.symbol} ${l.stage}`).join('; ')}.` : ''}</div>
      {!!t.trades.length && <table className="tbl bt-tbl"><tbody>{t.trades.slice(0, 8).map((x, i) => <tr key={i}><td>{x.symbol}</td><td className="dim">{x.entryDate} → {x.exitDate ?? 'open'}</td>
        <td className={'r ' + signClass(x.retPct)}>{pct(x.retPct, 2)}</td></tr>)}</tbody></table>}
    </div>)}
    <div className="fxr-note">Library status is the generic record shipped with FinSight; "yours" is stored only in your data folder. Paper needs at least {d.gate.minTrades} trades and {d.gate.minOutOfSample} out-of-sample (FinSight's minimum, not your policy). Only you can accept a strategy, in your investment policy.</div>
  </>;
}
