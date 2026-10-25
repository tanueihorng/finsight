// Typed calls into legacy public/app.js. Its top-level function declarations
// are window properties. Each wrapper goes away when the owning card migrates
// that function (docs/frontend-migration/COUPLING.md §A4).
interface LegacyAppGlobals {
  selectSymbol?: (symbol: string) => void; // E1 turns this into a store write
  blockIfAll?: () => boolean; // refuses trades in the All Accounts view (F8)
}
const legacy = () => window as unknown as LegacyAppGlobals;

export function selectSymbol(symbol: string): void {
  legacy().selectSymbol?.(symbol);
}

// The command status line and footer live in the store since F7.
export function setStatus(msg: string, kind: 'ok' | 'err' | '' = ''): void {
  window.FinSight.store.setState({ status: { msg, kind } });
}

// True (and shows the reason) when the All Accounts view is active.
export function blockIfAll(): boolean {
  return legacy().blockIfAll?.() ?? false;
}

export function setFooter(msg: string): void {
  window.FinSight.store.setState({ footer: msg });
}

// B1 adapter; E2 redirects this to its ChartHost when the chart lane integrates.
export function setChartWatch(list: import('../../../shared/types.ts').WatchItem[]): void {
  const bridge = window as unknown as { FinSightLegacy?: { setChartWatch?: (items: import('../../../shared/types.ts').WatchItem[]) => void } };
  bridge.FinSightLegacy?.setChartWatch?.(list);
}

export function requestNotify(): void {
  (window as unknown as { requestNotify?: () => void }).requestNotify?.();
}
export function publishAlerts(alerts: import('../../../shared/types.ts').Alert[], broadcast = true): void {
  (window as unknown as { __finAlerts: import('../../../shared/types.ts').Alert[] }).__finAlerts = alerts;
  if (broadcast) window.dispatchEvent(new CustomEvent('finsight:alerts', { detail: { alerts, from: 'app' } }));
}
export function subscribeChartAlerts(handler: (alerts: import('../../../shared/types.ts').Alert[]) => void): () => void {
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<{ from?: string; alerts?: import('../../../shared/types.ts').Alert[] }>).detail;
    if (detail?.from === 'chart' && Array.isArray(detail.alerts)) handler(detail.alerts);
  };
  window.addEventListener('finsight:alerts', listener); return () => window.removeEventListener('finsight:alerts', listener);
}
