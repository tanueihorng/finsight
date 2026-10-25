import type { Alert, WatchItem } from '../../../shared/types.ts';
import { setChartWatch as feedChart } from '../shell/chartHooks.ts';

// Shell utilities the features share. Until X1 these were typed calls into
// public/app.js; they are TypeScript now and app.js is gone. (The path is
// kept so the feature imports stay unchanged.)
const store = () => window.FinSight.store;

// Selecting a symbol: the detail and news follow store.selected; selecting
// the same symbol again refreshes them.
export function selectSymbol(symbol: string): void {
  store().setState({ selected: symbol });
  void window.FinSight.bus.invalidate('news-selected');
  void window.FinSight.bus.invalidate('detail');
}
// The command status line and footer live in the store (F7).
export function setStatus(msg: string, kind: 'ok' | 'err' | '' = ''): void {
  store().setState({ status: { msg, kind } });
}
export function setFooter(msg: string): void {
  store().setState({ footer: msg });
}
// True (and shows the reason) when the All Accounts view is active.
export function blockIfAll(): boolean {
  if (store().getState().account !== 'ALL') return false;
  setStatus('Switch from "All Accounts" to a specific account to add or trade.', 'err');
  return true;
}
// The watchlist feeds the chart's watch list (B1 → E2 chart hooks), through
// the window.FinSightLegacy.setChartWatch seam that shell/compat.ts installs
// (the B1 spec observes the feed there).
export function setChartWatch(list: WatchItem[]): void {
  const seam = (window as unknown as { FinSightLegacy?: { setChartWatch?: (l: WatchItem[]) => void } }).FinSightLegacy?.setChartWatch;
  (seam ?? feedChart)(list);
}
export function requestNotify(): void {
  if ('Notification' in window && Notification.permission === 'default') { try { void Notification.requestPermission(); } catch { /* unsupported */ } }
}
// Alerts are shared with the chart's alert bell through window.__finAlerts and the finsight:alerts event (B2).
export function publishAlerts(alerts: Alert[], broadcast = true): void {
  (window as unknown as { __finAlerts: Alert[] }).__finAlerts = alerts;
  if (broadcast) window.dispatchEvent(new CustomEvent('finsight:alerts', { detail: { alerts, from: 'app' } }));
}
export function subscribeChartAlerts(handler: (alerts: Alert[]) => void): () => void {
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<{ from?: string; alerts?: Alert[] }>).detail;
    if (detail?.from === 'chart' && Array.isArray(detail.alerts)) handler(detail.alerts);
  };
  window.addEventListener('finsight:alerts', listener); return () => window.removeEventListener('finsight:alerts', listener);
}
