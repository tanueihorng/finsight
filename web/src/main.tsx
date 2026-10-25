import './main.css';
import type {} from './bootstrap.ts';
import { lazy, Suspense, type ComponentType, type LazyExoticComponent } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { queryDefaults } from './api/queries.ts';
import { islands, type IslandRegistry } from './islands.ts';
import { IslandBoundary } from './ui/IslandBoundary.tsx';
import { Loading } from './ui/Loading.tsx';
import { actions } from './features/cash/actions.ts';
import App from './App.tsx';
import { startShell } from './shell/boot.ts';
import './shell/compat.ts';

export const queryClient = new QueryClient({ defaultOptions: { queries: queryDefaults } });
window.FinSight.actions = actions;
window.FinSight.bus.connect((key) => queryClient.invalidateQueries({ queryKey: [key] }));
window.addEventListener('finsight:locked', () => { void queryClient.cancelQueries(); });
// The first unlock (startup) has nothing cached to refresh; invalidating then
// only made each panel that mounted afterwards fetch its data twice (H1).
let unlockedBefore = false;
window.addEventListener('finsight:unlocked', () => { if (unlockedBefore) void queryClient.invalidateQueries(); unlockedBefore = true; });

// The island runtime (F6). Since X1 the page is one React app (App.tsx); this
// stays for [data-island] nodes added outside it (embeds and the F6 specs).
// Roots survive host moves; reconcile after the mutation batch/microtask so a
// remove+insert during a move is not mistaken for deletion.
export function mountIslands(registry: IslandRegistry, container: Document | HTMLElement = document) {
  const roots = new Map<HTMLElement, { id: string; root: Root }>();
  const components = new Map<string, LazyExoticComponent<ComponentType>>();
  const pending = new Set<HTMLElement>();
  let scheduled = false, disposed = false;
  const collect = (node: Node) => {
    if (!(node instanceof Element)) return;
    if (node instanceof HTMLElement && node.matches('[data-island]')) pending.add(node);
    node.querySelectorAll<HTMLElement>('[data-island]').forEach((el) => pending.add(el));
  };
  const belongs = (node: HTMLElement) => node.isConnected && container.contains(node);
  const reconcile = () => {
    scheduled = false;
    if (disposed) return;
    for (const [node, entry] of roots) {
      if (!belongs(node) || node.dataset.island !== entry.id) { entry.root.unmount(); roots.delete(node); }
    }
    for (const node of pending) {
      const id = node.dataset.island, loader = id && Object.hasOwn(registry, id) ? registry[id] : undefined;
      if (!id || !loader || !belongs(node) || roots.has(node)) continue;
      let Island = components.get(id);
      if (!Island) { Island = lazy(loader); components.set(id, Island); }
      const root = createRoot(node); roots.set(node, { id, root });
      root.render(<IslandBoundary><QueryClientProvider client={queryClient}><Suspense fallback={<Loading />}><Island /></Suspense></QueryClientProvider></IslandBoundary>);
    }
    pending.clear();
  };
  const schedule = () => { if (!scheduled) { scheduled = true; queueMicrotask(reconcile); } };
  const observer = new MutationObserver((records) => {
    let removed = false;
    for (const record of records) {
      if (record.type === 'attributes') { collect(record.target); removed = true; }
      record.addedNodes.forEach(collect);
      if (Array.from(record.removedNodes).some((node) => node instanceof Element)) removed = true;
    }
    if (pending.size || removed) schedule();
  });
  observer.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-island'] });
  if (container instanceof HTMLElement) collect(container);
  else container.querySelectorAll<HTMLElement>('[data-island]').forEach((node) => pending.add(node));
  reconcile();
  return () => {
    disposed = true; observer.disconnect(); pending.clear();
    roots.forEach(({ root }) => root.unmount()); roots.clear();
  };
}
// X1: one React app for the whole page; the startup/lock shell runs beside it.
createRoot(document.getElementById('root')!).render(
  <IslandBoundary><QueryClientProvider client={queryClient}><App /></QueryClientProvider></IslandBoundary>,
);
mountIslands(islands);
startShell();
window.FinSight.markIslandsReady();
// Installable app + instant shell (static files only — see sw.js).
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
