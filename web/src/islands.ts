import type { ComponentType } from 'react';
export type IslandRegistry = Record<string, () => Promise<{ default: ComponentType }>>;
// Append one entry per panel; keep loaders lazy to preserve code splitting.
export const islands: IslandRegistry = {
  clock: () => import('./features/clock/ClockIsland.tsx'),
  markets: () => import('./features/markets/MarketsIsland.tsx'),
  summary: () => import('./features/summary/SummaryIsland.tsx'),
  'summary-cards': () => import('./features/summary/CardsEditorIsland.tsx'),
  positions: () => import('./features/positions/PositionsIsland.tsx'),
  news: () => import('./features/news/NewsIsland.tsx'),
  'add-form': () => import('./features/addform/AddFormIsland.tsx'),
  'cash-editor': () => import('./features/cash/CashEditorIsland.tsx'),
  ledger: () => import('./features/ledger/LedgerIsland.tsx'),
  import: () => import('./features/ledger/ImportIsland.tsx'),
  performance: () => import('./features/analytics/PerformanceIsland.tsx'),
  wealth: () => import('./features/analytics/WealthIsland.tsx'),
  allocation: () => import('./features/analytics/AllocationIsland.tsx'),
  heatmap: () => import('./features/analytics/HeatmapIsland.tsx'),
};
