// Capacity-aware, deterministic context selection. UTF-8 bytes deliberately
// overestimate text tokens; images use a fixed vision estimate instead of base64 size.
// These are conservative estimates, not provider-specific token counts.
import type { Msg } from '../types.ts';
import { AgentError } from '../types.ts';
import type { BrainManifest, ToolSchema } from '../brains/types.ts';

export const bytes = (value: unknown): number => Buffer.byteLength(JSON.stringify(value) ?? '', 'utf8');
// Image tokens depend on resolution/provider preprocessing, not encoded bytes.
export const IMAGE_CONTEXT_TOKENS = 16_384;
export function contextSize(messages: Msg[]): number {
  let images = 0;
  const withoutPayloads = messages.map((m) => ({ ...m, blocks: m.blocks.map((b) => {
    if (b.type !== 'image') return b;
    images++; return { ...b, data: '' };
  }) }));
  return bytes(withoutPayloads) + images * IMAGE_CONTEXT_TOKENS;
}
export function inputBudget(manifest: BrainManifest, system: string, tools: ToolSchema[]): number {
  return Math.max(0, Math.floor(manifest.capabilities.contextTokens * 0.9) - manifest.maxOutputTokens - bytes(system) - bytes(tools));
}
export function bytePrefix(text: string, maxBytes: number): string {
  let prefix = new TextDecoder().decode(Buffer.from(text).subarray(0, Math.max(0, maxBytes)), { stream: true });
  // JSON escaping (quotes, newlines, controls) also consumes prompt space.
  if (bytes(prefix) <= maxBytes) return prefix;
  let low = 0, high = prefix.length;
  while (low < high) { const mid = Math.ceil((low + high) / 2); if (bytes(prefix.slice(0, mid)) <= maxBytes) low = mid; else high = mid - 1; }
  if (low && /[\uD800-\uDBFF]/.test(prefix[low - 1]!)) low--;
  return prefix.slice(0, low);
}
export function selectContext(messages: Msg[], budget: number, turnStarts?: boolean[]): { messages: Msg[]; omitted: number } {
  // Keep complete user turns. Context/limit notices remain inside the preceding
  // turn, as do all assistant calls and their results; never orphan a tool call.
  const groups: Msg[][] = [];
  for (const [index, m] of messages.entries()) {
    const start = turnStarts?.[index] ?? (m.role === 'user' && m.blocks.some((b) => b.type === 'attachment' || (b.type === 'text' && !b.text.startsWith('[Context snapshot') && !b.text.startsWith('[Turn limit'))));
    if (!groups.length || start) groups.push([]);
    groups[groups.length - 1]!.push(m);
  }
  const latest = groups.pop() ?? [];
  const warning: Msg = { role: 'user', blocks: [{ type: 'text', text: '[Earlier conversation is outside this request’s context. Do not assume it is complete. Use search_memory for past discussion and list_attachments/read_attachment/search_attachments for documents.]' }] };
  let used = contextSize(latest) + bytes(warning);
  if (used > budget) throw new AgentError('CONTEXT_TOO_LARGE', 'The current turn exceeds this model’s context capacity. Start a new chat, use document search/pages, or choose a model with a larger context. Your stored conversation and uploads are retained.');
  const kept = [latest];
  let omitted = 0;
  while (groups.length) {
    const group = groups.pop()!;
    if (used + contextSize(group) > budget) { omitted = groups.reduce((n, g) => n + g.length, group.length); break; }
    kept.unshift(group); used += contextSize(group);
  }
  return { messages: [...(omitted ? [warning] : []), ...kept.flat()], omitted };
}
