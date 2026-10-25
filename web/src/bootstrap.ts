import { createBus, type RefreshBus } from './api/invalidation.ts';
import type { FinSightActions } from './features/cash/actions.ts';
import { createUiStore, initialState, createAuth, type UiStore } from './state/store.ts';
// Startup contract between legacy code and React islands. Built as a classic
// script (public/app/bootstrap.js) and loaded before every legacy script, so
// window.FinSight exists before app.js runs. Module scripts (main.js) run
// later, after the legacy scripts: they must never be needed for startup.
// Order: bootstrap.js -> legacy scripts (app.js boots the page) -> main.js mounts islands.
// The store, refresh bus and lock state are available before legacy startup.

export type FinSightGlobal = {
  contract: 1;
  bus: RefreshBus;
  store: UiStore;
  auth: ReturnType<typeof createAuth>;
  // Resolves once main.js has started (islands may still be mounting).
  islandsReady: Promise<void>;
  markIslandsReady(): void;
  // Set by main.js (D3): TypeScript actions the legacy buttons and command bar call.
  actions?: FinSightActions;
};

declare global {
  interface Window { FinSight: FinSightGlobal }
}

let markIslandsReady = () => {};
const islandsReady = new Promise<void>((resolve) => {
  markIslandsReady = () => { resolve(); window.dispatchEvent(new Event('finsight:islands-ready')); };
});
// One-time migration of saved prefs from the old name (fincept-*) to finsight-*.
try {
  ['profile', 'base', 'cards', 'account'].forEach((k) => {
    const old = localStorage.getItem('fincept-' + k);
    if (old != null && localStorage.getItem('finsight-' + k) == null) localStorage.setItem('finsight-' + k, old);
  });
} catch { /* storage blocked */ }
const store = createUiStore(initialState(localStorage));
// PEEK (F8): body.unpeek must apply at load, before any lazy island, and follow the store.
const applyPeek = () => document.body?.classList.toggle('unpeek', !store.getState().peek);
applyPeek(); store.subscribe(applyPeek);
window.FinSight = { store, auth: createAuth(window), contract: 1, bus: createBus(), islandsReady, markIslandsReady: () => markIslandsReady() };
