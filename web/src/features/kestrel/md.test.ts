import test from 'node:test';
import assert from 'node:assert/strict';
import { md } from './md.ts';

test('markdown subset: paragraphs, emphasis, code, headings, lists, links', () => {
  assert.equal(md('Hello **bold** and *it* `x<y`'), '<p>Hello <strong>bold</strong> and <em>it</em> <code>x&lt;y</code></p>');
  assert.equal(md('a\nb\n\nc'), '<p>a<br>b</p><p>c</p>');
  assert.equal(md('## Title'), '<h2>Title</h2>');
  assert.equal(md('- one\n- two'), '<ul><li>one</li><li>two</li></ul>');
  assert.equal(md('1. one\n2) two'), '<ol><li>one</li><li>two</li></ol>');
  assert.equal(md('```\n<b>raw</b>\n```'), '<pre><code>&lt;b&gt;raw&lt;/b&gt;</code></pre>');
  assert.equal(md('[docs](https://example.com/a)'), '<p><a href="https://example.com/a" target="_blank" rel="noopener noreferrer">docs</a></p>');
});

test('tables right-align numeric columns', () => {
  const out = md('| Sym | Value |\n|---|---|\n| AAPL | S$1,234.50 |\n| MSFT | -3.2% |');
  assert.ok(out.includes('<th class="">Sym</th><th class="num">Value</th>'));
  assert.ok(out.includes('<td class="">AAPL</td><td class="num">S$1,234.50</td>'));
});

test('script, HTML and non-http links are neutralised', () => {
  const payloads = ['<script>alert(1)</script>', '<img src=x onerror=alert(1)>', '"><svg onload=alert(1)>', '<a href="javascript:alert(1)">x</a>'];
  for (const p of payloads) {
    const out = md(p);
    assert.ok(!/<(script|img|svg|iframe)\b/i.test(out), out);
    assert.ok(!/<a\b[^>]*href="javascript:/i.test(out), out);
  }
  assert.equal(md('[x](javascript:alert(1))'), '<p>[x](javascript:alert(1))</p>');
  assert.equal(md('[x](data:text/html,hi)'), '<p>[x](data:text/html,hi)</p>');
  // a quote inside a link URL cannot break out of the attribute (it is escaped before the link rule runs)
  assert.ok(!md('[x](https://a.com/"onmouseover="alert(1))').includes('"onmouseover="'));
});

test('nested emphasis from the reported answer renders without raw delimiters', () => {
  const answer = '**"Hottest" splits into two answers right now: momentum leader is Micron (MU, +301% over 12 months), and Friday\'s hottest *move* was cybersecurity.** I can\'t name one definitive winner.';
  const out = md(answer);
  assert.ok(out.includes('<strong>&quot;Hottest&quot; splits into two answers right now:'));
  assert.ok(out.includes('hottest <em>move</em> was cybersecurity.</strong>'));
  assert.ok(!out.includes('**'), out);
  assert.equal(md('**bold *italic***'), '<p><strong>bold <em>italic</em></strong></p>');
  assert.equal(md('*italic **bold***'), '<p><em>italic <strong>bold</strong></em></p>');
  assert.equal(md('***both***'), '<p><strong><em>both</em></strong></p>');
  assert.equal(md('**one** and **two**'), '<p><strong>one</strong> and <strong>two</strong></p>');
});

test('inline code and link URLs are not reformatted as emphasis', () => {
  assert.equal(md('`**literal** *code* [x](https://example.com)`'), '<p><code>**literal** *code* [x](https://example.com)</code></p>');
  assert.equal(md('**Use `a*b` here**'), '<p><strong>Use <code>a*b</code> here</strong></p>');
  assert.equal(md('[**bold** *label*](https://example.com/a*b)'), '<p><a href="https://example.com/a*b" target="_blank" rel="noopener noreferrer"><strong>bold</strong> <em>label</em></a></p>');
  assert.equal(md('\\*literal\\*'), '<p>*literal*</p>');
});

test('incomplete streamed emphasis stays balanced and malicious nested text remains escaped', () => {
  const input = '**bold *italic* and [link](https://example.com) done**';
  for (let n = 0; n <= input.length; n++) {
    const out = md(input.slice(0, n));
    for (const tag of ['strong', 'em', 'code', 'a']) assert.equal((out.match(new RegExp('<' + tag + '(?:>| )', 'g')) || []).length, (out.match(new RegExp('</' + tag + '>', 'g')) || []).length, out);
  }
  const out = md('**<img src=x onerror=alert(1)> *bad* [no](javascript:alert(1))**');
  assert.ok(!out.includes('<img')); assert.ok(!out.includes('href="javascript:')); assert.ok(out.includes('&lt;img'));
  assert.doesNotThrow(() => md('**a '.repeat(1000) + '*b '.repeat(1000)));
});
