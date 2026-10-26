// Tool registry: one definition per tool (zod schema + handler) is the single
// source for every surface: the in-process tool loop, the OpenAI-compatible
// and Anthropic function formats, and the MCP server. Nothing is hand-copied.
import { z } from 'zod';
import type { Config } from '../config.ts';
import type { DB } from '../store/db.ts';
import type { CitationBlock } from '../types.ts';
import { AgentError } from '../types.ts';
import type { FinsightClient } from './finsight.ts';
import type { UiState } from './ui.ts';
import { audit } from '../obs/audit.ts';

export type Budget = { searches: number; fetches: number };

export type ToolCtx = {
  cfg: Config; db: DB; finsight: FinsightClient; signal: AbortSignal;
  turnId?: string; threadId?: string; callId?: string; ui?: UiState;
  budget: Budget;               // remaining per-turn allowances, decremented by web tools
  citations: CitationBlock[];   // web tools append; the engine emits them to the panel
  via?: string;                 // 'chat' | 'mcp:<client>' (for the interaction log)
};

export type ToolDef<S extends z.ZodType = z.ZodType<any>> = {
  name: string;
  description: string;
  input: S;
  timeoutMs?: number;
  handler: (input: z.infer<S>, ctx: ToolCtx) => Promise<unknown>;
};

export const MAX_RESULT_CHARS = 30_000; // ≈ 8k tokens: keeps cheap models out of context overflow

export class ToolRegistry {
  private tools = new Map<string, ToolDef>();
  add(...defs: ToolDef[]): this {
    for (const d of defs) {
      if (!/^[a-z][a-z0-9_]{1,48}$/.test(d.name)) throw new Error(`Bad tool name ${d.name}`);
      if (this.tools.has(d.name)) throw new Error(`Duplicate tool ${d.name}`);
      this.tools.set(d.name, d);
    }
    return this;
  }
  get(name: string): ToolDef | undefined { return this.tools.get(name); }
  list(): ToolDef[] { return [...this.tools.values()]; }
  /** JSON Schema for provider function definitions and MCP. */
  schemas(): { name: string; description: string; parameters: Record<string, unknown> }[] {
    return this.list().map((t) => {
      const s = z.toJSONSchema(t.input, { target: 'draft-7' }) as Record<string, unknown>;
      delete s.$schema;
      return { name: t.name, description: t.description, parameters: s };
    });
  }

  async execute(name: string, rawArgs: unknown, ctx: ToolCtx): Promise<{ ok: boolean; content: string }> {
    const t = this.tools.get(name);
    if (!t) return { ok: false, content: JSON.stringify({ error: { code: 'UNKNOWN_TOOL', message: `No tool named ${name}` } }) };
    if (name === 'render_ui') {
      // Count invalid attempts too, before schema parsing. No unbounded repair loop.
      if (!ctx.ui?.enabled || !ctx.cfg.uiViews || ++ctx.ui.attempts > 3) return { ok: false, content: JSON.stringify({ error: { code: 'UI_REJECTED', message: 'Views unavailable or three-attempt limit reached; answer in prose.' } }) };
      if (Buffer.byteLength(JSON.stringify(rawArgs ?? {})) > 24 * 1024) return { ok: false, content: JSON.stringify({ error: { code: 'UI_REJECTED', message: 'Spec exceeds 24 KiB' } }) };
    }
    const parsed = t.input.safeParse(rawArgs ?? {});
    if (!parsed.success) {
      audit('tool.invalid', { tool: name, turnId: ctx.turnId, args: rawArgs, error: z.prettifyError(parsed.error) });
      return { ok: false, content: JSON.stringify({ error: { code: 'TOOL_INPUT_INVALID', message: z.prettifyError(parsed.error) } }) };
    }
    const timeout = t.timeoutMs ?? 30_000;
    let timer: NodeJS.Timeout | undefined;
    const t0 = Date.now();
    const ids = { tool: name, turnId: ctx.turnId, threadId: ctx.threadId, via: ctx.via ?? 'chat' };
    audit('tool.call', { ...ids, args: parsed.data });
    const done = (ok: boolean, content: string) => { audit('tool.result', { ...ids, ok, ms: Date.now() - t0, content }); return { ok, content }; };
    try {
      const result = await Promise.race([
        t.handler(parsed.data, ctx),
        new Promise((_, rej) => { timer = setTimeout(() => rej(new AgentError('TOOL_TIMEOUT', `${name} exceeded ${timeout / 1000}s`)), timeout); }),
      ]);
      return done(true, shape(result));
    } catch (e) {
      const err = e instanceof AgentError ? { code: e.code, message: e.message } : { code: 'TOOL_ERROR', message: String((e as Error)?.message || e) };
      return done(false, JSON.stringify({ error: err }));
    } finally { if (timer) clearTimeout(timer); }
  }
}

function shape(result: unknown): string {
  const s = typeof result === 'string' ? result : JSON.stringify(result);
  if (s.length <= MAX_RESULT_CHARS) return s;
  return s.slice(0, MAX_RESULT_CHARS) + `\n…[TRUNCATED: result was ${s.length} chars; narrow the request (filters, limit) for the rest]`;
}
