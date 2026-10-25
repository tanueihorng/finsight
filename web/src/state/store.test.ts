import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createUiStore, initialState, createStateBridge, setLastPrice, createAuth } from './store.ts';

test('legacy bridge reads current snapshots and writes notify subscribers, including last prices', () => {
  const store = createUiStore(initialState({ getItem: () => null }));
  const bridge = createStateBridge(store); let updates = 0;
  const off = store.subscribe(() => { updates++; });
  bridge.base = 'USD'; assert.equal(store.getState().base, 'USD');
  store.setState({ base: 'EUR' }); assert.equal(bridge.base, 'EUR');
  const before = bridge.lastPrices; setLastPrice(store, 'NVDA', 123);
  assert.equal(bridge.lastPrices.NVDA, 123); assert.notEqual(before, bridge.lastPrices);
  assert.equal(updates, 3); off();
  assert.ok(Object.keys(bridge).includes('base'));
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
