import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { Assessment } from '../../../../agent/src/chat/council-contract.ts';
import { CouncilActivity } from './CouncilActivity.tsx';
import { CouncilChain } from './CouncilChain.tsx';
import { councilModel, councilView, setCouncilView, STAGES, STATE_LABEL, type CouncilPart, type CouncilView, type RoleView } from './council.ts';
import { Icon } from './icons.tsx';
import styles from './Council.module.css';
export { councilState, type CouncilPart } from './council.ts';

// FEAT-009 §6.2: the council as cards (default) or, on the full page, as a
// chain of thought. Everything shown comes from run status and the validated
// Assessment; UNPEEK blanks every finding (councilModel).
function CouncilOrb({ role, active }: { role: string; active: boolean }) {
  return <span className={styles.orb} data-orb={role} data-active={active} aria-hidden="true">
    <span className={styles.orbAura} />
    <span className={styles.orbGimbal}><i /><i /><i /></span>
    <span className={styles.orbCore}><span /></span>
    <span className={styles.orbSatellite}><i /></span>
    <span className={styles.orbReticle} />
  </span>;
}
function CouncilFlow({ v }: { v: CouncilView }) {
  const paths = ['M100 0 C100 48 300 25 300 82', 'M300 0 V82', 'M500 0 C500 48 300 25 300 82'];
  const chairActive = v.chair.state === 'running';
  return <svg className={styles.flow} data-active={chairActive || v.working} viewBox="0 0 600 84" preserveAspectRatio="none" aria-hidden="true">{v.roles.map((role, i) => {
    const active = chairActive || role.state === 'running';
    return <g key={role.id} data-flow={role.id} data-active={active}><path className={styles.flowTrack} d={paths[i]} /><path className={styles.flowLight} d={paths[i]} /><circle className={styles.flowNode} cx={[100,300,500][i]} cy="1" r="3" /></g>;
  })}<path className={styles.mobileFlow} d="M300 0 V82" /><circle className={styles.flowHub} cx="300" cy="82" r="4" /></svg>;
}
const list = (title: string, items: string[]) => items.length > 0 && <div className={styles.more}><h5>{title}</h5><ul>{items.map((x) => <li key={x}>{x}</li>)}</ul></div>;
function Card({ r, open, onToggle, hidden }: { r: RoleView; open: boolean; onToggle: () => void; hidden: boolean }) {
  const excerpt = r.claim || (hidden && r.runs.some((x) => x.status === 'completed') ? 'Findings hidden' : r.phaseNote);
  return <button type="button" data-role={r.id} data-state={r.state} className={styles.card + (open ? ' ' + styles.selected : '')} aria-label={'Inspect ' + r.label} aria-expanded={open} disabled={!r.runs.length} onClick={onToggle}>
    <span className={styles.cardTop}><CouncilOrb role={r.id} active={r.state === 'running'} /><span className={styles.state}><i />{STATE_LABEL[r.state]}</span></span>
    <span className={styles.cardName}><span className={styles.roleEyebrow}>{`SPECIALIST 0${r.index + 1}`}</span><strong>{r.short}</strong><span>{r.focus}</span></span>
    <span className={styles.phaseNote}>{r.phaseNote}</span>
    <span className={styles.excerpt}>{excerpt}</span>
    {(r.evidence != null || r.uncertainty) && <span className={styles.chips}>
      {r.evidence != null && <span className={styles.chip}>EVIDENCE <b>{r.evidence}</b></span>}
      {r.against != null && <span className={styles.chip}>AGAINST <b>{r.against}</b></span>}
      {r.uncertainty && <span className={styles.chip + ' ' + styles.chipWide}>UNCERTAINTY <span>{r.uncertainty}</span></span>}
    </span>}
    {open && <span className={styles.moreGrid}>
      {list('Assumes', r.assumptions)}{list('Opposing evidence', r.counter)}{list('Still needed', r.missing)}
      {r.challengeClaim && <div className={styles.more}><h5>Challenge round</h5><p>{r.challengeClaim}</p></div>}
      <div className={styles.more}><h5>Runs</h5><ul>{r.runs.map((x) => <li key={x.key}>{`${x.phase} · ${x.status} · ${x.model}${x.ms ? ` · ${(x.ms / 1000).toFixed(1)}s` : ''}${x.costUsd != null ? ` · $${x.costUsd.toFixed(4)}` : ''}`}</li>)}</ul></div>
    </span>}
    <span className={styles.cardFoot}>{r.flagCount ? <span className={styles.figureFlag} data-figure-flag>Figures unverified ({r.flagCount})</span> : r.invalidation ? <span className={styles.change}>Would change if: {r.invalidation}</span> : r.challenged ? 'Challenge round' : 'Independent assessment'}<span aria-hidden="true">{open ? '▾' : '▸'}</span></span>
  </button>;
}
function Chair({ v, open, onToggle }: { v: CouncilView; open: boolean; onToggle: () => void }) {
  const c = v.chair;
  return <button type="button" className={styles.chair + (open ? ' ' + styles.selected : '')} data-state={c.state} aria-label="Inspect Kestrel Chair" aria-expanded={open} disabled={!c.runs.length} onClick={onToggle}>
    <CouncilOrb role="chair" active={c.state === 'running'} />
    <span className={styles.chairCopy}><strong>Kestrel Chair</strong><span>{c.waiting}</span>
      {c.state === 'running' && <span className={styles.shimmer} aria-hidden="true"><i /><i /></span>}
      {c.flagCount > 0 && <span className={styles.figureFlag} data-figure-flag>Figures unverified ({c.flagCount})</span>}
      {c.lead && <span className={styles.chairLead}>{c.lead}</span>}
      {c.state === 'completed' && !v.hidden && <span className={styles.chairTiles}>
        <span><b>{c.missing.length}</b> still needed</span><span><b>{c.changes.length}</b> would change the view</span><span><b>{c.questions.length}</b> open question{c.questions.length === 1 ? '' : 's'}</span>
      </span>}
    </span>
    <span className={styles.state}><i />{STATE_LABEL[c.state]}</span>
  </button>;
}

export function CouncilBoard({ runs, finished, full = false, onAsk }: { runs: CouncilPart[]; finished: boolean; full?: boolean; onAsk?: (q: string) => void }) {
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
  const saved = useStore(councilView, (s) => s.view);
  const view = full ? saved : 'cards';
  const v = councilModel(runs, finished, peek);
  const selectedRuns = selected === 'chair' ? v.chair.runs : v.roles.find((r) => r.id === selected)?.runs ?? [];
  const toggle = (id: string) => setSelected(selected === id ? null : id);
  return <section ref={boardRef} className={styles.board} data-visible={motionVisible} data-active={v.working} data-view={view} aria-label="Investment council" data-council-board>
    <header className={styles.head}>
      <div className={styles.emblem}><Icon name="spark" size={19} /></div>
      <div className={styles.heading}><span className={styles.eyebrow}>INVESTMENT COUNCIL</span><h3>{v.title}{v.working && <span className={styles.signal} aria-hidden="true"><i /><i /><i /><i /></span>}</h3></div>
      {full && <span className={styles.switch} role="group" aria-label="Council view (⌘.)">
        <button type="button" aria-pressed={view === 'cards'} onClick={() => setCouncilView('cards')}>◫ Cards</button>
        <button type="button" aria-pressed={view === 'chain'} onClick={() => setCouncilView('chain')}>≡ Chain of thought</button>
      </span>}
      <button type="button" className={styles.collapse} aria-label={expanded ? 'Collapse council activity' : 'Expand council activity'} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? '−' : '+'}</button>
    </header>
    <div className={styles.steps} aria-label="Review stages">{STAGES.map((step, i) => <span key={step} className={i === v.stage ? styles.current : v.stageDone[i] ? styles.past : ''} aria-current={i === v.stage ? 'step' : undefined}><i>{v.stageDone[i] ? '✓' : '0' + (i + 1)}</i>{step}</span>)}</div>
    {expanded && view === 'chain' && <CouncilChain v={v} onAsk={onAsk} />}
    {expanded && view === 'cards' && <>
      <div className={styles.team} data-open={selected && selected !== 'chair' ? selected : undefined}>{v.roles.map((r) => <Card key={r.id} r={r} hidden={v.hidden} open={selected === r.id} onToggle={() => toggle(r.id)} />)}</div>
      <CouncilFlow v={v} />
      <Chair v={v} open={selected === 'chair'} onToggle={() => toggle('chair')} />
      {selected && <div className={styles.inspector} aria-label="Specialist findings">{selectedRuns.map((run) => <CouncilActivity key={run.key} run={run} />)}</div>}
    </>}
    {expanded && <footer className={styles.foot}><span><i className={v.working ? styles.liveDot : styles.idleDot} />{v.working ? `Live · ${v.activeLabel}` : '3 specialists · 1 chair'}</span><span>{v.cost === null ? finished ? 'Cost unavailable' : 'Cost pending' : '$' + v.cost.toFixed(4) + ' recorded'}</span>
      {!full && <button type="button" className={styles.sideBySide} onClick={() => { setCouncilView('chain'); window.dispatchEvent(new Event('kestrel:full')); }}>See every lens side by side ⤢</button>}</footer>}
  </section>;
}

export function CouncilConclusion({ children, runs = [] }: { children: ReactNode; runs?: CouncilPart[] }) {
  const peek = useStore(window.FinSight.store, (s) => s.peek);
  const chair = [...runs].reverse().find((run) => run.role === 'chair' && run.status === 'completed');
  let assessment: ReturnType<typeof Assessment.parse> | null = null;
  if (chair && peek) try { const parsed = Assessment.safeParse(JSON.parse(chair.detail)); if (parsed.success) assessment = parsed.data; } catch { /* legacy or incomplete result */ }
  const partial = runs.some((run) => run.status === 'failed' || run.status === 'stopped');
  // The chair's own unresolved figure checks; specialists' show on their cards.
  const flags = chair?.flags ?? [];
  const gaps = [...new Set(assessment?.findings.flatMap((finding) => finding.missingEvidence) || [])];
  const changes = [...new Set(assessment?.findings.map((finding) => finding.invalidation) || [])];
  return <section className={styles.conclusion} data-council-result>
    <div className={styles.resultLabel}><Icon name="spark" size={14} /> {partial ? 'Partial chair synthesis' : 'Chair synthesis'}</div>
    {!!flags.length && <div className={styles.figureCheck} role="note" data-figure-check><strong>Figure check: {flags.length} unverified</strong>{peek ? <ul>{flags.map((f) => <li key={f}>{f}</li>)}</ul> : <span> Details hidden by UNPEEK.</span>}</div>}
    {!peek ? <p className={styles.resultMuted}>Council findings hidden by UNPEEK.</p> : assessment?.findings.length ? <>
      {assessment.findings.map((finding, index) => <div key={index} className={styles.resultFinding}><p className={index === 0 ? styles.resultLead : styles.resultClaim}>{finding.claim}</p><p className={styles.resultMuted}>{finding.uncertainty}</p></div>)}
      <div className={styles.resultColumns}>{gaps.length > 0 && <div><h4>Still needed</h4><ul>{gaps.map((gap) => <li key={gap}>{gap}</li>)}</ul></div>}{changes.length > 0 && <div><h4>What changes the view</h4><ul>{changes.map((change) => <li key={change}>{change}</li>)}</ul></div>}</div>
      <details className={styles.fullReport}><summary>Full report & source references</summary>{children}</details>
    </> : children}
  </section>;
}
