// Standalone, synthetic applicable-state wrapper. Never imported by production.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createStore } from 'zustand/vanilla';
import { CouncilBoard, CouncilConclusion, type CouncilPart } from './CouncilBoard.tsx';
Object.assign(window, { FinSight: { store: createStore(() => ({ peek: true })) } });
const findings = { growth: 'The growth case depends on durable demand, not the headline alone.', macro: 'Current valuation inputs are missing; a price target is not supported.', risk: 'Overlap with existing exposure needs a closer look before adding.', chair: 'Wait for the missing evidence before making an allocation decision.' };
function run(role: keyof typeof findings, phase: string, status: string): CouncilPart {
 return { kind: 'council', key: role + phase, role, phase, status, model: 'deepseek-flash / DeepSeek Flash', costUsd: status === 'completed' ? 0.0012 : null, ms: status === 'completed' ? 2340 : 0,
 detail: status === 'completed' ? JSON.stringify({ findings: [{ claim: findings[role], evidenceIds: ['e1'], assumptions: [], uncertainty: 'Evidence is incomplete', counterevidence: [], invalidation: 'New primary evidence', missingEvidence: ['Current valuation inputs'] }], unresolvedQuestions: ['What would change the decision?'] }) : status === 'failed' ? 'Synthetic unavailable-source example.' : '' };
}
export default function CouncilPreview() {
 const [state, setState] = useState('Assessing');
 const roles = ['growth', 'macro', 'risk'] as const;
 const runs = state === 'Assessing' ? [run('growth', 'assessment', 'running'), run('macro', 'assessment', 'running')] : [
 ...roles.map((r) => run(r, 'assessment', state === 'Partial' && r === 'macro' ? 'failed' : 'completed')),
 ...(state === 'Challenge' || state === 'Synthesis' || state === 'Complete' || state === 'Partial' ? roles.map((r) => run(r, 'challenge', state === 'Challenge' && r === 'risk' ? 'running' : 'completed')) : []),
 ...(state === 'Synthesis' || state === 'Complete' || state === 'Partial' ? [run('chair', 'synthesis', state === 'Synthesis' ? 'running' : 'completed')] : [])];
 const finished = state === 'Complete' || state === 'Partial';
 return <main style={{ maxWidth: 800, margin: '0 auto', padding: '44px 20px', fontFamily: '-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif' }}>
 <div style={{ color: 'var(--dim)', fontSize: 11, letterSpacing: 2, marginBottom: 12 }}>FINSIGHT / DESIGN PREVIEW</div><h1 style={{ fontSize: 28, color: 'var(--text)', letterSpacing: -1, margin: '0 0 10px' }}>A council inside your conversation.</h1><p style={{ color: 'var(--dim)', fontSize: 13, lineHeight: 1.7 }}>Synthetic display states. Click a specialist to inspect its findings.</p>
 <nav aria-label="Preview states" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '22px 0' }}>{['Assessing','Challenge','Synthesis','Complete','Partial'].map((s) => <button key={s} onClick={() => setState(s)} aria-pressed={s === state} style={{ padding: '9px 14px', borderRadius: 8, background: s === state ? 'var(--tint)' : 'var(--panel)', color: s === state ? 'var(--amber-2)' : 'var(--text)', border: '1px solid var(--border-2)', cursor: 'pointer' }}>{s}</button>)}</nav>
 <CouncilBoard runs={runs} finished={finished} />{finished && <CouncilConclusion runs={runs}><h2 style={{ color: 'var(--text)', fontSize: 20, margin: '0 0 10px' }}>Keep the decision open until the evidence improves.</h2><p style={{ color: 'var(--dim)', fontSize: 14, lineHeight: 1.8 }}>The council surfaced a valuation gap and overlapping exposure. Those findings support a request for more evidence rather than a new allocation. This is illustrative copy for the visual preview.</p></CouncilConclusion>}
 </main>;
}
if (document.getElementById('root')) createRoot(document.getElementById('root')!).render(<CouncilPreview />);
