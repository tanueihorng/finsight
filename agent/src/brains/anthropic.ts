import { DATE_SUFFIX } from '../chat/prompt.ts';
// Anthropic Messages API adapter (Haiku and other Claude models) via the
// official SDK. The stable prefix (system + tools) is cached; assistant
// content (including thinking blocks) is kept verbatim in providerExtra and
// replayed unchanged to the same brain, as the API requires.
import Anthropic from '@anthropic-ai/sdk';
import type { ApiBrain, BrainManifest, StepRequest, StepResult } from './types.ts';
import { outputLimit, safeId } from './types.ts';
import type { Block, Msg } from '../types.ts';
import { AgentError } from '../types.ts';

export function anthropicSystem(system: string): Anthropic.TextBlockParam[] {
  const at = system.lastIndexOf(DATE_SUFFIX);
  if (at < 0) return [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }];
  return [{ type: 'text', text: system.slice(0, at), cache_control: { type: 'ephemeral' } },
    { type: 'text', text: system.slice(at) }];
}

export function toAnthropicMessages(brainId: string, messages: Msg[]): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];
  for (const m of messages) {
    if (m.role === 'user') {
      const text = m.blocks.filter((b) => b.type === 'text').map((b: any) => b.text).join('\n') || '(empty)';
      const images = m.blocks.filter((b) => b.type === 'image') as { mime: string; data: string }[];
      out.push({ role: 'user', content: images.length
        ? [...images.map((i) => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: i.mime as 'image/png', data: i.data } })), { type: 'text' as const, text }]
        : text });
    } else if (m.role === 'assistant') {
      if (m.providerExtra?.brain === brainId && Array.isArray(m.providerExtra.data)) { out.push({ role: 'assistant', content: m.providerExtra.data as any }); continue; }
      const content: any[] = [];
      for (const b of m.blocks) {
        if (b.type === 'text' && b.text) content.push({ type: 'text', text: b.text });
        if (b.type === 'tool_call') content.push({ type: 'tool_use', id: safeId(b.id), name: b.name, input: (b.args && typeof b.args === 'object') ? b.args : {} });
      }
      out.push({ role: 'assistant', content: content.length ? content : [{ type: 'text', text: '(no content)' }] });
    } else {
      const results = m.blocks.filter((b) => b.type === 'tool_result').map((b: any) => ({ type: 'tool_result' as const, tool_use_id: safeId(b.callId), content: b.content, is_error: !b.ok }));
      if (results.length) out.push({ role: 'user', content: results });
    }
  }
  return out;
}

export function anthropicBrain(manifest: BrainManifest, apiKey: string): ApiBrain {
  const client = new Anthropic({ apiKey, maxRetries: 2 });
  return {
    kind: 'api', manifest,
    async step(req: StepRequest): Promise<StepResult> {
      const tools: Anthropic.Tool[] = req.tools.map((t, i) => ({
        name: t.name, description: t.description, input_schema: t.parameters as Anthropic.Tool.InputSchema,
        eager_input_streaming: true,
        ...(i === req.tools.length - 1 ? { cache_control: { type: 'ephemeral' as const } } : {}),
      }));
      const stream = client.messages.stream({
        model: manifest.model,
        max_tokens: outputLimit(manifest, req),
        system: anthropicSystem(req.system),
        tools,
        messages: toAnthropicMessages(manifest.id, req.messages),
        ...(manifest.options as object),
      }, { signal: req.signal });
      stream.on('text', (d) => req.onText(d));
      let msg: Anthropic.Message;
      try { msg = await stream.finalMessage(); }
      catch (e) {
        if (e instanceof Anthropic.RateLimitError) throw new AgentError('PROVIDER_RATE_LIMIT', `${manifest.label}: rate limited`, 429);
        if (e instanceof Anthropic.AuthenticationError) throw new AgentError('PROVIDER_INVALID', `${manifest.label}: invalid API key`, 502);
        if (e instanceof Anthropic.BadRequestError) throw new AgentError('PROVIDER_INVALID', `${manifest.label}: ${e.message}`, 502);
        if (e instanceof Anthropic.APIError) throw new AgentError('PROVIDER_ERROR', `${manifest.label}: ${e.message}`, 502);
        throw e;
      }
      const blocks: Block[] = [];
      for (const c of msg.content) {
        if (c.type === 'text') blocks.push({ type: 'text', text: c.text });
        if (c.type === 'tool_use') blocks.push({ type: 'tool_call', id: c.id, name: c.name, args: c.input });
      }
      const stop = msg.stop_reason;
      // A refusal or max_tokens can cut a tool_use off mid-input: never run those calls.
      const safeBlocks = stop === 'refusal' || stop === 'max_tokens' ? blocks.filter((b) => b.type !== 'tool_call') : blocks;
      return {
        blocks: safeBlocks,
        usage: { inputTokens: msg.usage.input_tokens + (msg.usage.cache_read_input_tokens ?? 0) + (msg.usage.cache_creation_input_tokens ?? 0),
          outputTokens: msg.usage.output_tokens, cacheReadTokens: msg.usage.cache_read_input_tokens ?? 0, cacheWriteTokens: msg.usage.cache_creation_input_tokens ?? 0 },
        stopReason: stop === 'tool_use' && safeBlocks.some((b) => b.type === 'tool_call') ? 'tool_use' : stop === 'max_tokens' ? 'max_tokens' : stop === 'refusal' ? 'refusal' : 'end',
        providerExtra: stop === 'refusal' ? undefined : { brain: manifest.id, data: msg.content },
      };
    },
  };
}
