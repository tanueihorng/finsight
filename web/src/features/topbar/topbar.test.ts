import test from 'node:test';
import assert from 'node:assert/strict';
import { accountDetail, accountLabel, afterRemove } from './topbar.ts';
import { firstName, parseProfile } from './profile.ts';

test('account labels, removal fallback and profile parsing match legacy', () => {
  assert.equal(accountLabel({ id: 'a', name: 'Main', type: '', count: 9 }), 'Main (9)');
  assert.equal(accountLabel({ id: 'a', name: 'New', type: '', count: 0 }), 'New');
  assert.equal(accountDetail({ id: 'a', name: 'IBKR', type: 'Broker', count: 0 }), 'Broker · 0 holdings');
  assert.equal(accountDetail({ id: 'a', name: 'Main', type: '', count: 9 }), '9 holdings');
  assert.deepEqual([afterRemove('x', 'x', 'main'), afterRemove('y', 'x', 'main')], ['main', 'y']);
  assert.deepEqual(parseProfile('{bad'), {});
  assert.deepEqual(parseProfile(null), {});
  assert.equal(firstName({ name: 'Tan Wei' }), 'Tan');
  assert.equal(firstName({}), 'Profile');
});
