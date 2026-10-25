import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createUiStore, initialState, setLastPrices, createAuth } from './store.ts';

test('store writes notify subscribers; last prices merge in one update', () => {
  const store = createUiStore(initialState({ getItem: () => null })); let updates = 0;
  const off = store.subscribe(() => { updates++; });
  store.setState({ base: 'EUR' }); assert.equal(store.getState().base, 'EUR');
  const before = store.getState().lastPrices; setLastPrices(store, { NVDA: 123, AAPL: 1 }); setLastPrices(store, { NVDA: 124 });
  assert.deepEqual(store.getState().lastPrices, { NVDA: 124, AAPL: 1 }); assert.notEqual(before, store.getState().lastPrices);
  assert.equal(updates, 3); off();
});
test('preferences preserve legacy migration, precedence and private-figure visibility', () => {
  const data: Record<string, string> = { 'fincept-base': 'usd', 'fincept-account': 'old', 'finsight-unpeek': '1' };
  const read = { getItem: (key: string) => data[key] ?? null };
  assert.equal(initialState(read).base, 'USD'); assert.equal(initialState(read).account, 'old');
  assert.equal(initialState(read).peek, false); assert.equal(initialState(read).accountReady, false);
  data['finsight-base'] = 'SGD'; assert.equal(initialState(read).base, 'SGD');
  assert.equal(initialState({ getItem: () => { throw new Error('blocked'); } }).base, 'SGD');
});
test('auth emits exactly one event per transition, preventing re-entrant PIN resets', () => {
  const target = new EventTarget(); const auth = createAuth(target); const events: string[] = [];
  for (const name of ['finsight:unlocked', 'finsight:locked']) target.addEventListener(name, () => events.push(name));
  auth.lock(); auth.unlock(); auth.unlock(); auth.lock(); auth.lock();
  assert.equal(auth.unlocked, false); assert.deepEqual(events, ['finsight:unlocked', 'finsight:locked']);
});
