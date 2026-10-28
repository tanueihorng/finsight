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

/** References must point to supplied evidence, not merely look like a citation. */
export function validateAssessment(value: unknown, evidence: readonly z.infer<typeof Evidence>[]): Assessment {
  const parsed = Assessment.parse(value);
  const ids = new Set(evidence.map((item) => Evidence.parse(item).id));
  if (ids.size !== evidence.length) throw new Error('Duplicate evidence ID');
  for (const finding of parsed.findings) for (const id of finding.evidenceIds) if (!ids.has(id)) throw new Error(`Unknown evidence ID: ${id}`);
  return parsed;
}

/** Accept one JSON object, optionally enclosed in a single Markdown JSON fence.
 * Never scrape a JSON-looking substring out of surrounding model prose. */
export function decodeAssessment(text: string, evidence: readonly z.infer<typeof Evidence>[]): Assessment {
  const trimmed = text.trim();
  const fence = /^```(?:json)?\s*\n([\s\S]*?)\n```$/i.exec(trimmed);
  return validateAssessment(JSON.parse(fence ? fence[1]! : trimmed), evidence);
}
