import test from 'node:test';
import assert from 'node:assert/strict';
import { lockTitle, pinProblem } from './lock.ts';

test('lock titles and PIN checks match legacy', () => {
  assert.deepEqual(['enter', 'create', 'offline'].map((m) => lockTitle(m as never)), ['Enter your PIN', 'Create a PIN (4–12 digits)', "Can't reach the FinSight server"]);
  assert.equal(pinProblem('enter', '12', ''), 'PIN must be 4–12 digits');
  assert.equal(pinProblem('enter', '1234567890123', ''), 'PIN must be 4–12 digits');
  assert.equal(pinProblem('enter', '2468', ''), null);
  assert.equal(pinProblem('create', '2468', '1357'), 'PINs do not match');
  assert.equal(pinProblem('create', '2468', '2468'), null);
});
