import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultText, LIMIT_FIELDS, limitsForm, limitsPatch } from './limits.ts';

test('the limits form sends only changes; an emptied field returns to its default', () => {
  const set = { councilTurnUsd: 0.5, turnUsd: 1 };
  const form = limitsForm(set);
  assert.equal(form.councilTurnUsd, '0.5'); assert.equal(form.dayUsd, '');
  assert.deepEqual(limitsPatch(form, set), { body: {} });
  assert.deepEqual(limitsPatch({ ...form, dayUsd: '10', turnUsd: '' }, set), { body: { dayUsd: 10, turnUsd: null } });
  assert.deepEqual(limitsPatch({ ...form, searchesPerTurn: ' 30 ' }, set), { body: { searchesPerTurn: 30 } });
});

test('out-of-range or malformed values name the field', () => {
  const form = limitsForm({});
  assert.deepEqual(limitsPatch({ ...form, turnSteps: '2.5' }, {}), { error: 'Steps per reply: enter a whole number' });
  assert.deepEqual(limitsPatch({ ...form, turnSteps: '80' }, {}), { error: 'Steps per reply: between 1 and 50' });
  assert.deepEqual(limitsPatch({ ...form, dayUsd: 'lots' }, {}), { error: 'Daily spend cap (US$): enter a number' });
});

test('defaults read as the dialog shows them', () => {
  const f = (k: string) => LIMIT_FIELDS.find((x) => x.key === k)!;
  assert.equal(defaultText(f('dayUsd'), { dayUsd: 5 }), 'US$5');
  assert.equal(defaultText(f('turnSteps'), { turnSteps: 25 }), '25');
  assert.equal(defaultText(f('councilTurnUsd'), {}), 'same as per reply');
});
