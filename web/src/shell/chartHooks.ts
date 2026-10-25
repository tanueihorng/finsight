import { api } from '../api/client.ts';
import type { ChartHooks, PriceChartInstance } from '../legacy/chart.d.ts';
import type { History, Position, WatchItem } from '../../../shared/types.ts';
import { selectSymbol } from '../legacy/app.ts';
import { loadChartScripts } from '../legacy/chartScripts.ts';

// Chart host hooks (E2; TypeScript since X1, from public/app.js S20): the
// chart's watch list (holdings + watchlist), trade markers and the
// multi-chart grid (public/chartgrid.js). ChartHost calls these for the main
// chart; the grid calls setupChart for its secondary charts.
interface GridChart extends PriceChartInstance {
  symbol?: string;
  setWatchlist(items: unknown[]): void;
  setTrades(symbol: string, data: unknown): void;
  onTrades?: (symbol: string) => void;
}
interface ChartGridInstance { attach(c: GridChart): void; charts(): GridChart[]; active(): boolean; set(o: { n: number }): void; syncSymbols(): void }
declare global {
  interface Window { ChartGrid?: new (opts: { loader: (s: string, iv: string, range: string) => Promise<History>; onMainSymbol: (s: string) => void; setupChart: (c: GridChart) => void }) => ChartGridInstance }
}

let holdings: Position[] = [], watched: WatchItem[] = [];
const main = () => (window.detailChart ?? null) as GridChart | null;
function watchItems() {
  const seen = new Set<string>(), items: { symbol: string; name?: string; price: number | null | undefined; changePct: number | null | undefined; group: string }[] = [];
  holdings.filter((p) => p.quoted !== false).forEach((p) => { if (seen.has(p.symbol)) return; seen.add(p.symbol); items.push({ symbol: p.symbol, name: p.name, price: p.last, changePct: p.changePct, group: 'Holdings' }); });
  watched.forEach((w) => { if ('error' in w && w.error || seen.has(w.symbol)) return; seen.add(w.symbol); const q = w as { name?: string; price?: number | null; changePct?: number | null }; items.push({ symbol: w.symbol, name: q.name, price: q.price, changePct: q.changePct, group: 'Watchlist' }); });
  return items;
}
export function allCharts(): GridChart[] { return grid && grid.active() ? grid.charts() : (main() ? [main()!] : []); }
export function pushChartWatch() { const items = watchItems(); allCharts().forEach((c) => c.setWatchlist(items)); }
export function setChartHoldings(list: Position[]) { holdings = list; pushChartWatch(); }
export function setChartWatch(list: WatchItem[]) { watched = list || []; pushChartWatch(); }

// Markers are scoped to an account (Phase 2 audit A2): each request carries
// the account and a per-chart token, so a late or A→B→A response is dropped.
const requests = new WeakMap<object, number>();
const account = () => window.FinSight.store.getState().account || '';
export async function loadChartTrades(chart: GridChart, symbol: string) {
  const acct = account(), request = (requests.get(chart) || 0) + 1;
  requests.set(chart, request);
  try {
    const d = await api(`/api/chart-trades?symbol=${encodeURIComponent(symbol)}&account=${encodeURIComponent(acct)}`);
    if (acct !== account() || requests.get(chart) !== request) return;
    chart.setTrades(symbol, d);
  } catch { /* trades are an overlay; the chart works without them */ }
}
function setupChartHost(chart: GridChart) {
  chart.onTrades = (sym) => void loadChartTrades(chart, sym);
  chart.setWatchlist(watchItems());
}
// The grid exists once the chart scripts have loaded; this module asks for
// them first, so the grid is ready before ChartHost creates the main chart.
let grid: ChartGridInstance | null = null;
void loadChartScripts().then(() => {
  if (!window.ChartGrid) return;
  grid = new window.ChartGrid({
    loader: (sym, iv, range) => api<History>(`/api/history?symbol=${encodeURIComponent(sym)}&range=${range}&interval=${iv}`),
    onMainSymbol: (sym) => selectSymbol(sym),
    setupChart: (c) => setupChartHost(c),
  });
}, () => { /* no chart scripts: no grid, as when chartgrid.js failed to load */ });

export const chartHooks: ChartHooks = {
  attached(chart) { setupChartHost(chart as GridChart); grid?.attach(chart as GridChart); },
  loaded() { grid?.syncSymbols(); },
  trades(chart, symbol) { return loadChartTrades(chart as GridChart, symbol); },
  detached() { if (grid?.active()) grid.set({ n: 1 }); },
  repaint() { allCharts().forEach((c) => c.render()); },
};

// The selected symbol can stay the same across accounts: on a switch, clear
// every chart's previous-account overlay (grid charts too) and reload it.
let lastAccount = account();
window.FinSight.store.subscribe((next) => {
  if (next.account === lastAccount) return;
  lastAccount = next.account;
  allCharts().forEach((chart) => {
    if (!chart.symbol) return;
    chart.setTrades(chart.symbol, null);
    void loadChartTrades(chart, chart.symbol);
  });
});
