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
    if (c.kind !== 'price_chart' && new Set(c.fields).size !== c.fields.length) return fail('Duplicate fields');
    const s = state.completed.get(c.sourceCallId) ?? fail('Source must be a successful supported tool from an earlier step of THIS turn');
    const data = obj(s.data); if (data.error) return fail('Source returned an error');
    const base = s.name === 'get_portfolio' ? obj(data.summary).base : data.base;
    const reportedAccount = s.name === 'get_portfolio' ? obj(data.summary).account : data.account;
    const hasReportedAccount = typeof reportedAccount === 'string' && reportedAccount.length > 0;
    const accountScope = hasReportedAccount ? `Account: ${reportedAccount}` : `Requested account: ${s.account}`;
    const source = { callId: s.callId ?? c.sourceCallId, tool: s.name, asOf: typeof data.asOf === 'string' ? data.asOf : s.completedAt,
      scope: `${accountScope}${typeof base === 'string' ? ` · reporting currency: ${base}` : ''}${typeof data.by === 'string' ? ` · by ${data.by}` : ''}`,
      note: s.name === 'get_portfolio' ? 'Liabilities are not tracked; net worth excludes them.' : s.name === 'get_exposures' ? 'No ETF look-through. ' + String(data.note ?? '') : s.name === 'query_positions' ? `Returned ${String(data.returned)} of ${String(data.matched)} matched positions; totals cover returned positions only.` : '' };
    if (c.kind === 'price_chart') {
      if (s.name !== 'get_history') return fail('Price chart requires a get_history source');
      if (typeof data.symbol !== 'string' || !/^[A-Za-z0-9.^=_-]{1,24}$/.test(data.symbol)) return fail('Invalid history symbol');
      if (typeof data.currency !== 'string' || !/^[A-Z]{3}$/.test(data.currency)) return fail('History currency unavailable');
      if (typeof data.range !== 'string' || typeof data.interval !== 'string' || !Array.isArray(data.ohlcv) || data.ohlcv.length < 2 || data.ohlcv.length > 150) return fail('Price chart requires 2–150 history bars; use includeBars:true');
      let previous = -1;
      const points = data.ohlcv.map((bar: unknown) => {
        const row = obj(bar), time = row.t, close = row.c;
        if (typeof time !== 'number' || !Number.isSafeInteger(time) || time < 0 || time > 8640000000000000 || time <= previous || typeof close !== 'number' || !Number.isFinite(close) || close <= 0) return fail('Invalid or unordered history bars');
        previous = time; return { time, close };
      });
      return { id: c.id, kind: c.kind, source: { ...source, scope: `${data.symbol} · ${data.currency} · ${data.range} · ${data.interval}`, note: `Source: FinSight /api/history (Yahoo). Historical close prices; snapshot, not a live quote. Showing ${points.length} sampled of ${typeof data.bars === 'number' ? data.bars : points.length} source bars.` }, symbol: data.symbol, currency: data.currency, range: data.range, interval: data.interval, points };
    }
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
    const lines = c.kind === 'price_chart' ? [`${c.symbol} close prices (${c.currency}), ${c.points.length} points`, ...c.points.map((p) => `${new Date(p.time).toISOString()}: ${p.close}`)] : c.kind === 'stat_grid' ? c.items.map((i) => `${i.label}: ${i.cell.text}`) : [c.columns.map((i) => i.label).join(' | '), ...c.rows.map((r) => r.map((v) => v.text).join(' | ')), `Showing ${c.shown} of ${c.available} source rows.`];
    return [`Snapshot · ${c.source.tool} · ${c.source.asOf}`, c.source.scope, c.source.note, ...lines].filter(Boolean).join('\n');
  }).join('\n\n');
  const spec = { version: 1, components, fallback };
  if (Buffer.byteLength(JSON.stringify(spec)) > MAX_UI_BYTES) return fail('View exceeds 24 KiB; reduce rows or columns');
  return UiSpec.parse(spec);
}
export const uiTool: ToolDef = {
  name: 'render_ui', input: UiRequest,
  description: 'Render interactive stock price charts, stat cards or a sortable table for explicit requests. For a price_chart, first call get_history with includeBars:true and chartOnly:true and use its uiSource.ref. Sources: completed earlier-step get_portfolio, query_positions, get_cash, get_exposures, get_accounts or get_quote. Copy sourceCallId from result.uiSource.ref. Choose field pointers; server binds figures, labels and units. Table limit max50 (default20). complete:true finishes an answered request. No formulas, actions or markup.',
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
