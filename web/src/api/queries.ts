import { useSyncExternalStore } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from './client.ts';
import type { Accounts, Alert, Category, FxRisk, History, Ledger, Markets, NewsResponse, Performance, Portfolio, Quote, QuotedQuote, Realized, WatchItem } from '../../../shared/types.ts';
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
// Shared by summary and FX risk: writes invalidate this key; poll every 2 minutes.
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

// The ledger modal's tabs: fetched while their tab is open (legacy reloaded on
// every open and tab switch), refreshed by the 'ledger'/'realized' keys.
export function useLedger(open: boolean) {
  const { base, account, enabled } = useScope();
  return useQuery({ queryKey: ['ledger', base, account], enabled: enabled && open, staleTime: 0,
    queryFn: ({ signal }) => api<Ledger>(`/api/ledger?base=${encodeURIComponent(base)}&account=${encodeURIComponent(account)}`, { signal }) });
}
export function useRealized(open: boolean) {
  const { base, account, enabled } = useScope();
  return useQuery({ queryKey: ['realized', base, account], enabled: enabled && open, staleTime: 0,
    queryFn: ({ signal }) => api<Realized>(`/api/realized?base=${encodeURIComponent(base)}&account=${encodeURIComponent(account)}`, { signal }) });
}

// Legacy refetched performance when the base or the held symbols/quantities
// changed (and after undo/ledger edits, now the 'performance' key). The
// holdings signature in the key keeps that; nothing polls.
export function usePerformance(range: string, benchmark: string, holdings: string) {
  const { base, account, enabled } = useScope();
  return useQuery({ queryKey: ['performance', base, account, range, benchmark, holdings], enabled: enabled && holdings !== '', staleTime: Infinity,
    queryFn: ({ signal }) => api<Performance>(`/api/portfolio/performance?range=${range}&benchmark=${encodeURIComponent(benchmark)}&base=${encodeURIComponent(base)}&account=${encodeURIComponent(account)}`, { signal }) });
}
// Net-worth breakdown: one portfolio per account in view (all of them in All
// Accounts), with categories for the asset-class split. Legacy refreshed it at
// most once a minute and after cash edits ('wealth' key).
export interface WealthInput { id: string; name: string; portfolio: Portfolio }
export function useWealth(accounts: { id: string; name: string }[] | undefined) {
  const { base, account, enabled } = useScope();
  const ids = !accounts ? [] : account === 'ALL' ? accounts.map((a) => a.id) : [account];
  return useQuery({ queryKey: ['wealth', base, account, ids.join(',')], enabled: enabled && ids.length > 0, staleTime: 60_000, refetchInterval: 60_000,
    queryFn: async ({ signal }) => {
      const list = await Promise.all(ids.map(async (id) => ({ id, name: accounts!.find((a) => a.id === id)?.name || id,
        portfolio: await api<Portfolio>(`/api/portfolio?base=${encodeURIComponent(base)}&account=${encodeURIComponent(id)}`, { signal }) })));
      const symbols = [...new Set(list.flatMap((a) => a.portfolio.positions.map((p) => p.symbol)))].sort();
      const categories = symbols.length ? await api<Record<string, Category>>('/api/categories?symbols=' + encodeURIComponent(symbols.join(',')), { signal }).catch(() => ({})) : {};
      return { base, accounts: list as WealthInput[], categories };
    } });
}

// Security detail (E1). Legacy re-read the quote every 30 s while a symbol was
// selected; daily+ history was reused for 5 minutes, intraday re-fetched each
// time. The previous symbol's data stays visible until the new one arrives.
export function useHistory(symbol: string | null, range: string, interval: string) {
  const { enabled } = useScope();
  const every = /m$|h$/.test(interval) ? 30_000 : 300_000;
  return useQuery({ queryKey: ['history', symbol, range, interval], enabled: enabled && !!symbol, staleTime: every, refetchInterval: every,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => api<History>(`/api/history?symbol=${encodeURIComponent(symbol!)}&range=${range}&interval=${interval}`, { signal }) });
}
// A failed quote is not an error: the header falls back to the history meta.
export function useQuote(symbol: string | null) {
  const { enabled } = useScope();
  return useQuery({ queryKey: ['quote', symbol], enabled: enabled && !!symbol, staleTime: 30_000, refetchInterval: 30_000,
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }) => {
      const d = await api<{ quotes: Quote[] }>('/api/quote?symbols=' + encodeURIComponent(symbol!), { signal }).catch(() => null);
      const q = d?.quotes?.[0];
      return q && !q.error ? q as QuotedQuote : null;
    } });
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
