import { createBus, type RefreshBus } from './api/invalidation.ts';
import type { QueryStateSource } from './api/queries.ts';
// Startup contract between legacy code and React islands. Built as a classic
// script (public/app/bootstrap.js) and loaded before every legacy script, so
// window.FinSight exists before app.js runs. Module scripts (main.js) run
// later, after the legacy scripts: they must never be needed for startup.
// Order: bootstrap.js -> legacy scripts (app.js boots the page) -> main.js mounts islands.
// F3/F4 add the shared store, refresh bus and lock state here.

export type FinSightGlobal = {
  contract: 1;
  bus: RefreshBus;
  // F4 installs both before legacy boot. Optional only during F3 integration.
  store?: QueryStateSource;
  auth?: { readonly unlocked: boolean; lock(): void; unlock(): void };
  // Resolves once main.js has started (islands may still be mounting).
  islandsReady: Promise<void>;
  markIslandsReady(): void;
};

declare global {
  interface Window { FinSight: FinSightGlobal }
}

let markIslandsReady = () => {};
const islandsReady = new Promise<void>((resolve) => {
  markIslandsReady = () => { resolve(); window.dispatchEvent(new Event('finsight:islands-ready')); };
});
window.FinSight = { contract: 1, bus: createBus(), islandsReady, markIslandsReady: () => markIslandsReady() };
