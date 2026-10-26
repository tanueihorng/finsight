// OpenAI-compatible chat-completions adapter (DeepSeek, GLM, and any other
// provider that speaks this format). Streams text and tool-call deltas.
import type { ApiBrain, BrainManifest, StepRequest, StepResult, ToolSchema } from './types.ts';
import { safeId } from './types.ts';
import type { Block, Msg } from '../types.ts';
import { AgentError } from '../types.ts';

type Identity = { brain: string; model: string; origin: string };
export function toOpenAiMessages(system: string, messages: Msg[], identity?: Identity): any[] {
  const out: any[] = [{ role: 'system', content: system }];
  for (const m of messages) {
    if (m.role === 'user') {
      const text = m.blocks.filter((b) => b.type === 'text').map((b: any) => b.text).join('\n');
      const images = m.blocks.filter((b) => b.type === 'image') as { mime: string; data: string }[];
      out.push({ role: 'user', content: images.length
        ? [{ type: 'text', text: text || '(see image)' }, ...images.map((i) => ({ type: 'image_url', image_url: { url: `data:${i.mime};base64,${i.data}` } }))]
        : text });
    } else if (m.role === 'assistant') {
      const text = m.blocks.filter((b) => b.type === 'text').map((b: any) => b.text).join('');
      const calls = m.blocks.filter((b) => b.type === 'tool_call').map((b: any) => ({ id: safeId(b.id), type: 'function', function: { name: b.name, arguments: JSON.stringify(b.args ?? {}) } }));
      const extra = m.providerExtra;
      const data = extra?.data as { type?: string; model?: string; origin?: string; reasoning_content?: unknown } | undefined;
      const same = identity?.origin === 'https://api.deepseek.com' && extra?.brain === identity.brain
        && data?.type === 'deepseek-reasoning' && data.model === identity.model && data.origin === identity.origin;
      out.push({ role: 'assistant', content: text || (calls.length ? null : ''), ...(calls.length ? { tool_calls: calls } : {}),
        ...(identity?.origin === 'https://api.deepseek.com' ? { reasoning_content: same && typeof data?.reasoning_content === 'string' ? data.reasoning_content : '' } : {}) });
    } else {
      for (const b of m.blocks) if (b.type === 'tool_result') out.push({ role: 'tool', tool_call_id: safeId(b.callId), content: b.content });
    }
  }
  return out;
}

const toTools = (tools: ToolSchema[]) => tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));

export function openAiBrain(manifest: BrainManifest, apiKey: string, fetchImpl: typeof fetch = fetch): ApiBrain {
  const url = new URL('chat/completions', (manifest.baseUrl || 'https://api.openai.com/v1').replace(/\/?$/, '/'));
  return {
    kind: 'api', manifest,
    async step(req: StepRequest): Promise<StepResult> {
      // OpenAI's newer models reject max_tokens; compatible providers such as
      // DeepSeek still use it. Keep this a transport detail, not a UI setting.
      const openai = url.hostname === 'api.openai.com';
      const options = { ...manifest.options };
      delete options.max_tokens; delete options.max_completion_tokens;
      const body = {
        model: manifest.model, stream: true, stream_options: { include_usage: true },
        ...(openai ? { max_completion_tokens: manifest.maxOutputTokens } : { max_tokens: manifest.maxOutputTokens }),
        messages: toOpenAiMessages(req.system, req.messages, { brain: manifest.id, model: manifest.model, origin: url.origin }),
        ...(req.tools.length ? { tools: toTools(req.tools), tool_choice: 'auto' } : {}),
        ...options,
      };
      let res: Response;
      try {
        res = await fetchImpl(url, { method: 'POST', signal: req.signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }, body: JSON.stringify(body) });
      } catch (e) {
        if ((e as Error).name === 'AbortError') throw e;
        throw new AgentError('PROVIDER_ERROR', `${manifest.label} unreachable: ${(e as Error).message}`, 502);
      }
      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => '');
        const code = res.status === 429 ? 'PROVIDER_RATE_LIMIT' : res.status >= 500 ? 'PROVIDER_ERROR' : 'PROVIDER_INVALID';
        throw new AgentError(code, `${manifest.label} returned ${res.status}: ${text.slice(0, 300)}`, res.status === 429 ? 429 : 502);
      }
      let text = '', reasoning = '', finish: string | null = null;
      const calls = new Map<number, { id: string; name: string; args: string }>();
      let usage: any = null;
      const decoder = new TextDecoder(); let buf = '';
      const onLine = (line: string) => {
        if (!line.startsWith('data:')) return;
        const data = line.slice(5).trim();
        if (data === '[DONE]') return;
        let j: any; try { j = JSON.parse(data); } catch { return; }
        if (j.usage) usage = j.usage;
        const ch = j.choices?.[0]; if (!ch) return;
        const d = ch.delta || {};
        if (url.hostname === 'api.deepseek.com' && typeof d.reasoning_content === 'string') reasoning += d.reasoning_content;
        if (typeof d.content === 'string' && d.content) { text += d.content; req.onText(d.content); }
        for (const tc of d.tool_calls || []) {
          const cur = calls.get(tc.index) ?? { id: '', name: '', args: '' };
          if (tc.id) cur.id = tc.id;
          if (tc.function?.name) cur.name += tc.function.name;
          if (tc.function?.arguments) cur.args += tc.function.arguments;
          calls.set(tc.index, cur);
        }
        if (ch.finish_reason) finish = ch.finish_reason;
      };
      for await (const chunk of res.body as any as AsyncIterable<Uint8Array>) {
        buf += decoder.decode(chunk, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf('\n')) !== -1) {
          const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
          onLine(line);
        }
      }
      buf += decoder.decode();
      if (buf.trim()) onLine(buf.trim());
      if (finish === null) throw new AgentError('PROVIDER_ERROR', `${manifest.label} stream ended without a completion marker.`, 502);
      const blocks: Block[] = [];
      if (text) blocks.push({ type: 'text', text });
      const incomplete = finish === 'length' || finish === 'content_filter';
      for (const [i, c] of [...(incomplete ? new Map() : calls).entries()].sort((a, b) => a[0] - b[0])) {
        let args: unknown = {};
        try { args = c.args ? JSON.parse(c.args) : {}; } catch { args = { __invalid_json: c.args.slice(0, 2000) }; }
        blocks.push({ type: 'tool_call', id: c.id || `call_${i}_${Date.now()}`, name: c.name, args });
      }
      return {
        blocks,
        usage: { inputTokens: usage?.prompt_tokens ?? null, outputTokens: usage?.completion_tokens ?? null, cacheReadTokens: usage?.prompt_cache_hit_tokens ?? usage?.prompt_tokens_details?.cached_tokens ?? null },
        stopReason: finish === 'length' ? 'max_tokens' : finish === 'content_filter' ? 'refusal' : calls.size ? 'tool_use' : 'end',
        providerExtra: url.hostname === 'api.deepseek.com' && !incomplete ? { brain: manifest.id, data: { type: 'deepseek-reasoning', model: manifest.model, origin: url.origin, reasoning_content: reasoning } } : undefined,
      };
    },
  };
}
