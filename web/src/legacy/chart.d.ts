// The parts of public/chart.js (window.PriceChart) the detail island uses.
// chart.js stays a classic script; it is wrapped, not rewritten (PLAN E2).
import type { HistoryPoint, QuotedQuote } from '../../../shared/types.ts';

export interface ChartLoadContext { range: string; interval: string; visibleFrom: number | null; fetchRange: string }
export interface PriceChartInstance {
  symbol?: string; maxed?: boolean; fit?: boolean; root: HTMLElement; symInput: HTMLInputElement;
  onRequest: ((r: { interval: string }) => void) | null;
  onSymbol: ((symbol: string) => void) | null;
  load(symbol: string, bars: HistoryPoint[], meta: Partial<QuotedQuote>, ctx: ChartLoadContext): void;
  toggleMax(force?: boolean): void;
  resize(): void;
  render(): void;
  destroy(): void;
}
export type PriceChartConstructor = new (root: HTMLElement, opts?: { cfgKey?: string }) => PriceChartInstance;
// Chart hooks that stay in public/app.js with the watch feed (B1) and the multi-chart grid.
export interface ChartHooks {
  attached(chart: PriceChartInstance): void;
  loaded(): void;
  trades(chart: PriceChartInstance, symbol: string): Promise<void>;
  detached(): void;
}
declare global {
  interface Window {
    PriceChart?: PriceChartConstructor;
    detailChart?: PriceChartInstance | null; // read by agent-panel.js and specs
    FinSightChartHooks?: ChartHooks;
  }
}
