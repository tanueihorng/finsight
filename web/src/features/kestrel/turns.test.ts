import test from 'node:test';
import assert from 'node:assert/strict';
import { addUi, addCite, addNotice, addText, addTool, citeHost, endSegment, finish, newTurn, toolDone } from './turns.ts';

test('text streams into one segment until a tool or notice closes it', () => {
  let t = addText(addText(newTurn('a'), 'Hel'), 'lo');
  assert.deepEqual(t.parts, [{ kind: 'text', text: 'Hello', open: true }]);
  t = addTool(t, 'c1', 'mcp__finsight__get_cash', '{"ccy":"USD"}');
  t = addText(t, 'after');
  assert.deepEqual(t.parts.map((p) => p.kind), ['text', 'tool', 'text']);
  assert.equal((t.parts[0] as { open: boolean }).open, false);
  assert.equal(t.allText, 'Helloafter');
  t = addNotice(t, 'using skill x', '');
  assert.equal((t.parts[2] as { open: boolean }).open, false);
  assert.equal(endSegment(addText(t, 'z')).parts.at(-1)!.kind, 'text');
});

test('tool rows finish by call id or by the latest running row of that tool', () => {
  let t = addTool(newTurn('a'), 'c1', 'mcp__finsight__get_portfolio', '{"account":"main"}');
  assert.deepEqual(t.parts[0], { kind: 'tool', key: 'c1', name: 'get_portfolio', args: '{"account":"main"}', state: 'running', res: 'running…', detail: 'input: {"account":"main"}' });
  t = toolDone(t, 'c1', 'get_portfolio', true, '9 positions', 1200);
  assert.deepEqual(t.parts[0], { kind: 'tool', key: 'c1', name: 'get_portfolio', args: '{"account":"main"}', state: 'ok', res: '9 positions · 1.2 s', detail: 'input: {"account":"main"}\nresult: 9 positions' });
  t = toolDone(addTool(t, undefined, 'web_search', ''), undefined, 'web_search', false, '', null);
  assert.deepEqual([(t.parts[1] as { state: string }).state, (t.parts[1] as { res: string }).res], ['err', 'failed']);
  assert.equal(toolDone(t, 'zz', 'nope', true, '', 1), t);
});

test('citations are http(s) only and unique; finish closes the text and sets meta', () => {
  let t = addCite(newTurn('a'), { url: 'https://www.example.com/r', class: 'primary' });
  t = addCite(addCite(t, { url: 'https://www.example.com/r' }), { url: 'javascript:alert(1)' });
  assert.equal(t.cites.length, 1);
  assert.equal(citeHost('https://www.example.com/r'), 'example.com');
  const f = finish(addText(t, 'x'), { label: 'Fake', costUsd: 0.01, ms: 1500 });
  assert.deepEqual(f.meta, { label: 'Fake', costUsd: 0.01, ms: 1500 });
  assert.equal((f.parts[0] as { open: boolean }).open, false);
});

test('accepted views replace their tool row and replay without duplicates; raw args never create UI', () => {
  let t = addTool(newTurn('turn_1'), 'view1', 'render_ui', '{"value":999999}');
  assert.equal(t.parts[0]?.kind, 'tool');
  t = addText(t, 'After.');
  t = addUi(t, 'view1', { id: 'accepted' });
  t = addUi(t, 'view1', { id: 'accepted' });
  assert.deepEqual(t.parts.map((p) => p.kind), ['ui', 'text']);
  assert.equal(t.allText, 'After.');
  t = toolDone(t, 'view1', 'render_ui', true, 'done', 1);
  assert.equal(t.parts.filter((p) => p.kind === 'ui').length, 1);
});
