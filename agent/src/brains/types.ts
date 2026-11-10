// Brain plugin contract. An API brain performs ONE model call per step(); the
// chat engine owns the tool loop. A CLI brain (Claude Code, Codex) runs a
// whole turn itself with our tools attached over MCP.
import { z } from 'zod';
import type { Block, Msg, Usage } from '../types.ts';
import { AgentError } from '../types.ts';

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
  pricing: z.object({ inputPerM: z.number().min(0), outputPerM: z.number().min(0), cacheReadPerM: z.number().min(0).optional(), perSearch: z.number().min(0).optional(), longContext: z.object({ aboveTokens: z.number().int().positive(), inputMultiplier: z.number().positive(), outputMultiplier: z.number().positive() }).optional(), offPeak: z.object({ multiplier: z.number().positive(), weekdayPeakUtc: z.array(z.tuple([z.number().min(0).max(24), z.number().min(0).max(24)])).min(1) }).optional(), version: z.string() }),
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
  maxOutputTokens?: number; system: string; messages: Msg[]; tools: ToolSchema[]; signal: AbortSignal; effort?: Effort;
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

/** Peak hours apply on weekdays only. Provider holidays are not modelled, so they price at peak. */
function offPeakMultiplier(p: BrainManifest['pricing'], at: number): number {
  if (!p.offPeak) return 1;
  const d = new Date(at), day = d.getUTCDay(), hour = d.getUTCHours() + d.getUTCMinutes() / 60;
  const peak = day !== 0 && day !== 6 && p.offPeak.weekdayPeakUtc.some(([from, to]) => hour >= from && hour < to);
  return peak ? 1 : p.offPeak.multiplier;
}

export function costOf(m: BrainManifest, u: Usage, searches = 0, at = Date.now()): number {
  const p = m.pricing;
  // inputTokens is the TOTAL prompt size; cached reads/writes are subsets of it.
  const read = u.cacheReadTokens ?? 0, write = u.cacheWriteTokens ?? 0;
  const freshIn = Math.max(0, (u.inputTokens ?? 0) - read - write);
  const tier = p.longContext && (u.inputTokens ?? 0) > p.longContext.aboveTokens ? p.longContext : undefined;
  const inputMultiplier = tier?.inputMultiplier ?? 1, outputMultiplier = tier?.outputMultiplier ?? 1;
  return ((freshIn * p.inputPerM + read * (p.cacheReadPerM ?? p.inputPerM) + write * p.inputPerM * 1.25) * inputMultiplier + (u.outputTokens ?? 0) * p.outputPerM * outputMultiplier) / 1e6 * offPeakMultiplier(p, at)
    + searches * (p.perSearch ?? 0);
}

/** Provider tool-call ids must match ^[A-Za-z0-9_-]+$ for some APIs; normalise once, consistently. */
export const safeId = (id: string): string => id.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64) || 'call';

export type ConnectionFailure = { reason: string; code?: string; syscall?: string };
const CONNECTION_REASONS: [RegExp, string][] = [
  [/^(ENOTFOUND|EAI_)/, 'DNS lookup failed'],
  [/^(ETIMEDOUT|UND_ERR_(CONNECT|HEADERS)_TIMEOUT)$/, 'connection timed out'],
  [/^ECONNREFUSED$/, 'connection refused'],
  [/^(ECONNRESET|EPIPE|UND_ERR_SOCKET)$/, 'connection closed unexpectedly'],
  [/^(ENETUNREACH|EHOSTUNREACH|ENETDOWN|EHOSTDOWN)$/, 'network unreachable'],
  [/^(ERR_TLS_|ERR_SSL_|CERT_|UNABLE_TO_|DEPTH_ZERO|SELF_SIGNED)/, 'TLS handshake failed'],
];
/** Why a request got no HTTP response, from the error's cause chain. Reports only
 * fixed labels and identifier-shaped codes: an Error message can echo request headers. */
export function connectionFailure(error: unknown): ConnectionFailure {
  const queue = [error], seen = new Set<unknown>();
  while (queue.length) {
    const e = queue.shift();
    if (!e || typeof e !== 'object' || seen.has(e)) continue;
    seen.add(e);
    const { code, syscall, cause, errors } = e as { code?: unknown; syscall?: unknown; cause?: unknown; errors?: unknown };
    if (typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,48}$/.test(code)) {
      const reason = CONNECTION_REASONS.find(([pattern]) => pattern.test(code))?.[1] ?? 'network error';
      return { reason, code, ...(typeof syscall === 'string' && /^[a-z_]{1,24}$/.test(syscall) ? { syscall } : {}) };
    }
    queue.push(cause, ...(Array.isArray(errors) ? errors : []));
  }
  return { reason: 'network error with no further detail' };
}
export function unreachable(label: string, error: unknown): AgentError {
  const connection = connectionFailure(error);
  const ids = [connection.code, connection.syscall].filter(Boolean).join(', ');
  return new AgentError('PROVIDER_ERROR', `${label} unreachable: ${connection.reason}${ids ? ` (${ids})` : ''}`, 502, { connection });
}

/** Per-call output bounds never mutate a cached model's default manifest. */
export function outputLimit(manifest: BrainManifest, req: Pick<StepRequest, 'maxOutputTokens'>): number {
  const n = req.maxOutputTokens ?? manifest.maxOutputTokens;
  if (!Number.isSafeInteger(n) || n < 1 || n > manifest.maxOutputTokens) throw Error('Invalid per-call output limit');
  return n;
}
