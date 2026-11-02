// Deterministic checks on figures in council claims (FR-1.5). A percentage in a
// claim must appear in the evidence that claim cites, one claim must not mix
// weights or totals from different denominators (securities vs securities plus
// cash), and a claim must not place a holding in a group the cited exposure
// result says it is not in. Qualitative changes ("nearly doubled") must agree
// with the figures they describe, a pending agreement's effects must not be
// stated as confirmed, all-account weights must name that scope, and an
// approximate trailing P/E must be called approximate. No model judgement is
// involved; issues trigger the existing repair turn.
import type { Assessment } from './council-contract.ts';

type Basis = 'securities' | 'securities_plus_cash';
type Labelled = { value: number; basis: Basis | null; kind: 'weight' | 'denominator' };
// One grouping (e.g. sector view): each group's label and member symbols.
type Grouping = Map<string, Set<string>>;
type Facts = { numbers: number[]; labelled: Labelled[]; groupings: Grouping[]; pending: boolean; scoped: boolean; approxRatios: number[] };

const BASIS_KEYS: Record<string, Basis> = { securitiesPct: 'securities', weightInclCashPct: 'securities_plus_cash' };
const isBasis = (v: unknown): v is Basis => v === 'securities' || v === 'securities_plus_cash';

/** Collect every number in a tool result, and the weights and denominators whose basis it names. */
export function evidenceFacts(content: string): Facts {
  const facts: Facts = { numbers: [], labelled: [], groupings: [], pending: false, scoped: false, approxRatios: [] };
  let root: unknown;
  try { root = JSON.parse(content); } catch { return facts; }
  const walk = (node: unknown, basis: Basis | null) => {
    if (typeof node === 'number' && Number.isFinite(node)) { facts.numbers.push(node); return; }
    // Prose such as a filing excerpt ("up 107% year-over-year") carries figures too.
    if (typeof node === 'string') { const n = Number(node); if (node.trim() && Number.isFinite(n)) facts.numbers.push(n); else if (!/^\s*[[{]/.test(node)) facts.numbers.push(...proseNumbers(node)); return; }
    if (Array.isArray(node)) { for (const x of node) walk(x, basis); return; }
    if (!node || typeof node !== 'object') return;
    const o = node as Record<string, unknown>;
    // Evidence wrappers carry the tool result as a JSON string.
    if (typeof o.content === 'string' && /^\s*[[{]/.test(o.content)) {
      const inner = evidenceFacts(o.content);
      facts.numbers.push(...inner.numbers); facts.labelled.push(...inner.labelled); facts.groupings.push(...inner.groupings); facts.approxRatios.push(...inner.approxRatios);
      facts.pending ||= inner.pending; facts.scoped ||= inner.scoped;
    }
    if (o.eventStatus === 'pending') facts.pending = true;
    if (typeof o.accountScope === 'string') facts.scoped = true;
    if (o.epsApproximate === true && typeof o.peTrailing === 'number') facts.approxRatios.push(o.peTrailing);
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
type Figure = { value: number; percent: boolean; decimals: number; text: string; limit: boolean };
// A limit, cap or threshold named next to a percentage ("the 15% cap", "limit
// of 15%") makes it a rule, not a holding's weight, even when the values match.
const LIMIT_WORDS = /\b(?:limits?|caps?|ceilings?|thresholds?|max(?:imum)?|targets?|bands?|guidelines?|triggers?|proposed)\b/i;
function figures(text: string): Figure[] {
  const out: Figure[] = [], ms = [...text.matchAll(NUMBER)];
  ms.forEach((m, k) => {
    const raw = m[0], value = Number(raw.replace(/,/g, '')), end = m.index! + raw.length;
    const percent = /^\s?(%|percent\b)/i.test(text.slice(end));
    // Context runs to the neighbouring figure or clause break, so a limit named
    // after a comma or beside another figure does not relabel this one.
    const before = text.slice(k ? ms[k - 1]!.index! + ms[k - 1]![0].length : 0, m.index!).split(/[,;:()]/).at(-1)!.slice(-25);
    const after = text.slice(end, ms[k + 1]?.index ?? text.length).split(/[,;:()]/)[0]!.slice(0, 25);
    out.push({ value, percent, decimals: raw.split('.')[1]?.length ?? 0, text: raw, limit: percent && LIMIT_WORDS.test(before + ' ' + after) });
  });
  return out;
}
// Extracted filing tables run cells together ("Operating margin17%"), so a
// percentage glued to the word before it still counts in evidence prose.
const proseNumbers = (text: string) => [...figures(text).map((f) => f.value), ...[...text.matchAll(/(?<=[A-Za-z])\d+(?:\.\d+)?(?=\s?%)/g)].map((m) => Number(m[0]))];
// A rounded figure matches the evidence it was rounded from.
const near = (f: Figure, v: number) => Math.abs(f.value - v) <= 0.5 * 10 ** -f.decimals + 1e-9;

const escape = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Whole words only: "Cash" must not match inside "securities-plus-cash".
const labelPattern = (label: string) => '(?<![\\w-])' + label.trim().split(/\s*\/\s*/).map((part) => part.split(/\s+/).map(escape).join('\\s+')).join('\\s*/\\s*') + '(?![\\w-])';
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

const sentences = (text: string) => text.split(/(?<=[.;!?])\s+(?=[A-Z(])/);
const UNIT: Record<string, number> = { k: 1e3, thousand: 1e3, m: 1e6, mn: 1e6, million: 1e6, b: 1e9, bn: 1e9, billion: 1e9, t: 1e12, tn: 1e12, trillion: 1e12 };
const AMOUNT = String.raw`[$€£¥]?\s?(-?\d[\d,]*(?:\.\d+)?)\s?(k|thousand|mn|m|million|bn|b|billion|tn|t|trillion)?\b`;
const PAIR = new RegExp(AMOUNT + String.raw`[^.;\d]{0,24}?\b(?:to|into)\s+` + AMOUNT, 'gi');
const RELATION = /\b(nearly|almost|close\s+to|more\s+than|over|roughly|about|approximately)?\s*(doubl|tripl|quadrupl|halv)(?:ed|ing|es|e)\b(?!\s+down)/gi;
const FACTOR: Record<string, number> = { doubl: 2, tripl: 3, quadrupl: 4, halv: 0.5 };

/** "Revenue nearly doubled from 25.8bn to 34.6bn" where 34.6/25.8 is 1.34. */
function relationIssues(text: string): string[] {
  const out: string[] = [];
  for (const sentence of sentences(text)) for (const m of sentence.matchAll(RELATION)) {
    const f = FACTOR[m[2]!.toLowerCase()]!, q = (m[1] || '').toLowerCase().replace(/\s+/g, ' ');
    const grow = f > 1;
    const [lo, hi] = /nearly|almost|close to/.test(q) ? (grow ? [0.85 * f, f] : [f, f * 1.2]) : /more than|over/.test(q) ? (grow ? [f, Infinity] : [0, f]) : [0.9 * f, 1.1 * f];
    const ratios = [...sentence.matchAll(PAIR)].flatMap((p) => {
      const a = Number(p[1]!.replace(/,/g, '')), b = Number(p[3]!.replace(/,/g, ''));
      const ua = UNIT[(p[2] || p[4] || '').toLowerCase()] ?? 1, ub = UNIT[(p[4] || p[2] || '').toLowerCase()] ?? 1;
      return a > 0 && b >= 0 ? [(b * ub) / (a * ua)] : [];
    });
    const phrase = m[0].trim();
    if (!ratios.length) out.push(`"${phrase}" states a change without the figures it compares; quote the code-computed change (e.g. changePctFromPriorYear) from cited evidence instead`);
    else for (const r of ratios) if (r < lo - 1e-9 || r > hi + 1e-9) out.push(`"${phrase}" contradicts its own figures, a ${Math.round((r - 1) * 10000) / 100}% change; state the computed change instead`);
  }
  return out;
}

const OVERSTATE = /\b(?:confirmed|certain|definite|guaranteed|locked[- ]in)\b[^.;]{0,60}?\bdilut\w*|\bdilut\w*[^.;]{0,40}?\b(?:is|was|are|as)\s+(?:confirmed|certain|definite|guaranteed)\b|\b(?:liquidity|cash(?:\s+position)?|balance\s+sheet)\b[^.;]{0,40}?\b(?:untouched|unaffected|unchanged|intact|preserved)\b|\bno\s+(?:cash|liquidity)\s+(?:impact|effect|cost|outflow)/gi;
const HEDGE = /\b(?:not|no\s+longer|unless|if|would|could|may|might|potential(?:ly)?|until|pending|expected)\b|n't/i;
/** A pending agreement's dilution or cash effect stated as already settled. */
function pendingIssues(text: string): string[] {
  // A hedge may precede the phrase in its clause: "does not establish that there is no cash effect".
  const clause = (m: RegExpMatchArray) => text.slice(0, m.index! + m[0].length).split(/[.;!?]\s/).at(-1)!;
  return [...text.matchAll(OVERSTATE)].filter((m) => !HEDGE.test(clause(m))).map((m) => `"${m[0].trim()}" states the effect of an agreement that has not closed as settled; say it is potential and depends on closing and deal terms`);
}

const SCOPE_WORDS = /\ball[- ]accounts?\b|\bacross\s+(?:all\s+)?(?:your\s+)?accounts\b|\bcombined\b|\baccount\b|\bportfolio[- ]wide\b|\bhousehold\b/i;
const APPROX_WORDS = /approx|\babout\b|\baround\b|\broughly\b|~|≈|estimat|\bcirca\b|\bnear(?:ly)?\b/i;

/** Issues for each finding, keyed "finding N: …". Empty when every figure checks out. */
export function metricIssues(assessment: Assessment, evidence: readonly { id: string; content?: string }[]): string[] {
  const facts = new Map(evidence.map((e) => [e.id, evidenceFacts(e.content ?? '')]));
  const issues: string[] = [];
  assessment.findings.forEach((finding, i) => {
    // Counterevidence cites its own source IDs inline; those count as cited too.
    const inline = evidence.filter((e) => finding.counterevidence.some((c) => new RegExp(`(?<![\\w-])${escape(e.id)}(?![\\w-])`).test(c))).map((e) => e.id);
    const cited = [...new Set([...finding.evidenceIds, ...inline])].map((id) => facts.get(id)).filter((f): f is Facts => !!f);
    const numbers = cited.flatMap((f) => f.numbers), labelled = cited.flatMap((f) => f.labelled), groupings = cited.flatMap((f) => f.groupings);
    const scopedWeights = cited.filter((f) => f.scoped).flatMap((f) => f.labelled.filter((l) => l.kind === 'weight'));
    const approx = cited.flatMap((f) => f.approxRatios), pending = [...facts.values()].some((f) => f.pending);
    const texts = [finding.claim, ...finding.counterevidence];
    for (const text of texts) {
      const add = (m: string) => issues.push(`finding ${i + 1}: ${m}`);
      membershipIssues(text, groupings).forEach(add);
      relationIssues(text).forEach(add);
      if (pending) pendingIssues(text).forEach(add);
      // Scope stated once in the claim covers its later sentences and its counterevidence.
      const scopeNamed = SCOPE_WORDS.test(finding.claim) || SCOPE_WORDS.test(text);
      for (const sentence of sentences(text)) for (const fig of figures(sentence)) {
        if (fig.percent && !fig.limit && scopedWeights.some((l) => near(fig, l.value)) && !scopeNamed) add(`${fig.text}% is an all-account or account-specific weight; name its account scope (e.g. "all accounts combined")`);
        if (!fig.percent && approx.some((v) => near(fig, v)) && !APPROX_WORDS.test(sentence)) add(`${fig.text} is a trailing P/E from approximate EPS; call it approximate`);
      }
    }
    for (const [k, c] of finding.counterevidence.entries()) for (const fig of figures(c)) if (fig.percent && !numbers.some((v) => near(fig, v) || near(fig, v * 100) || near(fig, -v) || near(fig, -v * 100))) issues.push(`finding ${i + 1}: counterevidence ${k + 1}: ${fig.text}% is not in its cited evidence`);
    // Counterevidence is opposing evidence from the packet, not opinion: each
    // entry must name the supplied evidence it comes from.
    finding.counterevidence.forEach((c, k) => { if (!evidence.some((e) => new RegExp(`(?<![\\w-])${escape(e.id)}(?![\\w-])`).test(c))) issues.push(`finding ${i + 1}: counterevidence ${k + 1} cites no supplied evidence ID; name its source ID or move it to assumptions`); });
    const bases = new Map<Basis, string[]>();
    for (const fig of figures(finding.claim)) {
      if (fig.percent && !numbers.some((v) => near(fig, v) || near(fig, v * 100) || near(fig, -v) || near(fig, -v * 100))) issues.push(`finding ${i + 1}: ${fig.text}% is not in its cited evidence`);
      // Large plain amounts can only be denominators; small ones are too ambiguous to label.
      const hits = fig.limit ? [] : labelled.filter((l) => (fig.percent ? l.kind === 'weight' : l.kind === 'denominator' && Math.abs(l.value) >= 100) && near(fig, l.value));
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
  if (typeof j.accountScope === 'string') out.push(j.accountScope.toLowerCase());
  if (j.epsApproximate === true) out.push('trailing EPS and P/E approximate');
  if (Array.isArray(j.reports) && j.reports.some((r: { eventStatus?: string }) => r?.eventStatus === 'pending')) out.push('describes a pending agreement or event');
  return out.join(' · ');
}
