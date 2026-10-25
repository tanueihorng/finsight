import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand, USAGE } from './commands.ts';

test('command grammar matches legacy runCommand', () => {
  assert.deepEqual(parseCommand('  '), { kind: 'none' });
  assert.deepEqual(parseCommand('?'), { kind: 'help' });
  assert.deepEqual(parseCommand('buy aapl 10 195.5 2024-01-15'), { kind: 'add', sym: 'aapl', qty: '10', price: '195.5', date: '2024-01-15' });
  assert.deepEqual(parseCommand('ADD AAPL 10'), { kind: 'usage', msg: USAGE.add });
  assert.deepEqual(parseCommand('sell aapl 5'), { kind: 'sell', sym: 'aapl', qty: '5', price: null });
  assert.deepEqual(parseCommand('remove x'), { kind: 'del', sym: 'x' });
  assert.deepEqual(parseCommand('quote msft'), { kind: 'quote', sym: 'MSFT' });
  assert.deepEqual(parseCommand('nvda'), { kind: 'quote', sym: 'NVDA' });
  assert.deepEqual(parseCommand('alert aapl below 100'), { kind: 'alert', sym: 'aapl', op: '<', price: '100' });
  assert.deepEqual(parseCommand('alert aapl > 100'), { kind: 'alert', sym: 'aapl', op: '>', price: '100' });
  assert.deepEqual(parseCommand('alert aapl above 1'), { kind: 'alert', sym: 'aapl', op: '>', price: '1' });
  assert.deepEqual(parseCommand('news'), { kind: 'news', sym: null });
  assert.deepEqual(parseCommand('trades'), { kind: 'ledger' });
  assert.deepEqual(parseCommand('cash usd 0'), { kind: 'cash', ccy: 'usd', amt: '0' });
  assert.deepEqual(parseCommand('WHT US'), { kind: 'usage', msg: USAGE.wht });
  assert.deepEqual(parseCommand('markets'), { kind: 'markets' });
});
