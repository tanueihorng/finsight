const holdings = ['portfolio', 'dividends', 'fx-risk', 'performance', 'wealth', 'ledger', 'realized', 'accounts', 'chart-trades', 'events'] as const;
const scoped = [...holdings, 'alerts', 'detail'] as const;
// Endpoint writes -> readers. I1 will inventory every legacy caller before pilots.
export const mutationInvalidations = {
  buy: holdings, sell: holdings, delete: holdings, import: holdings, undo: holdings,
  'ledger-edit': holdings, 'ledger-delete': holdings, reset: holdings,
  cash: ['portfolio', 'fx-risk', 'wealth'],
  'watchlist-add': ['watchlist', 'chart-watch'], 'watchlist-remove': ['watchlist', 'chart-watch'],
  'alerts-add': ['alerts', 'chart-alerts'], 'alerts-update': ['alerts', 'chart-alerts'], 'alerts-remove': ['alerts', 'chart-alerts'],
  'account-add': ['accounts', ...scoped.filter((key) => key !== 'accounts')],
  'account-rename': scoped, 'account-remove': scoped, 'account-switch': scoped,
  base: scoped,
} as const;

type Refresher = () => unknown;
export function createBus() {
  const listeners = new Map<string, Set<Refresher>>();
  let query: ((key: string) => unknown) | undefined;
  return {
    // One QueryClient connection, installed by main.js. Legacy startup needs none.
    connect(invalidate: (key: string) => unknown) {
      query = invalidate;
      return () => { if (query === invalidate) query = undefined; };
    },
    on(key: string, fn: Refresher) {
      const set = listeners.get(key) ?? new Set<Refresher>(); set.add(fn); listeners.set(key, set);
      return () => { set.delete(fn); if (!set.size) listeners.delete(key); };
    },
    invalidate(key: string) {
      const callbacks: Refresher[] = [...(listeners.get(key) ?? [])];
      if (query) { const invalidate = query; callbacks.unshift(() => invalidate(key)); }
      // A failed reader must not prevent other panels from refreshing. Return
      // settled results so callers can inspect failures without unhandled promises.
      return Promise.allSettled(callbacks.map(async (fn) => fn()));
    },
  };
}
export type RefreshBus = ReturnType<typeof createBus>;
