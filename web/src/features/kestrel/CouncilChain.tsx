import { useState } from 'react';
import type { CouncilView, RoleView } from './council.ts';
import { STAGES } from './council.ts';
import styles from './Council.module.css';

// FEAT-009 §6.3: four lanes (three specialists and the Chair) built from real
// run steps in arrival order. Text appears when a run completes; nothing types.
const ICON = { assess: '◇', claim: '→', challenge: '↯', gap: '✕' } as const;
function Lane({ r, focused, dim, onFocus, cited }: { r: RoleView; focused: boolean; dim: boolean; onFocus: () => void; cited: Set<string> }) {
  const steps = dim ? r.steps.slice(-2) : r.steps;
  const hidden = r.steps.length - steps.length;
  const status = r.state === 'running' ? r.phaseNote : r.state === 'completed' ? `Finished in ${(r.ms / 1000).toFixed(1)}s${r.evidence != null ? ` · ${r.evidence} evidence` : ''}` : r.phaseNote;
  return (
    <section className={styles.lane + (focused ? ' ' + styles.laneFocus : '') + (dim ? ' ' + styles.laneDim : '')} data-role={r.id} data-state={r.state} aria-label={r.label + ' lane'}>
      <button type="button" className={styles.laneHead} aria-pressed={focused} onClick={onFocus} title={focused ? 'Show every lane' : 'Focus this lane'}>
        <i className={styles.laneDot} aria-hidden="true" /><strong>{r.label}</strong>
        <span className={styles.laneLive} aria-hidden="true">{r.state === 'running' ? <i className="kx-spin" /> : r.state === 'completed' ? '✓' : r.state === 'failed' || r.state === 'stopped' ? '✕' : '○'}</span>
        <span className={styles.laneStatus}>{status}</span>
      </button>
      {r.flagCount > 0 && <div className={styles.figureCheck} data-figure-check><strong>Figure check: {r.flagCount} unverified</strong>{r.flags.length > 0 && <ul>{r.flags.map((f, i) => <li key={i}>{f}</li>)}</ul>}</div>}
      <ol className={styles.laneSteps}>
        {hidden > 0 && <li className={styles.laneMore}>{`+ ${hidden} earlier step${hidden === 1 ? '' : 's'}`}</li>}
        {steps.map((s) => {
          const isCited = s.evidence.some((e) => cited.has(e));
          return (
            <li key={s.key} className={styles.step} data-kind={s.kind} data-running={s.running} data-cited={isCited}>
              <span className={styles.stepTag}>{ICON[s.kind]} {s.label}{s.tag && <b>{s.tag}</b>}</span>
              <span className={styles.stepText}>{s.text}</span>
              {s.evidence.length > 0 && <span className={styles.stepEvidence}>{s.evidence.map((e) => <code key={e}>{e}</code>)}{isCited && <em>◆ chair cited</em>}</span>}
            </li>
          );
        })}
        {!steps.length && <li className={styles.step} data-kind="assess"><span className={styles.stepText}>{r.phaseNote}</span></li>}
      </ol>
    </section>
  );
}

export function CouncilChain({ v, onAsk }: { v: CouncilView; onAsk?: (q: string) => void }) {
  const [focus, setFocus] = useState<string | null>(null);
  const cited = new Set(v.chair.evidence);
  const ledger = v.hidden ? [] : v.roles.flatMap((r) => r.steps.filter((s) => s.kind === 'challenge' && !s.running && s.text && s.text !== 'Findings hidden').map((s) => ({ role: r.id, key: s.key, text: s.text })));
  const question = v.chair.questions[0];
  const pct = Math.round((v.done / v.total) * 100);
  return (
    <div className={styles.chain} data-focus={focus ?? undefined}>
      <div className={styles.lanes}>
        {v.roles.map((r) => <Lane key={r.id} r={r} focused={focus === r.id} dim={!!focus && focus !== r.id} cited={cited} onFocus={() => setFocus(focus === r.id ? null : r.id)} />)}
        <section className={styles.lane + ' ' + styles.chairLane} data-role="chair" data-state={v.chair.state} aria-label="Kestrel Chair lane">
          <div className={styles.laneHead}><i className={styles.laneDot} aria-hidden="true" /><strong>Kestrel Chair</strong>
            <span className={styles.laneLive} aria-hidden="true">{v.chair.state === 'running' ? <i className="kx-spin" /> : v.chair.state === 'completed' ? '✓' : v.chair.state === 'failed' || v.chair.state === 'stopped' ? '✕' : '○'}</span>
            <span className={styles.laneStatus}>{v.chair.waiting}</span></div>
          {v.chair.flagCount > 0 && <div className={styles.figureCheck} data-figure-check><strong>Figure check: {v.chair.flagCount} unverified</strong>{v.chair.flags.length > 0 && <ul>{v.chair.flags.map((f, i) => <li key={i}>{f}</li>)}</ul>}</div>}
          <div className={styles.chairBlock}><h4>Ledger</h4>
            {ledger.length ? <ul className={styles.ledger}>{ledger.map((l) => <li key={l.key} data-role={l.role}><i aria-hidden="true" />{l.text}</li>)}</ul>
              : <p className={styles.muted}>{v.hidden ? 'Findings hidden by UNPEEK.' : 'Challenge-round claims collect here.'}</p>}</div>
          <div className={styles.chairBlock}><h4>Draft ruling</h4>
            {v.chair.lead ? <p className={styles.ruling}>{v.chair.lead}</p>
              : v.hidden && v.chair.state === 'completed' ? <p className={styles.muted}>Findings hidden by UNPEEK.</p>
              : v.chair.error ? <p className={styles.chairError} role="note">{v.chair.error}</p>
              : v.chair.state === 'running' || v.chair.state === 'queued' ? <div className={styles.shimmer} aria-hidden="true"><i /><i /></div>
              : <p className={styles.muted}>No ruling was produced.</p>}</div>
          {question && <div className={styles.chairAsk}><h4>The Chair needs one answer from you</h4><p>{question}</p>
            {onAsk && <button type="button" onClick={() => onAsk(question)}>Answer in the composer</button>}</div>}
        </section>
      </div>
      <div className={styles.rounds} aria-label="Rounds">
        {STAGES.map((s, i) => <span key={s} data-done={v.stageDone[i]} data-current={i === v.stage}>{`0${i + 1} ${s}`}</span>)}
        <span className={styles.progress} role="progressbar" aria-label="Council progress" aria-valuemin={0} aria-valuemax={v.total} aria-valuenow={v.done}><i style={{ width: pct + '%' }} /></span>
      </div>
    </div>
  );
}
