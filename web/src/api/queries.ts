import { useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from './client.ts';
import type { Alert, FxRisk, Markets, Portfolio, WatchItem } from '../../../shared/types.ts';
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
