import './main.css';
import type {} from './bootstrap.ts';
import { QueryClient } from '@tanstack/react-query';
import { queryDefaults } from './api/queries.ts';

export const queryClient = new QueryClient({ defaultOptions: { queries: queryDefaults } });
window.FinSight.bus.connect((key) => queryClient.invalidateQueries({ queryKey: [key] }));
window.addEventListener('finsight:locked', () => { void queryClient.cancelQueries(); });
window.addEventListener('finsight:unlocked', () => { void queryClient.invalidateQueries(); });
window.FinSight.markIslandsReady();
