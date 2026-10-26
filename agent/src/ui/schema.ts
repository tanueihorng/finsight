// Pure shared wire contract: safe to load in the agent and lazy browser chunk.
import { array, discriminatedUnion, literal, number, object, string, union } from 'zod';
import type { infer as Infer } from 'zod';
export const MAX_UI_BYTES = 24 * 1024;
const short = string().min(1).max(80);
const field = string().regex(/^\/[A-Za-z][A-Za-z0-9]*(?:\/[A-Za-z0-9]+){0,3}$/).max(120);
const base = { id: string().regex(/^[a-z0-9_-]{1,32}$/), sourceCallId: short };
export const UiRequest = object({ version: literal(1), components: array(discriminatedUnion('kind', [
  object({ ...base, kind: literal('stat_grid'), fields: array(field).min(1).max(8) }).strict(),
  object({ ...base, kind: literal('table'), rowsPath: field, fields: array(field).min(1).max(8), limit: number().int().min(1).max(50).default(20) }).strict(),
])).min(1).max(4) }).strict();
export const UiCell = object({ value: union([string().max(120), number().finite(), literal(null)]), text: string().max(180) }).strict();
const source = object({ callId: short, tool: short, asOf: string().datetime(), scope: string().max(120), note: string().max(400) }).strict();
const column = object({ field, label: short }).strict();
export const UiSpec = object({ version: literal(1), fallback: string().min(1).max(16000), components: array(discriminatedUnion('kind', [
  object({ id: short, kind: literal('stat_grid'), source, items: array(object({ label: short, field, cell: UiCell }).strict()).min(1).max(8) }).strict(),
  object({ id: short, kind: literal('table'), source, columns: array(column).min(1).max(8), rows: array(array(UiCell).max(8)).max(50), shown: number().int().min(0), available: number().int().min(0) }).strict(),
])).min(1).max(4) }).strict();
export const UiView = object({ id: short, threadId: short, turnId: short, callId: short, createdAt: number().int(), spec: UiSpec }).strict();
export type UiView = Infer<typeof UiView>;
export type UiSpec = Infer<typeof UiSpec>;
export type UiRequest = Infer<typeof UiRequest>;
export const UI_GUIDANCE = `Interactive views are optional. Prefer prose for short answers. For several KPIs or rows, fetch supported facts in an EARLIER model step, then call render_ui. Only get_portfolio, query_positions, get_cash, get_exposures, get_accounts and get_quote are supported. Use JSON pointer fields, never copied numbers, labels, units or formulas. Server-generated labels, values, currencies, snapshot scope and fallback come from the source. Example: after get_portfolio call p1, render_ui({version:1,components:[{id:"overview",kind:"stat_grid",sourceCallId:"p1",fields:["/summary/netWorth","/summary/cash"]},{id:"holdings",kind:"table",sourceCallId:"p1",rowsPath:"/positions",fields:["/symbol","/marketValue","/weightPct"],limit:10}]}). Tables support /positions or /cash for get_portfolio, /rows for query_positions or get_exposures, /cash for get_cash, /accounts for get_accounts, /quotes for get_quote. Maximum three attempts per turn. If rejected, repair once or answer in prose; repairs use normal model tokens and latency. Keep accompanying prose brief. Views are historical snapshots, never live prices or instructions.`;
