// Deterministic checks on figures in council claims (FR-1.5). A percentage in a
// claim must appear in the evidence that claim cites, one claim must not mix
// weights or totals from different denominators (securities vs securities plus
// cash), and a claim must not place a holding in a group the cited exposure
// result says it is not in. No model judgement is involved; issues trigger the
// existing repair turn.
import type { Assessment } from './council-contract.ts';

type Basis = 'securities' | 'securities_plus_cash';
type Labelled = { value: number; basis: Basis | null; kind: 'weight' | 'denominator' };
// One grouping (e.g. sector view): each group's label and member symbols.
type Grouping = Map<string, Set<string>>;
type Facts = { numbers: number[]; labelled: Labelled[]; groupings: Grouping[] };

const BASIS_KEYS: Record<string, Basis> = { securitiesPct: 'securities', weightInclCashPct: 'securities_plus_cash' };
const isBasis = (v: unknown): v is Basis => v === 'securities' || v === 'securities_plus_cash';

/** Collect every number in a tool result, and the weights and denominators whose basis it names. */
export function evidenceFacts(content: string): Facts {
  const facts: Facts = { numbers: [], labelled: [], groupings: [] };
  let root: unknown;
  try { root = JSON.parse(content); } catch { return facts; }
  const walk = (node: unknown, basis: Basis | null) => {
    if (typeof node === 'number' && Number.isFinite(node)) { facts.numbers.push(node); return; }
    if (typeof node === 'string') { const n = Number(node); if (node.trim() && Number.isFinite(n)) facts.numbers.push(n); return; }
    if (Array.isArray(node)) { for (const x of node) walk(x, basis); return; }
    if (!node || typeof node !== 'object') return;
    const o = node as Record<string, unknown>;
    // Evidence wrappers carry the tool result as a JSON string.
    if (typeof o.content === 'string' && /^\s*[[{]/.test(o.content)) { const inner = evidenceFacts(o.content); facts.numbers.push(...inner.numbers); facts.labelled.push(...inner.labelled); facts.groupings.push(...inner.groupings); }
    if (Array.isArray(o.rows) && o.rows.some((r) => Array.isArray((r as { members?: unknown })?.members))) {
      const g: Grouping = new Map();
      for (const r of o.rows as { group?: unknown; members?: { symbol?: unknown }[] }[]) if (typeof r?.group === 'string' && Array.isArray(r.members)) g.set(r.group, new Set(r.members.map((m) => String(m?.symbol ?? '')).filter(Boolean)));
      facts.groupings.push(g);
    }
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

const escape = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const labelPattern = (label: string) => label.trim().split(/\s*\/\s*/).map((part) => part.split(/\s+/).map(escape).join('\\s+')).join('\\s*/\\s*');
const symbolPattern = (symbol: string) => `(?<![A-Za-z0-9.])${escape(symbol)}(?![A-Za-z0-9])`;
const CONTAINS = '(?:dominated|driven|led|made\\s+up|composed)\\s+(?:mostly\\s+|largely\\s+|mainly\\s+)?(?:by|of)|includ(?:es|ing)|consists?\\s+of|compris(?:es|ing)|contains?|mostly|mainly|largely|chiefly|primarily';
const WITHIN = '(?:is|sits|falls|counts)?\\s*(?:in|within|inside|part\\s+of|belongs\\s+to)';

/** "X is in group G" or "G is dominated by X" where the cited grouping says otherwise. */
function membershipIssues(text: string, groupings: Grouping[]): string[] {
  const out = new Set<string>();
  for (const sentence of text.split(/(?<=[.;!?])\s+/)) for (const g of groupings) {
    const owner = new Map<string, string>();
    for (const [label, symbols] of g) for (const s of symbols) owner.set(s, label);
    for (const [label, symbols] of g) {
      if (!new RegExp(labelPattern(label), 'i').test(sentence)) continue;
      for (const [symbol, actual] of owner) {
        if (symbols.has(symbol) || !/^[A-Z0-9.^-]{1,24}$/.test(symbol)) continue;
        const L = labelPattern(label), S = symbolPattern(symbol);
        const hit = new RegExp(`${L}[^;!?]*?(?:${CONTAINS})[^;!?]*?${S}`, 'i').exec(sentence) ?? new RegExp(`${S}[^;!?]*?${WITHIN}\\s+(?:the\\s+)?${L}`, 'i').exec(sentence);
        // A negated statement ("X is not in G") agrees with the evidence.
        const claimed = !!hit && !/\b(?:not|no|never|outside|except|exclud\w*)\b|n't/i.test(hit[0]);
        if (claimed) out.add(`${symbol} is not in the ${label} group in its cited evidence (it is in ${actual})`);
      }
    }
  }
  return [...out];
}

/** Issues for each finding, keyed "finding N: …". Empty when every figure checks out. */
export function metricIssues(assessment: Assessment, evidence: readonly { id: string; content?: string }[]): string[] {
  const facts = new Map(evidence.map((e) => [e.id, evidenceFacts(e.content ?? '')]));
  const issues: string[] = [];
  assessment.findings.forEach((finding, i) => {
    const cited = finding.evidenceIds.map((id) => facts.get(id)).filter((f): f is Facts => !!f);
    const numbers = cited.flatMap((f) => f.numbers), labelled = cited.flatMap((f) => f.labelled), groupings = cited.flatMap((f) => f.groupings);
    for (const text of [finding.claim, ...finding.counterevidence]) for (const m of membershipIssues(text, groupings)) issues.push(`finding ${i + 1}: ${m}`);
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

/** A short, code-made label for a tool result's weight basis and classification
 * coverage, so a reader sees what a percentage divides by. Empty when none apply. */
export function basisNote(content: string): string {
  let j: Record<string, any>;
  try { j = JSON.parse(content); } catch { return ''; }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return '';
  const out: string[] = [];
  if (j.weightBasis === 'securities') out.push('weightPct = share of securities; weightInclCashPct includes cash');
  else if (j.weightBasis === 'securities_plus_cash') out.push('weights include cash');
  else if (j.denominators?.securities && j.denominators?.securities_plus_cash) out.push('securitiesPct excludes cash; weightInclCashPct includes it');
  const c = j.coverage;
  if (c && typeof c === 'object') {
    if (Array.isArray(c.unclassified) && c.unclassified.length) out.push(`${c.unclassified.length} unclassified`);
    if (Array.isArray(c.funds) && c.funds.length) out.push(`${c.funds.length} fund${c.funds.length === 1 ? '' : 's'} without look-through`);
  }
  if (out.length && (j.liabilities === 'not tracked' || j.denominators?.liabilities === 'not tracked')) out.push('liabilities not tracked');
  return out.join(' · ');
}
