// COUNCILQUALITY-001 regression: a council claim once quoted a securities-only
// weight against a cash-inclusive total. Synthetic figures only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evidenceFacts, metricIssues, guidanceRanges } from '../src/chat/council-metrics.ts';

const den = { securities: { scope: 'securities', value: 119000, currency: 'SGD' }, securities_plus_cash: { scope: 'securities_plus_cash', value: 134447.51, currency: 'SGD' }, liabilities: 'not tracked' };
const portfolio = JSON.stringify({ weightBasis: 'securities', denominators: den, positions: [{ symbol: 'AAA', marketValue: 18188.02, weightPct: 15.28, weightInclCashPct: 13.53 }] });
const exposures = JSON.stringify({ weightBasis: 'securities_plus_cash', total: 134447.51, rows: [{ group: 'USD', value: 60000, weightPct: 44.63 }] });
const evidence = [{ id: 'p', content: portfolio }, { id: 'x', content: exposures }, { id: 'n', content: 'Plain text filing' }];
const finding = (claim: string, evidenceIds = ['p']) => ({ findings: [{ claim, evidenceIds, assumptions: [], uncertainty: 'Low', counterevidence: [] as string[], invalidation: 'New data', missingEvidence: [] }], unresolvedQuestions: [] });

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

// Audited case: a report placed two funds in an ETF / Fund bucket whose value
// was smaller than the two together. Membership now comes from the tool.
const sectors = JSON.stringify({ weightBasis: 'securities_plus_cash', by: 'sector', total: 134447.51, rows: [
  { group: 'ETF / Fund', value: 27850.19, weightPct: 20.71, members: [{ symbol: 'PPP', value: 21315.79 }, { symbol: 'QQQ1', value: 6534.4 }] },
  { group: 'Unclassified', value: 18188.02, weightPct: 13.53, members: [{ symbol: 'AAA', value: 18188.02 }] },
] });
const withSectors = [...evidence, { id: 's', content: sectors }];

test('flags a holding placed in a group the cited exposure result excludes it from', () => {
  const issues = metricIssues(finding('The 20.71% ETF / Fund bucket is dominated by AAA and PPP.', ['s']), withSectors);
  assert.deepEqual(issues, ['finding 1: AAA is not in the ETF / Fund group in its cited evidence (it is in Unclassified)']);
  assert.match(metricIssues(finding('AAA sits within the ETF/Fund line.', ['s']), withSectors).join(), /AAA is not in the ETF \/ Fund group/);
  const counter = { ...finding('Fund exposure is moderate.', ['s']) };
  counter.findings[0]!.counterevidence = ['ETF / Fund (20.71%) includes AAA.'];
  assert.match(metricIssues(counter, withSectors).join(), /AAA is not in the ETF \/ Fund group/);
});

test('correct or negated membership statements pass', () => {
  assert.deepEqual(metricIssues(finding('The 20.71% ETF / Fund bucket is dominated by PPP.', ['s']), withSectors), []);
  assert.deepEqual(metricIssues(finding('AAA is not in the ETF / Fund group.', ['s']), withSectors), []);
  assert.deepEqual(metricIssues(finding('AAA is 13.53% and ETF / Fund is 20.71%.', ['s']), withSectors), []);
});

test('basisNote names weight bases, classification gaps and untracked liabilities', async () => {
  const { basisNote } = await import('../src/chat/council-metrics.ts');
  assert.equal(basisNote(portfolio), 'weightPct = share of securities; weightInclCashPct includes cash · liabilities not tracked');
  assert.equal(basisNote(JSON.stringify({ weightBasis: 'securities_plus_cash', liabilities: 'not tracked', coverage: { unclassified: ['A'], funds: ['B', 'C'] } })), 'weights include cash · 1 unclassified · 2 funds without look-through · liabilities not tracked');
  assert.equal(basisNote('not json'), '');
  assert.equal(basisNote(JSON.stringify({ quotes: [] })), '');
});

test('a direction stated in words matches a signed tool value', () => {
  const hist = [{ id: 'h', content: JSON.stringify({ lastVsHighPct: -12.16, maxDrawdownPct: -27.76 }) }];
  const f = (claim: string) => ({ findings: [{ claim, evidenceIds: ['h'], assumptions: [], uncertainty: 'u', counterevidence: [], invalidation: 'i', missingEvidence: [] }], unresolvedQuestions: [] });
  assert.deepEqual(metricIssues(f('It sits 12.16% below its high after a 27.76% drawdown.'), hist), []);
  assert.match(metricIssues(f('It sits 13% below its high.'), hist).join(), /13% is not in its cited evidence/);
});

test('counterevidence must name a supplied evidence ID; opinion does not count', () => {
  const f = (counter: string[]) => ({ findings: [{ claim: 'No figures.', evidenceIds: ['p'], assumptions: [], uncertainty: 'u', counterevidence: counter, invalidation: 'i', missingEvidence: [] }], unresolvedQuestions: [] });
  assert.deepEqual(metricIssues(f(['The cash weight is high (p)']), evidence), []);
  assert.deepEqual(metricIssues(f(["The 'Large Blend' label sits uneasily with its tech weight."]), evidence), ['finding 1: counterevidence 1 cites no supplied evidence ID; name its source ID or move it to assumptions']);
});

// AMD council audit 2026-10-31 (public issuer figures; no personal data).
const fin = { id: 'f', content: JSON.stringify({ concepts: { Revenue: { annual: [{ fy: 2025, value: 34639000000, changePctFromPriorYear: 34.34 }, { fy: 2024, value: 25785000000 }] } } }) };
const deal = { id: 'k', content: JSON.stringify({ reports: [{ filed: '2026-09-28', items: '1.01', eventStatus: 'pending' }] }) };
const val = { id: 'v', content: JSON.stringify({ peTrailing: 129.44, epsApproximate: true, ttm: { epsDiluted: { value: 3.9 } } }) };
const wts = { id: 'w', content: JSON.stringify({ account: 'ALL', accountScope: 'All accounts combined', rows: [{ symbol: 'AMD', securitiesPct: 4.12, weightInclCashPct: 3.8 }] }) };
const amd = [fin, deal, val, wts];
const one = (claim: string, ids: string[], counterevidence: string[] = []) => ({ findings: [{ claim, evidenceIds: ids, assumptions: [], uncertainty: 'u', counterevidence, invalidation: 'i', missingEvidence: [] }], unresolvedQuestions: [] });

test('a qualitative change must agree with the figures it describes, in counterevidence too', () => {
  const bad = metricIssues(one('Valuation is stretched.', ['f'], ['Revenue nearly doubled from $25.785bn to $34.639bn (f).']), amd);
  assert.match(bad.join(), /"nearly doubled" contradicts its own figures, a 34\.34% change/);
  assert.match(metricIssues(one('Revenue doubled last year.', ['f']), amd).join(), /states a change without the figures/);
  assert.deepEqual(metricIssues(one('Revenue rose 34.34% from $25.785bn to $34.639bn.', ['f']), amd), []);
  assert.deepEqual(metricIssues(one('Revenue doubled from $10bn to $20.4bn.', ['f']), amd), []);
  assert.deepEqual(metricIssues(one('Management is doubling down on AI.', ['f']), amd), []);
  assert.match(metricIssues(one('Fine.', ['f'], ['Revenue rose 50% (f).']), amd).join(), /counterevidence 1: 50% is not in its cited evidence/);
});

test('a pending agreement is not stated as settled dilution or untouched liquidity', () => {
  const bad = metricIssues(one('Per-share dilution is confirmed and liquidity is untouched because consideration is stock.', ['k']), amd);
  assert.equal(bad.length, 2);
  assert.match(bad.join(), /has not closed/);
  assert.deepEqual(metricIssues(one('The share issuance would dilute holders if the deal closes; cash effects depend on final terms.', ['k']), amd), []);
  assert.deepEqual(metricIssues(one('Stock consideration alone does not establish that there is no cash effect.', ['k']), amd), []);
  assert.match(metricIssues(one('Consideration is stock. There is no cash effect.', ['k']), amd).join(), /no cash effect/);
  // Without a pending event in the packet the wording is not policed.
  assert.deepEqual(metricIssues(one('Liquidity is untouched.', ['f']), [fin]), []);
});

test('all-account weights name their scope and an approximate P/E says so', () => {
  assert.match(metricIssues(one('AMD is 4.12% of securities.', ['w']), amd).join(), /name its account scope/);
  assert.deepEqual(metricIssues(one('AMD is 4.12% of securities across all accounts combined.', ['w']), amd), []);
  // Live run 2026-10-31: scope named in the first sentence covers the next one.
  assert.deepEqual(metricIssues(one('Figures are all accounts combined. AMD is 4.12% of securities.', ['w']), amd), []);
  // TSM audit item 5: a policy limit that happens to equal a weight is a rule, not a portfolio figure.
  assert.deepEqual(metricIssues(one('The proposed single-name limit is 4.12% of securities.', ['w']), amd).filter((x) => /account scope/.test(x)), []);
  assert.deepEqual(metricIssues(one('Adding would breach the 4.12% cap.', ['w']), amd).filter((x) => /account scope/.test(x)), []);
  // A limit named after a comma does not excuse the weight before it.
  assert.match(metricIssues(one('AMD is 4.12% of securities, under the 15% cap.', ['w']), amd).join(), /4\.12% is an all-account/);
  assert.match(metricIssues(one('AMD trades at 129.44x trailing earnings.', ['v']), amd).join(), /129\.44 is a trailing P\/E from approximate EPS/);
  assert.deepEqual(metricIssues(one('AMD trades at roughly 129.44x trailing earnings.', ['v']), amd), []);
});

test('basisNote names account scope, approximate EPS and pending events', async () => {
  const { basisNote } = await import('../src/chat/council-metrics.ts');
  assert.equal(basisNote(wts.content), 'all accounts combined');
  assert.equal(basisNote(val.content), 'trailing EPS and P/E approximate');
  assert.equal(basisNote(deal.content), 'describes a pending agreement or event');
});

test('figures in cited filing text count as evidence, and a label is matched as a whole word', () => {
  const k8 = { id: 'r', content: JSON.stringify({ reports: [{ text: 'Data Center segment revenue was $6.7 billion, up 107% year-over-year; gross margin 54%. Operating margin17%(2)%' }] }) };
  assert.deepEqual(metricIssues(one('Data Center revenue rose 107%, gross margin was 54% and operating margin 17%.', ['r']), [k8]), []);
  assert.match(metricIssues(one('Data Center revenue rose 120%.', ['r']), [k8]).join(), /120% is not in its cited evidence/);
  const ex = { id: 's', content: JSON.stringify({ weightBasis: 'securities_plus_cash', rows: [{ group: 'Technology', members: [{ symbol: 'TSM' }] }, { group: 'Cash', members: [{ symbol: 'SGD cash' }] }] }) };
  assert.deepEqual(metricIssues(one('Technology is large on the securities-plus-cash basis, led by TSM.', ['s']), [ex]), []);
});

test('guidance is a range: a midpoint used as a break point is flagged with code-computed bounds', () => {
  const release = 'Revenue is expected to be $108.0 billion, plus or minus 2%. GAAP and non-GAAP gross margins are expected to be 73.9% and 74.0%, respectively, plus or minus 50 basis points.';
  const evidence = [{ id: 'g', content: JSON.stringify({ reports: [{ text: release }] }) }];
  assert.deepEqual(guidanceRanges(evidence[0]!.content).map((x) => [x.value, x.unit, x.low, x.high]), [[108, 'billion', 105.84, 110.16], [73.9, '%', 73.4, 74.4], [74, '%', 73.5, 74.5]]);
  const with_ = (invalidation: string, claim = 'No figures.') => metricIssues({ findings: [{ claim, evidenceIds: ['g'], assumptions: [], uncertainty: 'u', counterevidence: [], invalidation, missingEvidence: [] }], unresolvedQuestions: [] }, evidence);
  const sharp = with_('Revenue below US$108 billion or gross margin below 74% would break the support.');
  assert.equal(sharp.length, 2);
  assert.match(sharp[0]!, /^finding 1: .*midpoint.*105\.84 to 110\.16 billion/); assert.match(sharp[1]!, /73\.5 to 74\.5%/);
  assert.deepEqual(with_('Revenue below the US$105.84 billion low end of guidance would matter.'), []);
  assert.deepEqual(with_('Revenue below US$108 billion but inside the guided range would not change the view.'), []);
  assert.deepEqual(with_('Revenue above US$108 billion.'), []);
  assert.deepEqual(with_('Unrelated.', 'The guided margin floor is 73.5%.'), [], 'a code-computed bound counts as evidence');
  const decision = { verdict: 'wait' as const, rationale: 'r', buyNow: 'b', wait: 'w', noAction: 'n', valuation: 'v', momentum: 'm', changesView: ['Revenue below $108 billion'], evidenceIds: ['g'] };
  assert.match(metricIssues({ findings: [], unresolvedQuestions: [], decision }, evidence)[0]!, /^decision: .*midpoint/);
});
