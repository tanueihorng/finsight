import { UiRequest, UiSpec, UiView, MAX_UI_BYTES } from '../ui/schema.ts';
import type { ToolCtx, ToolDef } from './registry.ts';
import { AgentError } from '../types.ts';
import { getUiView, saveUiView, newId } from '../store/db.ts';

type Obj = Record<string, unknown>;
export type UiSource = { callId?: string; name: string; data: unknown; completedAt: string; account: string };
export type UiState = { enabled: boolean; attempts: number; completed: Map<string, UiSource> };
const fail = (s: string): never => { throw new AgentError('UI_REJECTED', s); };
function obj(x: unknown): Obj { return x !== null && typeof x === 'object' && !Array.isArray(x) ? x as Obj : fail('Source is not an object'); }
function at(x: unknown, pointer: string): unknown {
  for (const key of pointer.slice(1).split('/')) {
    if (['__proto__', 'prototype', 'constructor'].includes(key) || x == null || typeof x !== 'object' || !Object.hasOwn(x, key)) return fail(`Missing or unsafe source field ${pointer}`);
    x = (x as Obj)[key];
  }
  return x;
}
type Rule = [string, 'text' | 'num' | 'pct' | 'base' | 'native', number?];
const positions: Record<string, Rule> = {
  symbol: ['Symbol', 'text'], name: ['Name', 'text'], currency: ['Quote currency', 'text'], quantity: ['Quantity', 'num', 4],
  avgCost: ['Average cost', 'native'], last: ['Last price', 'native'], marketValue: ['Market value', 'base'], weightPct: ['Weight', 'pct'],
  unrealized: ['Unrealized P/L', 'base'], unrealizedPct: ['Unrealized P/L %', 'pct'], fxPnl: ['FX P/L', 'base'], dayChange: ['Day change', 'base'],
};
const cash: Record<string, Rule> = { ccy: ['Currency', 'text'], amount: ['Native cash', 'native'], base: ['Cash value', 'base'] };
const summaries: Record<string, Rule> = Object.fromEntries(['netWorth', 'securitiesValue', 'cash', 'totalCost', 'unrealized', 'realized'].map((k, i) => [k, [['Net worth (excluding liabilities)', 'Securities value', 'Cash', 'Total cost', 'Unrealized P/L', 'Realized P/L'][i]!, 'base']]));
summaries.positions = ['Positions', 'num', 0];
function rules(name: string, path: string): Record<string, Rule> {
  if (name === 'get_portfolio') { if (path === '/positions') return positions; if (path === '/cash') return cash; if (path === '/summary') return summaries; }
  if (name === 'query_positions') { if (path === '/rows') return positions; if (path === '/totals') return { marketValue: ['Returned holdings value', 'base'], weightPct: ['Returned holdings weight', 'pct'], unrealized: ['Returned holdings P/L', 'base'] }; }
  if (name === 'get_cash') { if (path === '/cash') return cash; if (path === '') return { totalBase: ['Total cash', 'base'] }; }
  if (name === 'get_exposures') { if (path === '') return { total: ['Total exposure', 'base'] }; if (path === '/rows') return { group: ['Group', 'text'], value: ['Exposure value', 'base'], weightPct: ['Weight', 'pct'] }; }
  if (name === 'get_accounts' && path === '/accounts') return { id: ['Account', 'text'], name: ['Name', 'text'], type: ['Type', 'text'], count: ['Positions', 'num', 0] };
  if (name === 'get_quote' && path === '/quotes') return { symbol: ['Symbol', 'text'], name: ['Name', 'text'], currency: ['Quote currency', 'text'], price: ['Price', 'native'], change: ['Change', 'native'], changePct: ['Change', 'pct'], volume: ['Volume', 'num', 0] };
  return fail(`Unsupported source/path: ${name} ${path}`);
}
function cell(row: Obj, key: string, rule: Rule, base: unknown) {
  const value = row[key];
  if (value === undefined || value === null) return { value: null, text: '—' };
  if (rule[1] === 'text') return typeof value === 'string' && value.length <= 120 ? { value, text: value } : fail(`Invalid text ${key}`);
  if (typeof value !== 'number' || !Number.isFinite(value)) return fail(`Invalid number ${key}`);
  const ccy = rule[1] === 'base' ? base : row.currency ?? row.ccy;
  const money = rule[1] === 'base' || rule[1] === 'native';
  if (money && (typeof ccy !== 'string' || !/^[A-Z]{3}$/.test(ccy))) return fail(`Missing currency for ${key}`);
  const digits = rule[2] ?? 2;
  // Do not display a nonzero tiny quote/quantity as an invented zero.
  const tiny = value !== 0 && Math.abs(value) < 10 ** -digits;
  let n = value.toLocaleString('en-US', tiny ? { maximumSignificantDigits: 12 } : { minimumFractionDigits: digits, maximumFractionDigits: digits });
  if (n.length > 120 && tiny) n = String(value); // scientific notation for extreme magnitudes
  return { value, text: money ? `${String(ccy)} ${n}` : rule[1] === 'pct' ? `${n}%` : n };
}
export function bindUi(input: UiRequest, state: UiState): UiSpec {
  const ids = new Set<string>();
  const components: UiSpec['components'] = input.components.map((c) => {
    if (ids.has(c.id)) return fail('Duplicate component id'); ids.add(c.id);
    if (new Set(c.fields).size !== c.fields.length) return fail('Duplicate fields');
    const s = state.completed.get(c.sourceCallId) ?? fail('Source must be a successful supported tool from an earlier step of THIS turn');
    const data = obj(s.data); if (data.error) return fail('Source returned an error');
    const base = s.name === 'get_portfolio' ? obj(data.summary).base : data.base;
    const reportedAccount = s.name === 'get_portfolio' ? obj(data.summary).account : data.account;
    const hasReportedAccount = typeof reportedAccount === 'string' && reportedAccount.length > 0;
    const accountScope = hasReportedAccount ? `Account: ${reportedAccount}` : `Requested account: ${s.account}`;
    const source = { callId: s.callId ?? c.sourceCallId, tool: s.name, asOf: typeof data.asOf === 'string' ? data.asOf : s.completedAt,
      scope: `${accountScope}${typeof base === 'string' ? ` · reporting currency: ${base}` : ''}${typeof data.by === 'string' ? ` · by ${data.by}` : ''}`,
      note: s.name === 'get_portfolio' ? 'Liabilities are not tracked; net worth excludes them.' : s.name === 'get_exposures' ? 'No ETF look-through. ' + String(data.note ?? '') : s.name === 'query_positions' ? `Returned ${String(data.returned)} of ${String(data.matched)} matched positions; totals cover returned positions only.` : '' };
    if (c.kind === 'stat_grid') {
      const items = c.fields.map((field) => {
        const j = field.lastIndexOf('/'), path = field.slice(0, j), key = field.slice(j + 1);
        const rule = rules(s.name, path)[key] ?? fail(`Unsupported field ${field}`);
        if (rule[1] === 'text') return fail('Stats require numeric fields');
        const row = path ? obj(at(data, path)) : data;
        return { field, label: rule[0], cell: cell(row, key, rule, base) };
      });
      return { id: c.id, kind: c.kind, source, items };
    }
    const map = rules(s.name, c.rowsPath), rows = at(data, c.rowsPath);
    if (!Array.isArray(rows)) return fail('rowsPath is not an array');
    const columns = c.fields.map((field) => {
      const key = field.slice(1), rule = map[key] ?? fail(`Unsupported column ${field}`);
      return { field, label: rule[0] };
    });
    const bound = rows.slice(0, c.limit).map((r) => columns.map((col) => { const key = col.field.slice(1); return cell(obj(r), key, map[key]!, base); }));
    return { id: c.id, kind: c.kind, source, columns, rows: bound, shown: bound.length, available: rows.length };
  });
  const fallback = components.map((c) => {
    const lines = c.kind === 'stat_grid' ? c.items.map((i) => `${i.label}: ${i.cell.text}`) : [c.columns.map((i) => i.label).join(' | '), ...c.rows.map((r) => r.map((v) => v.text).join(' | ')), `Showing ${c.shown} of ${c.available} source rows.`];
    return [`Snapshot · ${c.source.tool} · ${c.source.asOf}`, c.source.scope, c.source.note, ...lines].filter(Boolean).join('\n');
  }).join('\n\n');
  const spec = { version: 1, components, fallback };
  if (Buffer.byteLength(JSON.stringify(spec)) > MAX_UI_BYTES) return fail('View exceeds 24 KiB; reduce rows or columns');
  return UiSpec.parse(spec);
}
export const uiTool: ToolDef = {
  name: 'render_ui', input: UiRequest,
  description: 'Show verified stat cards or a sortable table from completed earlier-step get_portfolio/query_positions/get_cash/get_exposures/get_accounts/get_quote results in this turn. Copy sourceCallId from uiSource.ref INSIDE a completed result; never invent it or use a protocol call ID. Choose JSON pointer fields, NOT values or labels. Server binds exact figures and units. No formulas, actions or markup. Prefer prose for short answers.',
  async handler(input, ctx: ToolCtx) {
    if (!ctx.ui?.enabled || !ctx.cfg.uiViews || !ctx.threadId || !ctx.turnId || !ctx.callId || ctx.signal.aborted) return fail('Interactive views are disabled or unavailable on this surface');
    const prior = getUiView(ctx.db, ctx.turnId, ctx.callId);
    if (prior) return { ok: true, uiId: prior.id, fallback: prior.spec.fallback };
    const spec = bindUi(input, ctx.ui);
    const view = UiView.parse({ id: newId('ui'), threadId: ctx.threadId, turnId: ctx.turnId, callId: ctx.callId, createdAt: Date.now(), spec });
    saveUiView(ctx.db, view);
    return { ok: true, uiId: view.id, fallback: spec.fallback };
  },
};
