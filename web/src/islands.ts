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
  calendar: () => import('./features/macro/CalendarIsland.tsx'),
  worldbank: () => import('./features/macro/WorldBankIsland.tsx'),
  fred: () => import('./features/macro/FredIsland.tsx'),
  inflation: () => import('./features/macro/InflationIsland.tsx'),
  watchlist: () => import('./features/watchlist/WatchlistIsland.tsx'),
  alerts: () => import('./features/alerts/AlertsIsland.tsx'),
  dividends: () => import('./features/dividends/DividendsIsland.tsx'),
  activity: () => import('./features/activity/ActivityIsland.tsx'),
};
