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
