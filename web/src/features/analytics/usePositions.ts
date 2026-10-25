import { useStore } from 'zustand';
import { useAccounts, useCategories, usePortfolio } from '../../api/queries.ts';

// The held positions with their categories and the active account's name,
// shared by the analytics islands (one query each, deduplicated by key).
export function usePositions() {
  const portfolio = usePortfolio();
  const accounts = useAccounts();
  const positions = portfolio.data?.positions ?? [];
  const categories = useCategories(positions.map((p) => p.symbol)).data ?? {};
  const account = useStore(window.FinSight.store, (s) => s.account);
  const accountName = accounts.data?.accounts.find((a) => a.id === account)?.name || 'Account';
  return { loaded: !!portfolio.data, positions, categories, accountName, base: portfolio.data?.base || window.FinSight.store.getState().base };
}
