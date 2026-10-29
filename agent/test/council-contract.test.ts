import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LENSES, LensId, validateAssessment } from '../src/chat/council-contract.ts';

test('lens catalog uses unique versioned allowed IDs', () => {
  assert.equal(LENSES.length, 5);
  assert.equal(new Set(LENSES.map((l) => l.id)).size, 5);
  for (const lens of LENSES) { assert.equal(LensId.parse(lens.id), lens.id); assert.equal(lens.version, 1); assert.ok(lens.priorities.length); }
  assert.throws(() => LensId.parse('unknown'));
});

test('assessment requires known dated evidence and explicit uncertainty', () => {
  const evidence = [{ id: 'e1', source: 'https://example.test/filing', observedAt: '2026-10-01', retrievedAt: '2026-10-28' }];
  const finding = { claim: 'A claim', evidenceIds: ['e1'], assumptions: [], uncertainty: 'Unknown', counterevidence: [], invalidation: 'Contrary filing', missingEvidence: ['Policy'] };
  assert.equal(validateAssessment({ findings: [finding], unresolvedQuestions: [] }, evidence).findings.length, 1);
  assert.throws(() => validateAssessment({ findings: [{ ...finding, evidenceIds: ['invented'] }], unresolvedQuestions: [] }, evidence));
  assert.throws(() => validateAssessment({ findings: [{ ...finding, uncertainty: '' }], unresolvedQuestions: [] }, evidence));
  assert.throws(() => validateAssessment({ findings: [finding], unresolvedQuestions: [] }, [...evidence, ...evidence]));
});

test('decoder accepts a single JSON fence but rejects prose scraping and fabricated references', async () => {
  const { decodeAssessment } = await import('../src/chat/council-contract.ts');
  const text = JSON.stringify({ findings: [], unresolvedQuestions: ['Missing evidence'] });
  assert.equal(decodeAssessment('```json\n' + text + '\n```', []).findings.length, 0);
  assert.throws(() => decodeAssessment('Some prose ' + text, []));
  assert.throws(() => decodeAssessment(text + '\ntrailing prose', []));
});
