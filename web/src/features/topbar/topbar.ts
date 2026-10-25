// Topbar helpers (F8), ported from public/app.js S10/S13/S32/S33.
import type { Account } from '../../../../shared/types.ts';

export const THEMES = [
  { id: 'violet', label: 'Violet', accent: '#a78bfa' }, { id: 'amber', label: 'Amber', accent: '#ff9e16' },
  { id: 'teal', label: 'Teal', accent: '#2dd4bf' }, { id: 'phosphor', label: 'Phosphor', accent: '#4ade80' },
];
export const FONTS = [{ id: 'mono', label: 'Mono' }, { id: 'sans', label: 'Sans' }, { id: 'slab', label: 'Serif' }];
export const CURRENCIES = ['SGD', 'USD', 'EUR', 'GBP', 'JPY', 'HKD', 'AUD', 'CNY', 'INR'];
export const accountLabel = (a: Account) => `${a.name}${a.count ? ` (${a.count})` : ''}`;
export const accountDetail = (a: Account) => `${a.type ? a.type + ' · ' : ''}${a.count} holdings`;
// Where the selection goes when the active account is deleted.
export const afterRemove = (current: string, removed: string, activeId: string) => (current === removed ? activeId : current);
