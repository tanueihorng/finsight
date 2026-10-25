const holdings = ['portfolio', 'dividends', 'fx-risk', 'performance', 'wealth', 'ledger', 'realized', 'accounts', 'chart-trades', 'events', 'categories'] as const;
const scoped = [...holdings, 'alerts', 'detail'] as const;
// Endpoint writes -> readers (docs/frontend-migration/COUPLING.md §A6). Keys are
// refreshed in order: 'accounts' comes first where a write can remove the
// active account, so later readers use the corrected account.
export const mutationInvalidations = {
  buy: holdings, sell: holdings, delete: holdings, import: holdings, reset: holdings,
  'ledger-edit': holdings, 'ledger-delete': holdings,
  // Undo can revert trades, cash, accounts, the watchlist and alerts.
  undo: ['accounts', ...holdings.filter((key) => key !== 'accounts'), 'watchlist', 'chart-watch', 'alerts', 'chart-alerts'],
  cash: ['portfolio', 'fx-risk', 'wealth'],
  withholding: ['dividends', 'realized'],
  'watchlist-add': ['watchlist', 'chart-watch'], 'watchlist-remove': ['watchlist', 'chart-watch'],
  'alerts-add': ['alerts', 'chart-alerts'], 'alerts-update': ['alerts', 'chart-alerts'], 'alerts-remove': ['alerts', 'chart-alerts'],
  // Adding or renaming changes names and counts only; switching is a store change (keys include the account).
  'account-add': ['accounts'], 'account-rename': ['accounts'],
  'account-remove': ['accounts', ...scoped.filter((key) => key !== 'accounts')],
  'account-switch': scoped,
  base: scoped,
} as const;
export type MutationKind = keyof typeof mutationInvalidations;

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
    // A completed write: refresh every reader of what it changed, key by key.
    async write(kind: MutationKind) {
      for (const key of mutationInvalidations[kind]) await this.invalidate(key);
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
