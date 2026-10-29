import { useStore } from 'zustand';
import { Assessment } from '../../../../agent/src/chat/council-contract.ts';
import type { Part } from './turns.ts';

const labels: Record<string, string> = { growth: 'Business & Growth', macro: 'Macro & Valuation', risk: 'Portfolio Risk', chair: 'Kestrel Chair' };
function parseFindings(raw: string) {
  try { const result = Assessment.safeParse(JSON.parse(raw)); return result.success ? result.data : null; }
  catch { return null; }
}
export function CouncilActivity({ run }: { run: Extract<Part, { kind: 'council' }> }) {
  const peek = useStore(window.FinSight.store, (s) => s.peek);
  const assessment = peek ? parseFindings(run.detail) : null;
  return <details className="agent-notice">
    <summary>{labels[run.role]} · {run.phase} · {run.status}</summary>
    <div>{run.model} · {run.ms}ms · {run.costUsd === null ? 'Cost unavailable' : '$' + run.costUsd.toFixed(6)}</div>
    {!!run.flags.length && <p data-figure-flags>{peek ? <>Figure check, unverified: {run.flags.join('; ')}</> : `Figure check: ${run.flags.length} unverified figure${run.flags.length === 1 ? '' : 's'}`}</p>}
    {!peek ? <p>Findings hidden by UNPEEK.</p> : assessment ? <>
      {assessment.findings.map((finding, index) => <section key={index}>
        <p><strong>{finding.claim}</strong></p>
        <p>Evidence: {finding.evidenceIds.join(', ')}</p>
        <p>Uncertainty: {finding.uncertainty}</p>
        {!!finding.assumptions.length && <p>Assumptions: {finding.assumptions.join('; ')}</p>}
        {!!finding.counterevidence.length && <p>Opposing evidence: {finding.counterevidence.join('; ')}</p>}
        <p>Would change with: {finding.invalidation}</p>
        {!!finding.missingEvidence.length && <p>Missing evidence: {finding.missingEvidence.join('; ')}</p>}
      </section>)}
      {!!assessment.unresolvedQuestions.length && <p>Unresolved: {assessment.unresolvedQuestions.join('; ')}</p>}
    </> : run.detail ? <p>{run.status === 'completed' ? 'Findings unavailable in a supported format.' : run.detail}</p> : null}
  </details>;
}
