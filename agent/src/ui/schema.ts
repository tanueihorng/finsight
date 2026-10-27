// Pure shared wire contract: safe to load in the agent and lazy browser chunk.
import { array, boolean, discriminatedUnion, literal, number, object, string, union } from 'zod';
import type { infer as Infer } from 'zod';
export const MAX_UI_BYTES = 24 * 1024;
const short = string().min(1).max(80);
const field = string().regex(/^\/[A-Za-z][A-Za-z0-9]*(?:\/[A-Za-z0-9]+){0,3}$/).max(120);
const base = { id: string().regex(/^[a-z0-9_-]{1,32}$/), sourceCallId: short };
export const UiRequest = object({ version: literal(1), complete: boolean().optional().describe("True only when the accepted view plus preceding text fully answers this request; ends the turn without another model call. Omit or false if more work is needed."), components: array(discriminatedUnion('kind', [
  object({ ...base, kind: literal('stat_grid'), fields: array(field).min(1).max(8) }).strict(),
  object({ ...base, kind: literal('price_chart') }).strict(),
  object({ ...base, kind: literal('table'), rowsPath: field, fields: array(field).min(1).max(8), limit: number().int().min(1).max(50).default(20) }).strict(),
])).min(1).max(4) }).strict();
export const UiCell = object({ value: union([string().max(120), number().finite(), literal(null)]), text: string().max(180) }).strict();
const source = object({ callId: short, tool: short, asOf: string().datetime(), scope: string().max(120), note: string().max(400) }).strict();
const column = object({ field, label: short }).strict();
export const UiSpec = object({ version: literal(1), fallback: string().min(1).max(16000), components: array(discriminatedUnion('kind', [
  object({ id: short, kind: literal('stat_grid'), source, items: array(object({ label: short, field, cell: UiCell }).strict()).min(1).max(8) }).strict(),
  object({ id: short, kind: literal('price_chart'), source, symbol: short, currency: string().regex(/^[A-Z]{3}$/), range: short, interval: short, points: array(object({ time: number().int().min(0), close: number().finite().positive() }).strict()).min(2).max(150) }).strict(),
  object({ id: short, kind: literal('table'), source, columns: array(column).min(1).max(8), rows: array(array(UiCell).max(8)).max(50), shown: number().int().min(0), available: number().int().min(0) }).strict(),
])).min(1).max(4) }).strict();
export const UiView = object({ id: short, threadId: short, turnId: short, callId: short, createdAt: number().int(), spec: UiSpec }).strict();
export type UiView = Infer<typeof UiView>;
export type UiSpec = Infer<typeof UiSpec>;
export type UiRequest = Infer<typeof UiRequest>;
export const UI_GUIDANCE = `Interactive views: for an explicit request for a stock price chart, cards, a visual summary, a table or a sortable comparison of supported facts, use render_ui rather than a Markdown table. Use prose for definitions, yes/no, a single fact, or an explicit text-only request.
For a price chart call get_history with includeBars:true and chartOnly:true, then request {kind:"price_chart", id:"chart", sourceCallId:"ui_source_1"} using the returned actual ref. Charts use the source close prices and are historical snapshots. Fetch an eligible facts tool in an EARLIER step. Copy sourceCallId exactly from uiSource.ref INSIDE its result; never guess it or use a protocol ID/tool name. If that field is absent, narrow/refetch first.
Choose field pointers only; the server supplies all figures, labels and units. Stat grids accept numeric fields (for example /summary/netWorth), never currency strings. Tables use the result's array path (/positions, /rows, /cash, /accounts or /quotes) and relative fields such as /symbol. Table limit is at most50 even if the fetch limit was100; omit limit for the default20.
Set complete:true if the accepted view plus any preceding explanation fully answers the request; this ends the turn without another model call. Omit it if more work is needed. Repair a rejection once or answer in prose; at most3 attempts. Keep prose brief and avoid repeating displayed numbers. Views are dated snapshots, not live prices or financial actions.`;
