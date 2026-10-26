// Kestrel's safe markdown subset (G1), ported 1:1 from public/agent-panel.js.
// Model text is HTML-escaped first; only this whitelisted markup is then
// added, and links must be http(s). The output is safe to set as innerHTML.
export const esc = (s: unknown) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

// Parse escaped text into balanced inline markup. A delimiter stack handles
// nested bold/italic (including ***); code and URLs are atomic, so formatting
// never rewrites generated HTML attributes or the contents of a code span.
function inline(s: string, depth = 0): string {
  type Frame = { marker: '*' | '**' | ''; parts: string[] };
  const stack: Frame[] = [{ marker: '', parts: [] }];
  const append = (text: string) => stack[stack.length - 1]!.parts.push(text);
  let i = 0;
  while (i < s.length) {
    const start = i;
    while (i < s.length && !'*`[\\'.includes(s[i]!)) i++;
    if (i > start) { append(s.slice(start, i)); continue; }
    if (s[i] === '\\' && /[\\*`[\]]/.test(s[i + 1] || '')) { append(s[i + 1]!); i += 2; continue; }
    if (s[i] === '`') {
      const end = s.indexOf('`', i + 1);
      if (end > i + 1) { append('<code>' + s.slice(i + 1, end) + '</code>'); i = end + 1; continue; }
    }
    if (s[i] === '[' && depth < 8) {
      const link = s.slice(i).match(/^\[([^\]\n]{1,200})\]\((https?:\/\/[^\s)]{1,2000})\)/);
      if (link) { append(`<a href="${link[2]}" target="_blank" rel="noopener noreferrer">${inline(link[1]!, depth + 1)}</a>`); i += link[0].length; continue; }
    }
    if (s[i] === '*') {
      let end = i; while (s[end] === '*') end++;
      let count = end - i;
      const before = s[i - 1] || '', after = s[end] || '';
      const canClose = !!before && !/\s/.test(before);
      const canOpen = !!after && !/\s/.test(after);
      if (canClose) while (stack.length > 1 && count >= stack[stack.length - 1]!.marker.length) {
        const closed = stack.pop()!, tag = closed.marker === '**' ? 'strong' : 'em';
        append(`<${tag}>${closed.parts.join('')}</${tag}>`);
        count -= closed.marker.length;
      }
      // Single-star openers retain the subset's word-boundary rule, avoiding
      // accidental emphasis in arithmetic such as price*quantity*rate.
      while (count > 0 && canOpen && stack.length < 17) {
        const marker = count >= 2 ? '**' : '*';
        if (marker === '*' && count === end - i && before && !/[\s(*]/.test(before)) break;
        stack.push({ marker, parts: [] }); count -= marker.length;
      }
      if (count) append('*'.repeat(count));
      i = end; continue;
    }
    append(s[i++]!);
  }
  // While a response is streaming, unmatched delimiters remain literal. Never
  // emit an opening HTML tag without its closing tag.
  while (stack.length > 1) { const open = stack.pop()!; append(open.marker + open.parts.join('')); }
  return stack[0]!.parts.join('');
}
// A table column is numeric (right-aligned) when every filled cell looks like a number or amount.
const isNum = (c: string) => /^[\s(+−-]*[$S€£¥]*[+−-]?[\d,.]+%?[)\s]*[A-Za-z%]{0,4}$/.test(c.replace(/&[a-z]+;/g, ''));

export function md(src: string): string {
  const lines = esc(src).split('\n');
  let out = '', i = 0;
  const para: string[] = [];
  const flush = () => { if (para.length) { out += `<p>${inline(para.join('<br>'))}</p>`; para.length = 0; } };
  while (i < lines.length) {
    const l = lines[i]!;
    if (/^```/.test(l)) { flush(); const buf: string[] = []; i++; while (i < lines.length && !/^```/.test(lines[i]!)) buf.push(lines[i++]!); i++; out += `<pre><code>${buf.join('\n')}</code></pre>`; continue; }
    if (/^\s*\|.*\|\s*$/.test(l) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1]!)) {
      flush();
      const cells = (r: string) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const head = cells(l); i += 2; const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]!)) rows.push(cells(lines[i++]!));
      const numCol = head.map((_, c) => rows.length > 0 && rows.every((r) => !r[c] || isNum(r[c]!)));
      out += '<div class="agent-table-wrap"><table><thead><tr>' + head.map((c, k) => `<th class="${numCol[k] ? 'num' : ''}">${inline(c)}</th>`).join('') + '</tr></thead><tbody>'
        + rows.map((r) => '<tr>' + head.map((_, k) => `<td class="${numCol[k] ? 'num' : ''}">${inline(r[k] || '')}</td>`).join('') + '</tr>').join('') + '</tbody></table></div>';
      continue;
    }
    const hd = l.match(/^(#{1,3})\s+(.*)$/);
    if (hd) { flush(); out += `<h${hd[1]!.length}>${inline(hd[2]!)}</h${hd[1]!.length}>`; i++; continue; }
    if (/^\s*([-*]|\d+[.)])\s+/.test(l)) {
      flush();
      const ordered = /^\s*\d+[.)]/.test(l); const items: string[] = [];
      while (i < lines.length && /^\s*([-*]|\d+[.)])\s+/.test(lines[i]!)) items.push(lines[i++]!.replace(/^\s*([-*]|\d+[.)])\s+/, ''));
      out += `<${ordered ? 'ol' : 'ul'}>` + items.map((t) => `<li>${inline(t)}</li>`).join('') + `</${ordered ? 'ol' : 'ul'}>`;
      continue;
    }
    if (!l.trim()) { flush(); i++; continue; }
    para.push(l); i++;
  }
  flush();
  return out;
}
