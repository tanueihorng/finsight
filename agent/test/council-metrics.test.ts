// COUNCILQUALITY-001 regression: a council claim once quoted a securities-only
// weight against a cash-inclusive total. Synthetic figures only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evidenceFacts, metricIssues } from '../src/chat/council-metrics.ts';

const den = { securities: { scope: 'securities', value: 119000, currency: 'SGD' }, securities_plus_cash: { scope: 'securities_plus_cash', value: 134447.51, currency: 'SGD' }, liabilities: 'not tracked' };
const portfolio = JSON.stringify({ weightBasis: 'securities', denominators: den, positions: [{ symbol: 'AAA', marketValue: 18188.02, weightPct: 15.28, weightInclCashPct: 13.53 }] });
const exposures = JSON.stringify({ weightBasis: 'securities_plus_cash', total: 134447.51, rows: [{ group: 'USD', value: 60000, weightPct: 44.63 }] });
const evidence = [{ id: 'p', content: portfolio }, { id: 'x', content: exposures }, { id: 'n', content: 'Plain text filing' }];
const finding = (claim: string, evidenceIds = ['p']) => ({ findings: [{ claim, evidenceIds, assumptions: [], uncertainty: 'Low', counterevidence: [], invalidation: 'New data', missingEvidence: [] }], unresolvedQuestions: [] });

test('labels weights by key and inherited basis', () => {
  const f = evidenceFacts(portfolio);
  assert.ok(f.labelled.some((l) => l.value === 15.28 && l.basis === 'securities' && l.kind === 'weight'));
  assert.ok(f.labelled.some((l) => l.value === 13.53 && l.basis === 'securities_plus_cash'));
  assert.ok(f.labelled.some((l) => l.value === 134447.51 && l.kind === 'denominator' && l.basis === 'securities_plus_cash'));
  assert.ok(evidenceFacts(exposures).labelled.some((l) => l.value === 44.63 && l.basis === 'securities_plus_cash'));
});

test('flags a securities-only weight quoted against the cash-inclusive total', () => {
  const issues = metricIssues(finding('AAA is 15.28% of the SGD 134,447.51 portfolio.'), evidence);
  assert.equal(issues.length, 1);
  assert.match(issues[0]!, /mixes denominators.*15\.28% on securities.*134,447\.51 on securities_plus_cash/);
});

test('accepts one consistent basis, including a rounded weight', () => {
  assert.deepEqual(metricIssues(finding('AAA is 13.53% of the SGD 134,447.51 total including cash.'), evidence), []);
  assert.deepEqual(metricIssues(finding('AAA is about 13.5% including cash.'), evidence), []);
  assert.deepEqual(metricIssues(finding('AAA is 15.28% of securities.'), evidence), []);
});

test('mixed bases across cited tools are caught too', () => {
  const issues = metricIssues(finding('USD is 44.63% while AAA is 15.28%.', ['p', 'x']), evidence);
  assert.match(issues.join(), /mixes denominators/);
});

test('a percentage absent from the cited evidence is unsupported', () => {
  assert.match(metricIssues(finding('AAA is 13.53% of the total.', ['n']), evidence).join(), /13\.53% is not in its cited evidence/);
  assert.match(metricIssues(finding('Margins expanded 40%.'), evidence).join(), /40% is not in its cited evidence/);
  assert.deepEqual(metricIssues(finding('No figures here.', ['n']), evidence), []);
});
