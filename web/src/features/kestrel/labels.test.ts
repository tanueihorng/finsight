import test from 'node:test';
import assert from 'node:assert/strict';
import { clampWidth, costLabel, ctxButton, ctxLabel, nextWidth, offlineWhy, prettyArgs, prettyTool, suggestions, took } from './labels.ts';

test('Kestrel labels match legacy agent-panel.js', () => {
  assert.equal(prettyTool('mcp__finsight__get_portfolio'), 'get_portfolio');
  assert.equal(prettyArgs('{"account":"main","n":2}'), '(account: main, n: 2)');
  assert.equal(prettyArgs(''), '()');
  assert.equal(prettyArgs('not json'), '(not json)');
  assert.deepEqual([took(null), took(850), took(1200)], ['', ' · 850 ms', ' · 1.2 s']);
  assert.deepEqual([costLabel(0.0123), costLabel(0.005)], ['$0.012', '$0.0050']);
  assert.equal(ctxLabel({ symbol: 'VOO', timeframe: '1d', view: 'terminal' }), '@VOO · 1d');
  assert.equal(ctxLabel('{bad'), '');
  assert.equal(ctxButton(true, { view: 'terminal' }), 'This page');
  assert.equal(ctxButton(false, { symbol: 'X', view: 'terminal' }), 'No context');
  assert.equal(suggestions({ symbol: 'VOO', view: 'terminal' })[0], 'What do my strategies say about VOO right now?');
  assert.equal(suggestions({ view: 'terminal' }).length, 4);
  assert.deepEqual([nextWidth(440, 900), nextWidth(720, 900), nextWidth(440, 500)], [560, 360, 360]);
  assert.equal(clampWidth(2000, 1000), 600);
  assert.deepEqual(offlineWhy('Kestrel', { status: 'disabled' }), { starting: false, why: ['The agent is turned off (AGENT_AUTOSTART=0).', ''] });
  assert.deepEqual(offlineWhy('Kestrel', { status: 'running' }).why, ['Kestrel is starting…', '']);
});
