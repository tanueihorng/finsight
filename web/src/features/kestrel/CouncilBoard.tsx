import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { Assessment } from '../../../../agent/src/chat/council-contract.ts';
import type { Part } from './turns.ts';
import { CouncilActivity } from './CouncilActivity.tsx';
import { Icon } from './icons.tsx';
import styles from './Council.module.css';
export type CouncilPart = Extract<Part, { kind: 'council' }>;
const roles = [
  { id: 'growth', label: 'Business & Growth', short: 'Business', focus: 'Quality & growth' },
  { id: 'macro', label: 'Macro & Valuation', short: 'Macro', focus: 'Value & economic forces' },
  { id: 'risk', label: 'Portfolio Risk', short: 'Risk', focus: 'Exposure & downside' },
];
function firstClaim(runs: CouncilPart[]) {
  for (const run of [...runs].reverse()) {
    try { const result = Assessment.safeParse(JSON.parse(run.detail)); if (result.success && result.data.findings[0]) return result.data.findings[0].claim; } catch { /* not findings */ }
  }
  return '';
}
export function councilState(runs: CouncilPart[], finished: boolean) {
  if (runs.some((r) => r.status === 'running')) return 'running';
  if (runs.some((r) => r.status === 'failed')) return 'failed';
  if (runs.some((r) => r.status === 'stopped')) return 'stopped';
  if (runs.length && runs.every((r) => r.status === 'completed')) return 'completed';
  return finished ? 'not-run' : 'queued';
}
const statusLabel: Record<string, string> = { running: 'Working', completed: 'Ready', failed: 'Failed', stopped: 'Stopped', queued: 'Queued', 'not-run': 'Not run' };
function CouncilOrb({ role, active }: { role: string; active: boolean }) {
  return <span className={styles.orb} data-orb={role} data-active={active} aria-hidden="true">
    <span className={styles.orbAura} />
    <span className={styles.orbGimbal}><i /><i /><i /></span>
    <span className={styles.orbCore}><span /></span>
    <span className={styles.orbSatellite}><i /></span>
    <span className={styles.orbReticle} />
  </span>;
}
function CouncilFlow({ runs, chairActive }: { runs: CouncilPart[]; chairActive: boolean }) {
  const paths = ['M100 0 C100 48 300 25 300 82', 'M300 0 V82', 'M500 0 C500 48 300 25 300 82'];
  return <svg className={styles.flow} data-active={chairActive || runs.some((r) => r.status === 'running')} viewBox="0 0 600 84" preserveAspectRatio="none" aria-hidden="true">{roles.map((role, i) => {
    const active = chairActive || runs.some((r) => r.role === role.id && r.status === 'running');
    return <g key={role.id} data-flow={role.id} data-active={active}><path className={styles.flowTrack} d={paths[i]} /><path className={styles.flowLight} d={paths[i]} /><circle className={styles.flowNode} cx={[100,300,500][i]} cy="1" r="3" /></g>;
  })}<path className={styles.mobileFlow} d="M300 0 V82" /><circle className={styles.flowHub} cx="300" cy="82" r="4" /></svg>;
}
export function CouncilBoard({ runs, finished }: { runs: CouncilPart[]; finished: boolean }) {
  const boardRef = useRef<HTMLElement>(null);
  const [motionVisible, setMotionVisible] = useState(true);
  useEffect(() => {
    let intersects = true;
    const update = () => setMotionVisible(intersects && !document.hidden);
    const observer = new IntersectionObserver(([entry]) => { intersects = !!entry?.isIntersecting; update(); });
    if (boardRef.current) observer.observe(boardRef.current);
    document.addEventListener('visibilitychange', update); update();
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange', update); };
  }, []);
  const [selected, setSelected] = useState<string | null>(null), [expanded, setExpanded] = useState(true);
  const peek = useStore(window.FinSight.store, (s) => s.peek);
  const phase = runs.some((r) => r.role === 'chair') ? 2 : runs.some((r) => r.phase === 'challenge') ? 1 : 0;
  const working = runs.some((r) => r.status === 'running');
  const failed = runs.some((r) => r.status === 'failed' || r.status === 'stopped');
  const incomplete = failed || !['assessment','challenge'].every((phase) => roles.every((role) => runs.some((r) => r.role === role.id && r.phase === phase))) || !runs.some((r) => r.role === 'chair');
  const stageDone = (index: number) => index === 2 ? runs.some((r) => r.role === 'chair' && r.status === 'completed') : roles.every((role) => runs.some((r) => r.role === role.id && r.phase === (index === 0 ? 'assessment' : 'challenge') && r.status === 'completed'));
  const title = finished ? incomplete ? 'Review ended with gaps' : 'Review complete' : working ? 'Council in session' : 'Preparing the next stage';
  const knownCost = runs.every((r) => r.costUsd !== null) ? runs.reduce((sum, r) => sum + r.costUsd!, 0) : null;
  const chair = runs.filter((r) => r.role === 'chair');
  const chairState = councilState(chair, finished);
  const selectedRuns = runs.filter((r) => r.role === selected);
  return <section ref={boardRef} className={styles.board} data-visible={motionVisible} data-active={working} aria-label="Investment council" data-council-board>
    <header className={styles.head}>
      <div className={styles.emblem}><Icon name="spark" size={19} /></div>
      <div className={styles.heading}><span className={styles.eyebrow}>INVESTMENT COUNCIL</span><h3>{title}{working && <span className={styles.signal} aria-hidden="true"><i /><i /><i /><i /></span>}</h3></div>
      <button type="button" className={styles.collapse} aria-label={expanded ? 'Collapse council activity' : 'Expand council activity'} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? '−' : '+'}</button>
    </header>
    <div className={styles.steps} aria-label="Review stages">{['Assess', 'Challenge', 'Synthesize'].map((step, i) => <span key={step} className={i === phase ? styles.current : stageDone(i) ? styles.past : ''} aria-current={i === phase ? 'step' : undefined}><i>{stageDone(i) ? '✓' : '0' + (i + 1)}</i>{step}</span>)}</div>
    {expanded && <>
      <div className={styles.team}>{roles.map((role) => {
        const ownRuns = runs.filter((r) => r.role === role.id);
        const state = councilState(ownRuns, finished);
        const challenged = ownRuns.some((r) => r.phase === 'challenge');
        const claim = peek ? firstClaim(ownRuns) : '';
        return <button type="button" key={role.id} data-role={role.id} data-state={state} className={styles.card + (selected === role.id ? ' ' + styles.selected : '')} aria-label={'Inspect ' + role.label} aria-expanded={selected === role.id} disabled={!ownRuns.length} onClick={() => setSelected(selected === role.id ? null : role.id)}>
          <span className={styles.cardTop}><CouncilOrb role={role.id} active={state === 'running'} /><span className={styles.state}><i />{statusLabel[state]}{state === 'running' && ownRuns.some((r) => r.status === 'failed') ? ' · gap' : ''}</span></span>
          <span className={styles.cardName}><strong>{role.short}</strong><span>{role.focus}</span></span>
          <span className={styles.excerpt}>{claim || (!peek && ownRuns.length ? 'Findings hidden' : state === 'queued' ? 'Waiting for a research slot' : state === 'running' ? challenged ? 'Testing the other assessments' : 'Forming an independent assessment' : state === 'failed' ? 'Inspect the missing assessment' : state === 'stopped' ? 'Review interrupted' : 'Assessment available')}</span>
          <span className={styles.cardFoot}>{challenged ? 'Challenge round' : 'Independent assessment'}<span aria-hidden="true">↗</span></span>
        </button>;
      })}</div>
      <CouncilFlow runs={runs} chairActive={chairState === 'running'} />
      <button type="button" className={styles.chair + (selected === 'chair' ? ' ' + styles.selected : '')} data-state={chairState} aria-label="Inspect Kestrel Chair" aria-expanded={selected === 'chair'} disabled={!chair.length} onClick={() => setSelected(selected === 'chair' ? null : 'chair')}>
        <CouncilOrb role="chair" active={chairState === 'running'} /><span className={styles.chairCopy}><strong>Kestrel Chair</strong><span>{chairState === 'running' ? 'Weighing the evidence and unresolved views' : chairState === 'completed' ? 'Synthesis ready · evidence over votes' : chairState === 'failed' || chairState === 'stopped' ? 'Synthesis incomplete · inspect the result' : finished ? 'Synthesis did not run' : 'Receives all assessments and challenges'}</span></span><span className={styles.state}><i />{statusLabel[chairState]}</span>
      </button>
      {selected && <div className={styles.inspector} aria-label="Specialist findings">{selectedRuns.map((run) => <CouncilActivity key={run.key} run={run} />)}</div>}
      <footer className={styles.foot}><span><i className={working ? styles.liveDot : styles.idleDot} />{working ? 'Live specialist activity' : '3 specialists · 1 chair'}</span><span>{knownCost === null ? finished ? 'Cost unavailable' : 'Cost pending' : '$' + knownCost.toFixed(4) + ' recorded'}</span></footer>
    </>}
  </section>;
}

export function CouncilConclusion({ children, runs = [] }: { children: ReactNode; runs?: CouncilPart[] }) {
  const peek = useStore(window.FinSight.store, (s) => s.peek);
  const chair = [...runs].reverse().find((run) => run.role === 'chair' && run.status === 'completed');
  let assessment: ReturnType<typeof Assessment.parse> | null = null;
  if (chair && peek) try { const parsed = Assessment.safeParse(JSON.parse(chair.detail)); if (parsed.success) assessment = parsed.data; } catch { /* legacy or incomplete result */ }
  const partial = runs.some((run) => run.status === 'failed' || run.status === 'stopped');
  const gaps = [...new Set(assessment?.findings.flatMap((finding) => finding.missingEvidence) || [])];
  const changes = [...new Set(assessment?.findings.map((finding) => finding.invalidation) || [])];
  return <section className={styles.conclusion} data-council-result>
    <div className={styles.resultLabel}><Icon name="spark" size={14} /> {partial ? 'Partial chair synthesis' : 'Chair synthesis'}</div>
    {!peek ? <p className={styles.resultMuted}>Council findings hidden by UNPEEK.</p> : assessment?.findings.length ? <>
      {assessment.findings.map((finding, index) => <div key={index} className={styles.resultFinding}><p className={index === 0 ? styles.resultLead : styles.resultClaim}>{finding.claim}</p><p className={styles.resultMuted}>{finding.uncertainty}</p></div>)}
      <div className={styles.resultColumns}>{gaps.length > 0 && <div><h4>Still needed</h4><ul>{gaps.map((gap) => <li key={gap}>{gap}</li>)}</ul></div>}{changes.length > 0 && <div><h4>What changes the view</h4><ul>{changes.map((change) => <li key={change}>{change}</li>)}</ul></div>}</div>
      <details className={styles.fullReport}><summary>Full report & source references</summary>{children}</details>
    </> : children}
  </section>;
}
