import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useStore } from 'zustand';
import { queryDefaults, usePortfolio, useWatchlist } from '../../api/queries.ts';
import { useModalFocus } from '../../ui/modalFocus.ts';
import { agentApi, AgentError } from '../kestrel/api.ts';
import { closeQuantLab, quantLab } from './open.ts';
import { CheckRail, Compare, Details, Evidence, Explain, Overview } from './views.tsx';
import {
  checkForm, checksLabel, emptyForm, EXAMPLE_SYMBOLS, isTab, nextTab, parseSymbols, pct, savedLabel, shortDate, strategyLabel, TABS, universeLabel, windowYears,
  type CheckId, type Form, type FormErrors, type BacktestBody, type Reproduced, type Run, type RunList, type RunSummary, type Strategy, type Tab,
} from './quant.ts';
import s from './Quant.module.css';

// Quant Lab (FEAT-014): the workbench over saved portfolio backtests. Saved runs
// on the left, one run in the middle under five views, its checks on the right.
// Research only: nothing here can place an order or change a strategy's status.
const TAB_KEY = 'finsight-quant-tab', RUN_KEY = 'finsight-quant-run';
const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const save = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* per-browser convenience only */ } };

interface Job { title: string; step: number; steps: number; startedAt: number }
const offline = (e: unknown) => e instanceof AgentError && (e.code === 'AGENT_OFFLINE' || e.status === 503);
const message = (e: unknown) => offline(e) ? 'Kestrel is not running, so the Lab cannot reach its saved runs. Start it from the Kestrel panel, then try again.' : (e as Error).message;

function useJob(select: (id: string) => void) {
  const qc = useQueryClient();
  const [job, setJob] = useState<Job | null>(null), [error, setError] = useState(''), [elapsed, setElapsed] = useState(0), [reproduced, setReproduced] = useState<Reproduced | null>(null);
  const stop = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!job) return;
    setElapsed(Math.floor((Date.now() - job.startedAt) / 1000));
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - job.startedAt) / 1000)), 1000);
    return () => clearInterval(t);
  }, [job]);
  const refresh = (id: string) => Promise.all([qc.invalidateQueries({ queryKey: ['quant-runs'] }), qc.invalidateQueries({ queryKey: ['quant-run', id] })]);
  const running = async (work: (signal: AbortSignal) => Promise<void>) => {
    const c = new AbortController(); stop.current = c; setError(''); setReproduced(null);
    try { await work(c.signal); }
    catch (e) { if ((e as Error).name !== 'AbortError') setError(message(e)); }
    finally { setJob(null); stop.current = null; }
  };
  const check = (signal: AbortSignal, id: string) => agentApi(`/quant/runs/${id}/validate`, { method: 'POST', body: {}, signal });
  return {
    job, error, elapsed, reproduced, clearError: () => setError(''), cancel: () => stop.current?.abort(),
    backtest: (body: BacktestBody, done: () => void) => running(async (signal) => {
      setJob({ title: 'Running the backtest', step: 1, steps: 2, startedAt: Date.now() });
      const { runId } = await agentApi<{ runId: string }>('/quant/runs', { method: 'POST', body, signal });
      await refresh(runId); select(runId); done();
      setJob({ title: 'Running the six checks', step: 2, steps: 2, startedAt: Date.now() });
      await check(signal, runId).catch((e: Error) => { if (e.name === 'AbortError') throw e; throw new Error(`The backtest is saved, but its checks did not finish. ${message(e)}`); });
      await refresh(runId);
    }),
    checks: (id: string) => running(async (signal) => {
      setJob({ title: 'Running the six checks', step: 1, steps: 1, startedAt: Date.now() });
      await check(signal, id); await refresh(id);
    }),
    reproduce: (id: string) => running(async (signal) => {
      setJob({ title: 'Recomputing from stored prices', step: 1, steps: 1, startedAt: Date.now() });
      setReproduced(await agentApi<Reproduced>(`/quant/runs/${id}/reproduce`, { method: 'POST', body: {}, signal }));
    }),
  };
}

function Field({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: string; children: (a: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }) => React.ReactNode }) {
  const note = `${id}-note`;
  return <div className={s.field}><label htmlFor={id}>{label}</label>
    {children({ id, 'aria-describedby': error || hint ? note : undefined, 'aria-invalid': error ? true : undefined })}
    {error ? <span id={note} className={s.fieldErr}>{error}</span> : hint ? <span id={note} className={s.fine}>{hint}</span> : null}</div>;
}

function NewRun({ strategies, busy, onRun, onCancel, canCancel }: { strategies: Strategy[]; busy: boolean; onRun: (b: BacktestBody) => void; onCancel: () => void; canCancel: boolean }) {
  const [f, setF] = useState<Form>(() => emptyForm()), [errors, setErrors] = useState<FormErrors>({});
  const wl = useWatchlist(), portfolio = usePortfolio();
  const usable = strategies.filter((x) => x.mechanical && x.kind === 'trade');
  useEffect(() => { if (!f.strategy && usable[0]) setF((x) => ({ ...x, strategy: usable[0]!.key })); }, [usable.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (patch: Partial<Form>) => { setF((x) => ({ ...x, ...patch })); setErrors((e) => { const next = { ...e }; for (const k of Object.keys(patch)) delete next[k as keyof Form]; return next; }); };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const out = checkForm(f);
    if ('errors' in out) {
      setErrors(out.errors);
      if (Object.keys(out.errors).some((k) => !['strategy', 'symbols', 'years'].includes(k))) (e.currentTarget as HTMLFormElement).querySelector('details')?.setAttribute('open', '');
      return;
    }
    onRun(out.body); // the form keeps its values, so the next strategy can run on the same stocks
  };
  const count = parseSymbols(f.symbols).symbols.length;
  const watch = (wl.data?.watchlist ?? []).map((w) => w.symbol).filter((x) => !x.startsWith('^'));
  const held = (portfolio.data?.positions ?? []).filter((p) => p.currency === 'USD').map((p) => p.symbol);
  const text = (id: keyof Form, label: string, hint?: string) => <Field id={`quant-${id}`} label={label} hint={hint} error={errors[id]}>{(a) => <input {...a} className={s.input} value={f[id]} inputMode={id === 'benchmark' ? 'text' : 'decimal'} onChange={(e) => set({ [id]: e.target.value })} />}</Field>;
  return <form className={s.form} onSubmit={submit} aria-label="New backtest" noValidate>
    <Field id="quant-strategy" label="Strategy" error={errors.strategy}>{(a) => <select {...a} className={s.input} value={f.strategy} onChange={(e) => set({ strategy: e.target.value })}>
      {usable.length ? usable.map((x) => <option key={x.key} value={x.key}>{x.name}</option>) : <option value="">Loading…</option>}</select>}</Field>
    <Field id="quant-symbols" label={`Stocks${count ? ` (${count})` : ''}`} hint="US tickers, separated by commas or spaces" error={errors.symbols}>{(a) => <textarea {...a} className={s.textarea} rows={3} value={f.symbols} spellCheck={false} placeholder="AAPL, MSFT, NVDA" onChange={(e) => set({ symbols: e.target.value })} />}</Field>
    <div className={s.presets} role="group" aria-label="Fill the stock list">
      <button type="button" onClick={() => set({ symbols: EXAMPLE_SYMBOLS })}>13 large US stocks</button>
      <button type="button" disabled={!watch.length} onClick={() => set({ symbols: watch.join(', ') })}>My watchlist</button>
      <button type="button" disabled={!held.length} onClick={() => set({ symbols: held.join(', ') })}>My US holdings</button>
    </div>
    {text('years', 'Years of history', '1 to 9, ending at the last full trading day')}
    <details className={s.more}><summary>More settings <span className={s.fine}>{f.positionPct}% positions, {f.costBps} bps, vs {f.benchmark.toUpperCase()}</span></summary>
      <div className={s.twoCol}>{text('positionPct', 'Position size %')}{text('maxPositions', 'Max positions')}{text('costBps', 'Commission (bps)')}{text('extraSlippageBps', 'Extra slippage (bps)')}{text('initialCash', 'Starting cash ($)')}{text('benchmark', 'Benchmark')}{text('riskFreePct', 'Risk-free rate %')}</div>
    </details>
    <div className={s.formFoot}>
      <button className={s.primary} disabled={busy}>{busy ? 'Working…' : 'Run backtest and checks'}</button>
      {canCancel && <button type="button" className={s.btn} onClick={onCancel}>Close</button>}
    </div>
  </form>;
}

function RunButton({ r, on, names, onPick }: { r: RunSummary; on: boolean; names: Record<string, string>; onPick: () => void }) {
  const c = r.robustnessChecks;
  return <li><button type="button" className={`${s.run} ${on ? s.runOn : ''}`} aria-current={on || undefined} onClick={onPick}>
    <span className={s.runTop}><b>{strategyLabel(r.strategy, names)}</b><span>{pct(r.cagrPct)}</span></span>
    <span className={s.runSub}><span>{universeLabel(r.universe)} · {windowYears(r.settings)} · {savedLabel(r.savedAt)}</span><span className={!c ? s.amber : c.pass ? s.up : s.down}>{checksLabel(c)}</span></span>
  </button></li>;
}

export default function QuantIsland() {
  const open = useStore(quantLab, (x) => x.open), box = useRef<HTMLDivElement>(null);
  useModalFocus(open, closeQuantLab, box);
  const list = useQuery({ queryKey: ['quant-runs'], enabled: open, staleTime: 30_000, ...queryDefaults, queryFn: () => agentApi<RunList>('/quant/runs') });
  const strategies = useQuery({ queryKey: ['quant-strategies'], enabled: open, staleTime: 300_000, ...queryDefaults, queryFn: () => agentApi<{ strategies: Strategy[] }>('/strategies') });
  const [picked, setPicked] = useState(() => read(RUN_KEY) || ''), [tab, setTabState] = useState<Tab>(() => { const t = read(TAB_KEY); return isTab(t) ? t : 'overview'; });
  const [focus, setFocus] = useState<CheckId | null>(null), [filter, setFilter] = useState(''), [formOpen, setFormOpen] = useState(false);
  const select = (id: string) => { setPicked(id); save(RUN_KEY, id); };
  const setTab = (t: Tab) => { setTabState(t); save(TAB_KEY, t); };
  const job = useJob(select);
  const busy = !!job.job;
  const runs = list.data?.runs ?? [];
  const summary = runs.find((r) => r.runId === picked) ?? runs[0] ?? null;
  const selectedId = summary?.runId ?? null;
  const detail = useQuery({ queryKey: ['quant-run', selectedId], enabled: open && !!selectedId, staleTime: 60_000, ...queryDefaults, queryFn: () => agentApi<Run>(`/quant/runs/${selectedId}`) });
  const run = detail.data && detail.data.runId === selectedId ? detail.data : null;
  const names = useMemo(() => Object.fromEntries((strategies.data?.strategies ?? []).map((x) => [x.key, x.name])), [strategies.data]);
  const needle = filter.trim().toLowerCase();
  const shown = needle ? runs.filter((r) => `${strategyLabel(r.strategy, names)} ${r.strategy} ${r.universe.join(' ')}`.toLowerCase().includes(needle)) : runs;
  const tabRefs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});
  const tabKeys = (e: KeyboardEvent) => { const to = nextTab(tab, e.key); if (to) { e.preventDefault(); setTab(to); tabRefs.current[to]?.focus(); } };
  const openCheck = (id: CheckId) => { setFocus(id); setTab('explain'); };
  const showForm = formOpen || (list.isSuccess && runs.length === 0);
  const listError = list.error && !list.data ? message(list.error) : '';
  const showRail = !!run && (tab === 'overview' || tab === 'details');
  const onCheck = () => { if (selectedId) void job.checks(selectedId); };
  return (
    <div ref={box} className={s.lab} hidden={!open} role="dialog" aria-modal="true" aria-labelledby="quant-title" tabIndex={-1}>
      <header className={s.top}>
        <h2 id="quant-title">QUANT LAB</h2>
        <span className={s.topNote}>Backtests on daily prices. Research only, this workspace cannot place orders.</span>
        <button type="button" className={s.btn} onClick={closeQuantLab} aria-label="Close Quant Lab">Close <kbd>Esc</kbd></button>
      </header>

      {job.job && <div className={s.progress} role="status">
        <span className={s.spinner} aria-hidden="true" />
        <span><b>{job.job.steps > 1 ? `Step ${job.job.step} of ${job.job.steps}: ` : ''}{job.job.title}</b> <span className={s.muted}>{job.elapsed}s, usually under a minute</span></span>
        <button type="button" className={s.btn} onClick={job.cancel}>Cancel</button>
      </div>}
      {job.error && <div className={s.alert} role="alert"><span>{job.error}</span><button type="button" className={s.linkBtn} onClick={job.clearError}>Dismiss</button></div>}

      <div className={s.body}>
        <aside className={s.left} aria-label="Saved runs">
          <div className={s.leftHead}>
            <h3>SAVED RUNS {runs.length ? `(${runs.length})` : ''}</h3>
            {runs.length > 0 && !showForm && <button type="button" className={s.primarySmall} onClick={() => setFormOpen(true)}>New backtest</button>}
          </div>
          <div hidden={!showForm}><NewRun strategies={strategies.data?.strategies ?? []} busy={busy} canCancel={runs.length > 0} onCancel={() => setFormOpen(false)} onRun={(b) => void job.backtest(b, () => { setFormOpen(false); setTab('overview'); })} /></div>
          {runs.length > 6 && <input className={s.input} aria-label="Filter saved runs" placeholder="Filter by strategy or ticker" value={filter} onChange={(e) => setFilter(e.target.value)} />}
          {shown.length > 0 && <ul className={s.runs}>{shown.map((r) => <RunButton key={r.runId} r={r} on={r.runId === selectedId} names={names} onPick={() => select(r.runId)} />)}</ul>}
          {needle && !shown.length && <p className={s.emptyLine}>No saved run matches "{filter}".</p>}
        </aside>

        <main className={s.center} aria-label="Run">
          {listError ? <div className={s.empty}><h3>The Lab cannot load</h3><p>{listError}</p><button type="button" className={s.btn} onClick={() => void list.refetch()}>Try again</button></div>
            : list.isLoading ? <p className={s.emptyLine}>Loading saved runs…</p>
              : !summary ? <div className={s.empty}><h3>Test a strategy on history</h3>
                <ol><li>Pick a strategy and a list of US stocks on the left.</li><li>The Lab replays it as one portfolio with cash limits and costs, against a benchmark.</li><li>Six checks then test whether the result holds up. Read the failures next to the return.</li></ol>
                <p className={s.muted}>Results are research on past prices and today's tickers. They are not a forecast.</p></div>
                : <>
                  <div className={s.runHead}>
                    <div><h3>{strategyLabel(summary.strategy, names)} <span className={s.muted}>{summary.strategy.split('@')[1] ? `v${summary.strategy.split('@')[1]}` : ''}</span></h3>
                      <p className={s.muted}>{universeLabel(summary.universe)} · {shortDate(summary.window.start)} to {shortDate(summary.window.end)} · vs {summary.benchmarkSymbol}</p>
                      <div className={s.chips}><span>IN-SAMPLE</span><span title={summary.validation}>NOT OUT-OF-SAMPLE PROOF</span><span title={list.data?.survivorship}>SURVIVORSHIP BIAS</span>{run && <span title={run.label}>{run.status.toUpperCase()}, NOT ACCEPTED</span>}</div></div>
                    <button type="button" className={s.btn} disabled={busy} onClick={onCheck}>{summary.robustnessChecks ? 'Run checks again' : 'Run checks'}</button>
                  </div>
                  <div className={s.tabs} role="tablist" aria-label="Run views" onKeyDown={tabKeys}>
                    {TABS.map(([id, label]) => <button key={id} ref={(el) => { tabRefs.current[id] = el; }} type="button" role="tab" id={`quant-tab-${id}`} aria-selected={tab === id} aria-controls="quant-panel" tabIndex={tab === id ? 0 : -1} className={tab === id ? s.tabOn : ''} onClick={() => setTab(id)}>{label}</button>)}
                  </div>
                  <div id="quant-panel" role="tabpanel" aria-labelledby={`quant-tab-${tab}`} className={s.panel}>
                    {detail.error && !run ? <div className={s.empty}><h3>This run cannot be opened</h3><p>{message(detail.error)}</p></div>
                      : !run ? <p className={s.emptyLine}>Loading run…</p>
                        : tab === 'overview' ? <Overview run={run} onCheck={onCheck} busy={busy} />
                          : tab === 'evidence' ? <Evidence run={run} onCheck={onCheck} busy={busy} />
                            : tab === 'compare' ? <Compare runs={runs} selected={summary} names={names} onSelect={select} onCheck={(id) => void job.checks(id)} busy={busy} />
                              : tab === 'explain' ? <Explain run={run} focus={focus} onCheck={onCheck} busy={busy} />
                                : <Details run={run} busy={busy} reproduced={job.reproduced} onReproduce={() => void job.reproduce(run.runId)} />}
                  </div>
                </>}
        </main>

        {showRail && <aside className={s.right} aria-label="Checks"><CheckRail run={run} onOpen={openCheck} onCheck={onCheck} busy={busy} /></aside>}
      </div>
    </div>
  );
}
