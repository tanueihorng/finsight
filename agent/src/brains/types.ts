// Brain plugin contract. An API brain performs ONE model call per step(); the
// chat engine owns the tool loop. A CLI brain (Claude Code, Codex) runs a
// whole turn itself with our tools attached over MCP.
import { z } from 'zod';
import type { Block, Msg, Usage } from '../types.ts';

export const Effort = z.enum(['none', 'low', 'medium', 'high', 'xhigh', 'max']);
export type Effort = z.infer<typeof Effort>;

export const BrainManifest = z.object({
  apiVersion: z.literal(1),
  kind: z.literal('brain'),
  id: z.string().regex(/^[a-z0-9-]{2,40}$/),
  label: z.string().max(60),
  transport: z.enum(['openai-compatible', 'openai-responses', 'anthropic', 'claude-code', 'mock']),
  model: z.string().max(80),
  baseUrl: z.url().optional(),
  keyRef: z.string().regex(/^[A-Z0-9_]{2,60}$/).optional(),
  pricing: z.object({ inputPerM: z.number().min(0), outputPerM: z.number().min(0), cacheReadPerM: z.number().min(0).optional(), perSearch: z.number().min(0).optional(), longContext: z.object({ aboveTokens: z.number().int().positive(), inputMultiplier: z.number().positive(), outputMultiplier: z.number().positive() }).optional(), version: z.string() }),
  capabilities: z.object({ ui: z.boolean().optional(), tools: z.boolean(), streaming: z.boolean(), nativeSearch: z.boolean().default(false), vision: z.boolean().default(false), contextTokens: z.number().int().positive() }),
  costTier: z.enum(['$', '$$', '$$$']),
  maxOutputTokens: z.number().int().positive().default(8000),
  options: z.record(z.string(), z.unknown()).default({}),
  thinking: z.object({ levels: z.array(Effort).min(2), default: Effort }).refine((t) => t.levels.includes(t.default) && new Set(t.levels).size === t.levels.length, 'Invalid thinking defaults/levels').optional(),
  permissions: z.array(z.string()).max(0).default([]), // brains may not request extra permissions
}).strict();
export type BrainManifest = z.infer<typeof BrainManifest>;

export type ToolSchema = { name: string; description: string; parameters: Record<string, unknown> };

export type StepRequest = {
  system: string; messages: Msg[]; tools: ToolSchema[]; signal: AbortSignal; effort?: Effort;
  onText: (delta: string) => void;
};
export type StepResult = {
  blocks: Block[];                    // text and tool_call blocks (neutral)
  usage: Usage;
  stopReason: 'end' | 'tool_use' | 'max_tokens' | 'refusal' | 'other';
  providerExtra?: { brain: string; data: unknown }; // replayed only to the same brain
  searches?: number;                  // provider-side web searches (billable)
};

export type TurnEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool.started'; name: string; argsSummary: string }
  | { type: 'tool.finished'; name: string; ok: boolean; resultSummary: string; ms?: number };

export type TurnRequest = { system: string; transcript: Msg[]; signal: AbortSignal; onEvent: (e: TurnEvent) => void; maxSteps: number; timeoutMs: number; files?: { name: string; path: string }[] };
export type TurnResult = { text: string; usage: Usage; costUsd: number | null };

export interface ApiBrain { kind: 'api'; manifest: BrainManifest; step(req: StepRequest): Promise<StepResult> }
export interface CliBrain { kind: 'cli'; manifest: BrainManifest; turn(req: TurnRequest): Promise<TurnResult> }
export type Brain = ApiBrain | CliBrain;

export function costOf(m: BrainManifest, u: Usage, searches = 0): number {
  const p = m.pricing;
  // inputTokens is the TOTAL prompt size; cached reads/writes are subsets of it.
  const read = u.cacheReadTokens ?? 0, write = u.cacheWriteTokens ?? 0;
  const freshIn = Math.max(0, (u.inputTokens ?? 0) - read - write);
  const tier = p.longContext && (u.inputTokens ?? 0) > p.longContext.aboveTokens ? p.longContext : undefined;
  const inputMultiplier = tier?.inputMultiplier ?? 1, outputMultiplier = tier?.outputMultiplier ?? 1;
  return ((freshIn * p.inputPerM + read * (p.cacheReadPerM ?? p.inputPerM) + write * p.inputPerM * 1.25) * inputMultiplier + (u.outputTokens ?? 0) * p.outputPerM * outputMultiplier) / 1e6
    + searches * (p.perSearch ?? 0);
}

/** Provider tool-call ids must match ^[A-Za-z0-9_-]+$ for some APIs; normalise once, consistently. */
export const safeId = (id: string): string => id.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64) || 'call';
