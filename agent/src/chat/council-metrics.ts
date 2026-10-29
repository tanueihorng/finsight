// Deterministic checks on figures in council claims (FR-1.5). A percentage in a
// claim must appear in the evidence that claim cites, and one claim must not mix
// weights or totals from different denominators (securities vs securities plus
// cash). No model judgement is involved; issues trigger the existing repair turn.
import type { Assessment } from './council-contract.ts';

type Basis = 'securities' | 'securities_plus_cash';
type Labelled = { value: number; basis: Basis | null; kind: 'weight' | 'denominator' };
type Facts = { numbers: number[]; labelled: Labelled[] };

const BASIS_KEYS: Record<string, Basis> = { securitiesPct: 'securities', weightInclCashPct: 'securities_plus_cash' };
const isBasis = (v: unknown): v is Basis => v === 'securities' || v === 'securities_plus_cash';

/** Collect every number in a tool result, and the weights and denominators whose basis it names. */
export function evidenceFacts(content: string): Facts {
  const facts: Facts = { numbers: [], labelled: [] };
  let root: unknown;
  try { root = JSON.parse(content); } catch { return facts; }
  const walk = (node: unknown, basis: Basis | null) => {
    if (typeof node === 'number' && Number.isFinite(node)) { facts.numbers.push(node); return; }
    if (typeof node === 'string') { const n = Number(node); if (node.trim() && Number.isFinite(n)) facts.numbers.push(n); return; }
    if (Array.isArray(node)) { for (const x of node) walk(x, basis); return; }
    if (!node || typeof node !== 'object') return;
    const o = node as Record<string, unknown>;
    // Evidence wrappers carry the tool result as a JSON string.
    if (typeof o.content === 'string' && /^\s*[[{]/.test(o.content)) { const inner = evidenceFacts(o.content); facts.numbers.push(...inner.numbers); facts.labelled.push(...inner.labelled); }
    const own = isBasis(o.weightBasis) ? o.weightBasis : basis;
    if (isBasis(o.scope) && typeof o.value === 'number') facts.labelled.push({ value: o.value, basis: o.scope, kind: 'denominator' });
    for (const [k, v] of Object.entries(o)) {
      if (typeof v === 'number' && Number.isFinite(v)) {
        if (k in BASIS_KEYS) facts.labelled.push({ value: v, basis: BASIS_KEYS[k]!, kind: 'weight' });
        else if (k === 'weightPct') facts.labelled.push({ value: v, basis: own, kind: 'weight' });
      }
      walk(v, own);
    }
  };
  walk(root, null);
  return facts;
}

const NUMBER = /(?<![\w.])-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|(?<![\w.])-?\d+(?:\.\d+)?/g;
type Figure = { value: number; percent: boolean; decimals: number; text: string };
function figures(text: string): Figure[] {
  const out: Figure[] = [];
  for (const m of text.matchAll(NUMBER)) {
    const raw = m[0], value = Number(raw.replace(/,/g, ''));
    const percent = /^\s?(%|percent\b)/i.test(text.slice(m.index! + raw.length));
    out.push({ value, percent, decimals: raw.split('.')[1]?.length ?? 0, text: raw });
  }
  return out;
}
// A rounded figure matches the evidence it was rounded from.
const near = (f: Figure, v: number) => Math.abs(f.value - v) <= 0.5 * 10 ** -f.decimals + 1e-9;

/** Issues for each finding, keyed "finding N: …". Empty when every figure checks out. */
export function metricIssues(assessment: Assessment, evidence: readonly { id: string; content?: string }[]): string[] {
  const facts = new Map(evidence.map((e) => [e.id, evidenceFacts(e.content ?? '')]));
  const issues: string[] = [];
  assessment.findings.forEach((finding, i) => {
    const cited = finding.evidenceIds.map((id) => facts.get(id)).filter((f): f is Facts => !!f);
    const numbers = cited.flatMap((f) => f.numbers), labelled = cited.flatMap((f) => f.labelled);
    const bases = new Map<Basis, string[]>();
    for (const fig of figures(finding.claim)) {
      if (fig.percent && !numbers.some((v) => near(fig, v) || near(fig, v * 100))) issues.push(`finding ${i + 1}: ${fig.text}% is not in its cited evidence`);
      // Large plain amounts can only be denominators; small ones are too ambiguous to label.
      const hits = labelled.filter((l) => (fig.percent ? l.kind === 'weight' : l.kind === 'denominator' && Math.abs(l.value) >= 100) && near(fig, l.value));
      const found = new Set(hits.map((h) => h.basis).filter(isBasis));
      if (found.size === 1) { const b = [...found][0]!; bases.set(b, [...(bases.get(b) ?? []), fig.text + (fig.percent ? '%' : '')]); }
    }
    if (bases.size > 1) issues.push(`finding ${i + 1}: mixes denominators (${[...bases].map(([b, xs]) => `${xs.join(', ')} on ${b}`).join('; ')}); restate every figure on one basis`);
  });
  return issues;
}
