// Kestrel wording and small formatters (G1/G2), ported from public/agent-panel.js.
export const LS = { open: 'finsight-agent-open', width: 'finsight-agent-w', thread: 'finsight-agent-thread', brain: 'finsight-agent-brain', ctx: 'finsight-agent-ctx', mode: 'finsight-agent-mode', dockH: 'finsight-agent-dock-h', collapsed: 'finsight-agent-collapsed' } as const;
export const ls = {
  get(k: string, d: string) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch { return d; } },
  set(k: string, v: string | number) { try { localStorage.setItem(k, String(v)); } catch { /* private mode */ } },
};
export const WIDTHS = [360, 440, 560, 720];
export const DEFAULT_W = 440, DEFAULT_H = 560;
export const clampWidth = (w: number, innerWidth: number) => Math.max(320, Math.min(Math.max(320, Math.round(innerWidth * 0.6)), Math.round(w)));
export const clampHeight = (px: number, innerHeight: number) => Math.max(300, Math.min(Math.round(innerHeight * 0.92), Math.round(px)));
// The ↔ button: the next preset wider than now that fits, else the smallest.
export const nextWidth = (cur: number, max: number) => WIDTHS.find((w) => w > cur + 10 && w <= max) ?? WIDTHS[0]!;

export const VERBS = ['Crunching numbers', 'Reading the tape', 'Consulting the ledger', 'Squinting at filings', 'Pricing it in', 'Checking the 200-day',
  'Marking to market', 'Counting basis points', 'Asking the bond market', 'Tallying dividends', 'Hedging my words', 'Sniffing out the catalyst',
  'Rebalancing thoughts', 'Reconciling the books', 'Scanning for setups', 'Weighing the evidence', 'Discounting cash flows', 'Waiting for the close'];
export const TOOL_VERBS: Record<string, string> = { get_portfolio: 'Opening the portfolio', query_positions: 'Sorting positions', get_exposures: 'Measuring exposure', get_cash: 'Counting cash',
  run_strategy: 'Running the strategy', scan_strategies: 'Scanning for setups', size_position: 'Sizing the position', web_search: 'Searching the web',
  fetch_url: 'Reading the page', edgar_filings: 'Pulling SEC filings', edgar_financials: 'Reading the financials', get_history: 'Charting the history',
  get_events: 'Checking the calendar', get_policy: 'Re-reading the policy', use_skill: 'Opening the playbook', get_news: 'Reading the headlines' };
export const randomVerb = () => VERBS[Math.floor(Math.random() * VERBS.length)]!;
export const COMMANDS = [
  { k: '/new', v: 'start a new chat' }, { k: '/model', v: 'switch model: /model deepseek-pro' }, { k: '/cost', v: 'spend today (/cost month)' },
  { k: '/strategies', v: 'list the strategy library' }, { k: '/skills', v: 'list installed skills' }, { k: '/logs', v: 'recent errors from the interaction log' }, { k: '/help', v: 'what I can do' },
];

export const prettyTool = (n: string | undefined) => String(n || 'tool').replace(/^mcp__finsight__/, '');
export function prettyArgs(s: string | undefined): string {
  if (!s) return '()';
  try { const o = JSON.parse(s) as Record<string, unknown>; return `(${Object.entries(o).map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join(', ').slice(0, 90)})`; }
  catch { return `(${String(s).slice(0, 90)})`; }
}
export const took = (ms: number | null | undefined) => (ms == null ? '' : ms < 1000 ? ` · ${ms} ms` : ` · ${(ms / 1000).toFixed(1)} s`);
export const costLabel = (usd: number) => `$${Number(usd).toFixed(usd < 0.01 ? 4 : 3)}`;
export const friendly = (code?: string, msg?: string) => (code === 'FINSIGHT_DOWN' ? 'FinSight data is unreachable right now.' : msg || code || 'Something went wrong.');

export interface PageContext { symbol?: string; account?: string; base?: string; timeframe?: string; strategy?: string; view: 'terminal' }
export function ctxLabel(pc: PageContext | string | undefined): string {
  try { const c = (typeof pc === 'string' ? JSON.parse(pc) : pc) as PageContext; return [c.symbol && `@${c.symbol}`, c.timeframe, c.strategy && `strategy ${c.strategy}`].filter(Boolean).join(' · '); } catch { return ''; }
}
export const ctxButton = (on: boolean, c: PageContext) => (on ? `◉ ${[c.symbol, c.timeframe].filter(Boolean).join(' ') || 'page'}` : '○ no context');
export function suggestions(c: PageContext): string[] {
  const list = ['How is my portfolio doing today, and what moved it?', 'What is my currency and sector exposure?', '/strategy-scan any live setups in my holdings?'];
  if (c.symbol) list.unshift(`What do my strategies say about ${c.symbol} right now?`);
  list.push('What earnings or dividends are coming up for my holdings?');
  return list.slice(0, 4);
}
export const OFFLINE_WHY: Record<string, (s: { logFile?: string }) => [string, string]> = {
  'not-installed': () => ['The agent is not installed yet. In the finsight folder run:', 'npm run agent:install'],
  disabled: () => ['The agent is turned off (AGENT_AUTOSTART=0).', ''],
  crashed: (s) => ['The agent keeps crashing. Details are in its log:', s.logFile || 'agent.log'],
};
export function offlineWhy(name: string, st: { status?: string; logFile?: string }): { why: [string, string]; starting: boolean } {
  const starting = st.status === 'running' || st.status === 'restarting';
  const known = st.status ? OFFLINE_WHY[st.status] : undefined;
  return { starting, why: known ? known(st) : starting ? [`${name} is starting…`, ''] : ['The agent is not reachable.', st.logFile ? `log: ${st.logFile}` : ''] };
}
