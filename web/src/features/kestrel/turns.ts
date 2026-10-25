// One assistant turn as data (G1): ordered parts (text segments, tool rows,
// notices), citations and meta. Pure updates, ported from agent-panel.js turnView.
import type { Citation } from './api.ts';
import { prettyTool, took } from './labels.ts';

export type Part =
  | { kind: 'text'; text: string; open: boolean }
  | { kind: 'tool'; key: string; name: string; args: string; state: 'running' | 'ok' | 'err'; res: string; detail: string }
  | { kind: 'notice'; text: string; cls: string };
export interface Meta { label?: string; costUsd?: number | null; ms?: number | null }
export interface Turn { id: string; label: string; parts: Part[]; cites: Citation[]; meta: Meta | null; allText: string }
export const newTurn = (id: string): Turn => ({ id, label: '', parts: [], cites: [], meta: null, allText: '' });

const closeText = (parts: Part[]) => parts.map((p) => (p.kind === 'text' && p.open ? { ...p, open: false } : p));
export function addText(t: Turn, delta: string): Turn {
  const last = t.parts[t.parts.length - 1];
  const parts = last?.kind === 'text' && last.open
    ? [...t.parts.slice(0, -1), { ...last, text: last.text + delta }]
    : [...t.parts, { kind: 'text' as const, text: delta, open: true }];
  return { ...t, parts, allText: t.allText + delta };
}
export const endSegment = (t: Turn): Turn => ({ ...t, parts: closeText(t.parts) });
export function addTool(t: Turn, callId: string | undefined, name: string, args: string | undefined): Turn {
  const tools = t.parts.filter((p) => p.kind === 'tool').length;
  return { ...t, parts: [...closeText(t.parts), { kind: 'tool', key: callId || name + tools, name: prettyTool(name), args: args || '', state: 'running', res: 'running…', detail: `input: ${args || '{}'}` }] };
}
// Match by call id, else the latest running row with the same tool name.
export function toolDone(t: Turn, callId: string | undefined, name: string, ok: boolean, summary: string | undefined, ms: number | null | undefined): Turn {
  let i = t.parts.findIndex((p) => p.kind === 'tool' && p.key === callId);
  if (i < 0) for (let k = t.parts.length - 1; k >= 0; k--) { const p = t.parts[k]!; if (p.kind === 'tool' && p.state === 'running' && p.name === prettyTool(name)) { i = k; break; } }
  if (i < 0) return t;
  const p = t.parts[i] as Extract<Part, { kind: 'tool' }>;
  const next = { ...p, state: ok ? 'ok' as const : 'err' as const, res: `${ok ? (summary || 'done') : (summary || 'failed')}${took(ms)}`, detail: summary ? `${p.detail}\nresult: ${summary}` : p.detail };
  return { ...t, parts: t.parts.map((x, k) => (k === i ? next : x)) };
}
// Only http(s) sources, once each.
export function addCite(t: Turn, c: Citation): Turn {
  if (!/^https?:/i.test(c.url) || t.cites.some((x) => x.url === c.url)) return t;
  return { ...t, cites: [...t.cites, c] };
}
export const addNotice = (t: Turn, text: string, cls: string): Turn => ({ ...t, parts: [...closeText(t.parts), { kind: 'notice', text, cls }] });
export const finish = (t: Turn, meta: Meta): Turn => ({ ...endSegment(t), meta });
export function citeHost(url: string): string { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } }
