// Stateless Responses transport. Keep encrypted reasoning with its completed
// output items, bound to the same brain/model/origin; never render it as text.
import type { ApiBrain, BrainManifest, StepRequest, StepResult } from './types.ts';
import { safeId } from './types.ts';
import type { Block, Msg } from '../types.ts';
import { AgentError } from '../types.ts';

type Identity = { brain: string; model: string; origin: string };
export function toResponsesInput(messages: Msg[], identity: Identity): any[] {
  const input: any[] = [];
  for (const m of messages) {
    const extra = m.providerExtra;
    const data = extra?.data as { type?: string; model?: string; origin?: string; output?: any[] } | undefined;
    if (m.role === 'assistant' && extra?.brain === identity.brain && data?.type === 'openai-responses'
      && data.model === identity.model && data.origin === identity.origin && Array.isArray(data.output)) {
      input.push(...data.output); continue;
    }
    if (m.role === 'tool') {
      for (const b of m.blocks) if (b.type === 'tool_result') input.push({ type: 'function_call_output', call_id: safeId(b.callId), output: b.content });
      continue;
    }
    const text = m.blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    if (m.role === 'user') {
      const content: any[] = text ? [{ type: 'input_text', text }] : [];
      for (const b of m.blocks) if (b.type === 'image') content.push({ type: 'input_image', image_url: `data:${b.mime};base64,${b.data}`, detail: 'auto' });
      if (content.length) input.push({ role: 'user', content });
    } else {
      if (text) input.push({ role: 'assistant', content: [{ type: 'output_text', text }] });
      for (const b of m.blocks) if (b.type === 'tool_call') input.push({ type: 'function_call', call_id: safeId(b.id), name: b.name, arguments: JSON.stringify(b.args ?? {}) });
    }
  }
  return input;
}

export function responsesBrain(manifest: BrainManifest, apiKey: string, fetchImpl: typeof fetch = fetch): ApiBrain {
  const url = new URL('responses', (manifest.baseUrl || 'https://api.openai.com/v1').replace(/\/?$/, '/'));
  const identity = { brain: manifest.id, model: manifest.model, origin: url.origin };
  return { kind: 'api', manifest, async step(req: StepRequest): Promise<StepResult> {
    const effort = req.effort ?? manifest.thinking?.default ?? 'none';
    const body = {
      model: manifest.model, instructions: req.system, input: toResponsesInput(req.messages, identity),
      stream: true, store: false, include: ['reasoning.encrypted_content'],
      reasoning: { effort }, max_output_tokens: manifest.maxOutputTokens,
      ...(req.tools.length ? { tools: req.tools.map((t) => ({ type: 'function', name: t.name, description: t.description, parameters: t.parameters, strict: false })), tool_choice: 'auto' } : {}),
    };
    let res: Response;
    try { res = await fetchImpl(url, { method: 'POST', signal: req.signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }, body: JSON.stringify(body) }); }
    catch (e) {
      if (req.signal.aborted || (e as Error).name === 'AbortError') throw e;
      throw new AgentError('PROVIDER_ERROR', `${manifest.label} unreachable: ${(e as Error).message}`, 502);
    }
    if (!res.ok || !res.body) {
      // Provider error bodies can carry request content. Keep them out of chat.
      throw new AgentError(res.status === 429 ? 'PROVIDER_RATE_LIMIT' : res.status >= 500 ? 'PROVIDER_ERROR' : 'PROVIDER_INVALID', `${manifest.label} returned HTTP ${res.status}.`, res.status === 429 ? 429 : 502);
    }
    let terminal: any = null, text = '', buf = '', eventData: string[] = [];
    const decoder = new TextDecoder();
    const dispatch = () => {
      if (!eventData.length) return;
      const raw = eventData.join('\n'); eventData = [];
      if (raw === '[DONE]') return;
      let e: any;
      try { e = JSON.parse(raw); } catch { throw new AgentError('PROVIDER_INVALID', 'Invalid response stream event.', 502); }
      if (e.type === 'response.output_text.delta' && typeof e.delta === 'string') { text += e.delta; req.onText(e.delta); }
      if (e.type === 'error' || e.type === 'response.failed') throw new AgentError('PROVIDER_INVALID', `${manifest.label} could not complete the response.`, 502);
      if (e.type === 'response.completed' || e.type === 'response.incomplete') terminal = e.response;
    };
    const line = (s: string) => { if (!s) dispatch(); else if (s.startsWith('data:')) eventData.push(s.slice(5).trimStart()); };
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      buf += decoder.decode(chunk, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) { line(buf.slice(0, nl).replace(/\r$/, '')); buf = buf.slice(nl + 1); }
    }
    buf += decoder.decode(); if (buf) line(buf.replace(/\r$/, '')); dispatch();
    if (!terminal || !['completed', 'incomplete'].includes(terminal.status)) throw new AgentError('PROVIDER_ERROR', `${manifest.label} stream ended without a completion marker.`, 502);
    const output: any[] = terminal.output ?? [];
    const complete = terminal.status === 'completed';
    const blocks: Block[] = [];
    let finalText = '', refused = false;
    for (const item of output) if (item.type === 'message') for (const c of item.content ?? []) {
      if (c.type === 'output_text') finalText += c.text ?? '';
      if (c.type === 'refusal') refused = true;
    }
    if (!text && finalText) req.onText(finalText);
    if (finalText || text) blocks.push({ type: 'text', text: finalText || text });
    if (complete && !refused) for (const item of output) if (item.type === 'function_call') {
      if (!item.call_id || !item.name) throw new AgentError('PROVIDER_INVALID', 'Incomplete tool call in response.', 502);
      let args: unknown;
      try { args = JSON.parse(item.arguments || '{}'); } catch { args = { __invalid_json: String(item.arguments).slice(0, 2000) }; }
      blocks.push({ type: 'tool_call', id: safeId(item.call_id), name: item.name, args });
    }
    const u = terminal.usage;
    return {
      blocks, usage: { inputTokens: u?.input_tokens ?? null, outputTokens: u?.output_tokens ?? null, cacheReadTokens: u?.input_tokens_details?.cached_tokens ?? null },
      stopReason: !complete ? terminal.incomplete_details?.reason === 'content_filter' ? 'refusal' : 'max_tokens' : refused ? 'refusal' : blocks.some((b) => b.type === 'tool_call') ? 'tool_use' : 'end',
      providerExtra: complete && !refused ? { brain: manifest.id, data: { type: 'openai-responses', model: manifest.model, origin: url.origin, output: output.filter((i) => ['reasoning', 'message', 'function_call'].includes(i.type)).map((i) => i.type === 'function_call' ? { ...i, call_id: safeId(i.call_id) } : i) } } : undefined,
    };
  } };
}
