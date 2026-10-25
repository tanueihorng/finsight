// Kestrel's safe markdown subset (G1), ported 1:1 from public/agent-panel.js.
// Model text is HTML-escaped first; only this whitelisted markup is then
// added, and links must be http(s). The output is safe to set as innerHTML.
export const esc = (s: unknown) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

function inline(s: string): string {
  return s
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>')
    .replace(/\[([^\]\n]{1,200})\]\((https?:\/\/[^\s)]{1,2000})\)/g, (_m, t: string, u: string) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${t}</a>`);
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
