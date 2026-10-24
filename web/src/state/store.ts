import { createStore } from 'zustand/vanilla';

export interface UiState {
  selected: string | null;
  detailRange: { range: string; interval: string; tf?: boolean };
  base: string; account: string; accountReady: boolean; peek: boolean;
  lastPrices: Record<string, number>;
}
export function initialState(storage: Pick<Storage, 'getItem'>): UiState {
  const read = (key: string) => { try { return storage.getItem(key); } catch { return null; } };
  // Bootstrap precedes the legacy preference migration. Read its old keys too,
  // preserving the same precedence without requiring app.js to run first.
  return {
    selected: null, detailRange: { range: '1mo', interval: '1d' }, lastPrices: {},
    base: ((read('finsight-base') ?? read('fincept-base')) || 'SGD').toUpperCase(),
    account: read('finsight-account') ?? read('fincept-account') ?? '',
    accountReady: false, peek: read('finsight-unpeek') !== '1',
  };
}
export const createUiStore = (initial: UiState) => createStore<UiState>()(() => initial);
export type UiStore = ReturnType<typeof createUiStore>;

export function createStateBridge(store: UiStore): UiState {
  return new Proxy({} as UiState, {
    get: (_, key) => Reflect.get(store.getState(), key),
    set: (_, key, value: unknown) => {
      if (!Object.hasOwn(store.getState(), key)) throw new TypeError(`Unknown UI state key: ${String(key)}`);
      store.setState({ [key]: value }); return true;
    },
    ownKeys: () => Reflect.ownKeys(store.getState()),
    getOwnPropertyDescriptor: (_, key) => Object.hasOwn(store.getState(), key)
      ? { configurable: true, enumerable: true, writable: true, value: Reflect.get(store.getState(), key) } : undefined,
  });
}
export function setLastPrice(store: UiStore, symbol: string, value: number) {
  store.setState((state) => ({ lastPrices: { ...state.lastPrices, [symbol]: value } }));
}
export function createAuth(target: EventTarget) {
  let unlocked = false;
  const set = (next: boolean) => {
    if (unlocked === next) return;
    unlocked = next;
    target.dispatchEvent(new Event(next ? 'finsight:unlocked' : 'finsight:locked'));
  };
  return { get unlocked() { return unlocked; }, lock: () => set(false), unlock: () => set(true) };
}
