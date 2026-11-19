// Answer number check (FR-1.4, FR-1.5). After a chat turn, every figure in the
// answer that could be data (a percentage, a decimal, an amount with a currency
// mark or scale, or any number of 100 or more) must match a number in the
// evidence the model was given: this conversation's tool results, its context
// snapshots and the user's own words. Rounding counts as a match. No model is
// involved. Figures that match nothing are reported to the user as unverified;
// the answer itself is not changed.
import { evidenceFacts, figures, type Figure } from './council-metrics.ts';

export type Grounding = { checked: number; untraced: string[] };

const SCALES: Record<string, number> = { k: 1e3, thousand: 1e3, m: 1e6, mn: 1e6, million: 1e6, b: 1e9, bn: 1e9, billion: 1e9, t: 1e12, tn: 1e12, trillion: 1e12 };
const SCALE_AFTER = /^\s?(k|m|mn|b|bn|t|tn|thousand|million|billion|trillion)\b/i;
const CURRENCY_BEFORE = /(?:[$€£¥]|[A-Z]{1,3}\$|\b[A-Z]{3}\s?)$/;
// Dates and times are not data figures; drop them before extracting numbers.
const DATES = /\b\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+Z?)?\b|\b\d{1,2}:\d{2}(?::\d{2})?\b|\b(?:\d{1,2}\s+)?(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?(?:\s+\d{1,2})?(?:,?\s+\d{4})?\b/g;

/** Every number a piece of evidence contains: JSON values and figures in its prose. */
export function evidenceNumbers(content: string): number[] {
  try { JSON.parse(content); } catch { return figures(content).map((f) => f.value); }
  return evidenceFacts(content).numbers;
}

type Claim = { fig: Figure; scale: number; shown: string };
function claims(answer: string): Claim[] {
  const text = answer.replace(DATES, (m) => ' '.repeat(m.length));
  const out: Claim[] = [];
  let from = 0;
  for (const fig of figures(text)) {
    const at = text.indexOf(fig.text, from); from = at + fig.text.length;
    const before = text.slice(Math.max(0, at - 4), at), after = text.slice(at + fig.text.length, at + fig.text.length + 12);
    const unit = after.match(SCALE_AFTER)?.[1]?.toLowerCase();
    const currency = CURRENCY_BEFORE.test(before);
    // Small whole numbers (counts, list numbers, "1M" periods) and years are too ambiguous to check.
    if (!fig.percent && !fig.decimals && !currency && Math.abs(fig.value) < 100) continue;
    if (!fig.percent && !fig.decimals && !currency && !unit && fig.value >= 1900 && fig.value <= 2100) continue;
    if (fig.limit) continue; // a limit or target the user set is a rule, not data
    const tail = fig.percent ? after.match(/^\s?(%|percent\b)/i)![0] : unit ? after.match(SCALE_AFTER)![0] : '';
    const shown = ((currency ? before.match(CURRENCY_BEFORE)![0] : '') + fig.text + tail).trim();
    out.push({ fig, scale: unit ? SCALES[unit]! : 1, shown });
  }
  return out;
}

function traced(c: Claim, numbers: readonly number[]): boolean {
  const tol = 0.5 * 10 ** -c.fig.decimals * c.scale + 1e-9;
  const v = c.fig.value * c.scale;
  return numbers.some((n) => [n, -n, n * 100, -n * 100].some((x) => Math.abs(v - x) <= tol));
}

/** Check an answer against the evidence texts it may draw on. */
export function checkAnswer(answer: string, evidence: readonly string[]): Grounding {
  const numbers = evidence.flatMap(evidenceNumbers);
  const all = claims(answer);
  const untraced = [...new Set(all.filter((c) => !traced(c, numbers)).map((c) => c.shown))];
  return { checked: all.length, untraced };
}

export function groundingNote(g: Grounding): string {
  const list = g.untraced.slice(0, 6).join(', ') + (g.untraced.length > 6 ? ', …' : '');
  return `Number check: ${g.untraced.length} of ${g.checked} figures in this answer match no tool result or data snapshot (${list}). Treat ${g.untraced.length === 1 ? 'it' : 'them'} as unverified.`;
}
