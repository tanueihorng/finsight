import type { ComponentType } from 'react';
export type IslandRegistry = Record<string, () => Promise<{ default: ComponentType }>>;
// Append one entry per panel; keep loaders lazy to preserve code splitting.
export const islands: IslandRegistry = {
  clock: () => import('./features/clock/ClockIsland.tsx'),
  markets: () => import('./features/markets/MarketsIsland.tsx'),
};
