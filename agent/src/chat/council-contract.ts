// Versioned contracts for a future bounded, opt-in investment council.
// This module deliberately does not enable routing or make provider calls.
import { z } from 'zod';

import { LENS_IDS } from '../../../shared/council-lenses.ts';
export { LENSES } from '../../../shared/council-lenses.ts';
export const LensId = z.enum(LENS_IDS);
export type LensId = z.infer<typeof LensId>;

const boundedText = z.string().trim().min(1).max(2000);
export const Evidence = z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/), source: z.string().trim().min(1).max(2000), observedAt: z.string().trim().min(1).max(80), retrievedAt: z.string().trim().min(1).max(80) }).strict();
export const Finding = z.object({ claim: boundedText, evidenceIds: z.array(z.string()).min(1).max(20), assumptions: z.array(boundedText).max(20), uncertainty: boundedText, counterevidence: z.array(boundedText).max(20), invalidation: boundedText, missingEvidence: z.array(boundedText).max(20) }).strict();
export const Assessment = z.object({ findings: z.array(Finding).max(20), unresolvedQuestions: z.array(boundedText).max(20) }).strict();
export type Assessment = z.infer<typeof Assessment>;
export const DECISION_LABEL = { buy_now: 'Buy now', wait: 'Wait', no_action: 'No action', insufficient_evidence: 'Insufficient evidence' } as const;
// The chair's answer to "should I act?": every action is weighed, and valuation
// is kept apart from price behaviour.
export const Decision = z.object({
  verdict: z.enum(['buy_now', 'wait', 'no_action', 'insufficient_evidence']), rationale: boundedText,
  buyNow: boundedText, wait: boundedText, noAction: boundedText, valuation: boundedText, momentum: boundedText,
  changesView: z.array(boundedText).min(1).max(8), evidenceIds: z.array(z.string()).max(20),
}).strict();
export type Decision = z.infer<typeof Decision>;
export const ChairAssessment = Assessment.extend({ decision: Decision.optional() });
export type ChairAssessment = z.infer<typeof ChairAssessment>;
export const DecidedAssessment = Assessment.extend({ decision: Decision });

/** References must point to supplied evidence, not merely look like a citation. */
export function validateAssessment(value: unknown, evidence: readonly z.infer<typeof Evidence>[], schema: z.ZodType<ChairAssessment> = Assessment): ChairAssessment {
  const parsed = schema.parse(value);
  const ids = new Set(evidence.map((item) => Evidence.parse(item).id));
  if (ids.size !== evidence.length) throw new Error('Duplicate evidence ID');
  for (const id of [...parsed.findings.flatMap((finding) => finding.evidenceIds), ...(parsed.decision?.evidenceIds ?? [])]) if (!ids.has(id)) throw new Error(`Unknown evidence ID: ${id}`);
  return parsed;
}

/** Why an assessment was rejected, bounded for a repair prompt and the stage error. */
export function assessmentProblems(error: unknown): string {
  if (error instanceof z.ZodError) {
    const listed = error.issues.slice(0, 12).map((issue) => `${issue.path.map(String).join('.') || 'response'}: ${issue.message}`.slice(0, 160));
    const more = error.issues.length - listed.length;
    return listed.join('; ') + (more > 0 ? `; and ${more} more` : '');
  }
  return error instanceof SyntaxError ? 'the response is not valid JSON' : String((error as Error)?.message ?? error).slice(0, 300);
}

/** Accept one JSON object, optionally enclosed in a single Markdown JSON fence.
 * Never scrape a JSON-looking substring out of surrounding model prose. */
export function decodeAssessment(text: string, evidence: readonly z.infer<typeof Evidence>[], schema: z.ZodType<ChairAssessment> = Assessment): ChairAssessment {
  const trimmed = text.trim();
  const fence = /^```(?:json)?\s*\n([\s\S]*?)\n```$/i.exec(trimmed);
  return validateAssessment(JSON.parse(fence ? fence[1]! : trimmed), evidence, schema);
}
