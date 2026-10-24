// Test-only island. Never registered or referenced by index.html/build entries.
import { useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { usePortfolio } from '../../api/queries.ts';
import { queryClient } from '../../main.tsx';
import type {} from '../../bootstrap.ts';
function Probe() {
  const state = useSyncExternalStore(window.FinSight.store.subscribe, window.FinSight.store.getState);
  const portfolio = usePortfolio();
  return <output id="store-probe" data-account={portfolio.data?.account ?? ''} data-fetching={portfolio.fetchStatus}>{state.base}</output>;
}
export function mountProbe(node: HTMLElement) {
  const root = createRoot(node);
  root.render(<QueryClientProvider client={queryClient}><Probe /></QueryClientProvider>);
  return () => root.unmount();
}
