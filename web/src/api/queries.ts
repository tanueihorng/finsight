import { useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from './client.ts';
import type { Accounts, Alert, Category, FxRisk, Markets, NewsResponse, Portfolio, WatchItem } from '../../../shared/types.ts';
import type {} from '../bootstrap.ts';

// F4 supplies this source in bootstrap, before legacy startup. Until then hooks
// stay disabled. No speculative request is sent with an uninitialised account.
export interface QueryScope { base: string; account: string; accountReady: boolean }
export interface QueryStateSource {
  getState(): QueryScope;
  subscribe(listener: () => void): () => void;
}
const pending: QueryScope = { base: 'SGD', account: '', accountReady: false };
const subscribeState = (fn: () => void) => window.FinSight.store?.subscribe(fn) ?? (() => {});
const getState = () => window.FinSight.store?.getState() ?? pending;
const subscribeAuth = (fn: () => void) => {
  window.addEventListener('finsight:locked', fn); window.addEventListener('finsight:unlocked', fn);
  return () => { window.removeEventListener('finsight:locked', fn); window.removeEventListener('finsight:unlocked', fn); };
};
const getUnlocked = () => window.FinSight.auth?.unlocked ?? false;
function useScope() {
  const state = useSyncExternalStore(subscribeState, getState);
  const unlocked = useSyncExternalStore(subscribeAuth, getUnlocked);
  return { ...state, enabled: unlocked && state.accountReady };
}
export const queryDefaults = {
  retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false,
  refetchIntervalInBackground: false,
} as const;
export function usePortfolio() {
  const { base, account, enabled } = useScope();
  return useQuery({ queryKey: ['portfolio', base, account], enabled, staleTime: 15_000, refetchInterval: 15_000,
    queryFn: ({ signal }) => api<Portfolio>(`/api/portfolio?base=${encodeURIComponent(base)}&account=${encodeURIComponent(account)}`, { signal }) });
}
export function useMarkets() {
  const { enabled } = useScope();
  return useQuery({ queryKey: ['markets'], enabled, staleTime: 15_000, refetchInterval: 15_000,
    queryFn: ({ signal }) => api<Markets>('/api/markets', { signal }) });
}
export function useWatchlist() {
  const { enabled } = useScope();
  return useQuery({ queryKey: ['watchlist'], enabled, staleTime: 15_000, refetchInterval: 15_000,
    queryFn: ({ signal }) => api<{ watchlist: WatchItem[] }>('/api/watchlist', { signal }) });
}
export function useAlerts() {
  const { enabled } = useScope();
  return useQuery({ queryKey: ['alerts'], enabled, staleTime: 30_000, refetchInterval: 30_000,
    queryFn: ({ signal }) => api<{ alerts: Alert[] }>('/api/alerts', { signal }) });
}
// Legacy loadFxRisk() runs when holdings, cash, account or base change, or at
// most every 2 minutes; mutations invalidate 'fx-risk' for the first case.
export function useFxRisk() {
  const { base, account, enabled } = useScope();
  return useQuery({ queryKey: ['fx-risk', base, account], enabled, staleTime: 120_000, refetchInterval: 120_000,
    queryFn: ({ signal }) => api<FxRisk>(`/api/fx-risk?base=${encodeURIComponent(base)}&account=${encodeURIComponent(account)}`, { signal }) });
}
export function useAccounts() {
  const { enabled } = useScope();
  return useQuery({ queryKey: ['accounts'], enabled, staleTime: 60_000,
    queryFn: ({ signal }) => api<Accounts>('/api/accounts', { signal }) });
}
// Categories change rarely (the server caches them for a day); the key follows
// the held symbols, so a new holding fetches its category.
export function useCategories(symbols: string[]) {
  const { enabled } = useScope();
  const key = [...new Set(symbols)].sort();
  return useQuery({ queryKey: ['categories', key.join(',')], enabled: enabled && key.length > 0, staleTime: Infinity,
    queryFn: ({ signal }) => api<Record<string, Category>>('/api/categories?symbols=' + encodeURIComponent(key.join(',')), { signal }) });
}

// No polling: legacy news fetches only on selection/NEWS and after unlock.
export function useNews(symbol: string) {
  const { enabled } = useScope();
  return useQuery({ queryKey: ['news', symbol], enabled, staleTime: 0,
    queryFn: ({ signal }) => api<NewsResponse>(`/api/news${symbol ? '?symbol=' + encodeURIComponent(symbol) : ''}`, { signal }) });
}

export function useCalendar() {
  const { enabled } = useScope();
  return useQuery({ queryKey: ['calendar'], enabled, staleTime: 900_000, refetchInterval: 900_000,
    queryFn: ({ signal }) => api<import('../../../shared/types.ts').CalendarResponse>('/api/calendar', { signal }) });
}
export function useEvents() {
  const { base, account, enabled } = useScope();
  return useQuery({ queryKey: ['events', base, account], enabled, staleTime: 900_000, refetchInterval: 900_000,
    queryFn: ({ signal }) => api<import('../../../shared/types.ts').EventsResponse>(`/api/events?base=${encodeURIComponent(base)}&account=${encodeURIComponent(account)}`, { signal }) });
}
export function useWorldBank(country: string, indicator: string) {
  const { enabled } = useScope();
  return useQuery({ queryKey: ['worldbank', country, indicator], enabled, staleTime: 900_000, refetchInterval: 900_000,
    queryFn: ({ signal }) => api<import('../../../shared/types.ts').WorldBankResponse>(`/api/worldbank?country=${encodeURIComponent(country)}&indicator=${encodeURIComponent(indicator)}`, { signal }) });
}
export function useFred(series: string, transform: string) {
  const { enabled } = useScope();
  return useQuery({ queryKey: ['fred', series, transform], enabled, staleTime: 900_000, refetchInterval: 900_000,
    queryFn: ({ signal }) => api<import('../../../shared/types.ts').FredResponse>(`/api/fred?series=${encodeURIComponent(series)}&transform=${encodeURIComponent(transform)}`, { signal }) });
}
export function useInflation(requested: boolean) {
  const { enabled } = useScope();
  return useQuery({ queryKey: ['inflation'], enabled: enabled && requested, staleTime: Infinity,
    queryFn: async ({ signal }) => {
      const { INFL_GAUGES } = await import('../features/macro/macro.ts');
      const gauges = await Promise.all(INFL_GAUGES.map((g) => api<import('../../../shared/types.ts').FredResponse>(`/api/fred?series=${g.s}&transform=${g.t}`, { signal }).catch(() => null)));
      const funds = await api<import('../../../shared/types.ts').FredResponse>('/api/fred?series=FEDFUNDS&transform=lin', { signal }).catch(() => null);
      return { gauges, funds };
    } });
}

export function useSearch(text: string) {
  const { enabled } = useScope();
  return useQuery<import('../../../shared/types.ts').SearchItem[]>({ queryKey: ['search', text], enabled: enabled && text.length > 0, staleTime: 0, placeholderData: (previous) => previous,
    queryFn: ({ signal }) => api<import('../../../shared/types.ts').SearchItem[]>('/api/search?q=' + encodeURIComponent(text), { signal }) });
}

export function useDividends() {
  const { base, account, enabled } = useScope();
  return useQuery({ queryKey: ['dividends', base, account], enabled, staleTime: 120_000, refetchInterval: 120_000,
    queryFn: ({ signal }) => api<import('../../../shared/types.ts').DividendsReport>(`/api/dividends?base=${encodeURIComponent(base)}&account=${encodeURIComponent(account)}`, { signal }) });
}
