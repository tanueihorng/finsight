import type { Accounts, Portfolio } from '../../../shared/types.ts';
import { api } from './client.ts';

// Requests public/index.html starts before any script has loaded (H1): the
// session check, then for a signed-in session its accounts and the portfolio
// the app will show first. index.html reads each body straight away (an
// unread body would hold a connection), so these are parsed JSON or null.
type AuthStatus = { authed?: boolean; pinSet?: boolean };
type Early = { auth?: Promise<AuthStatus>; accounts?: Promise<Accounts | null>; portfolio?: { url: string; data: Promise<Portfolio | null> } };
declare global { interface Window { finsightEarly?: Early } }

// Each is handed out once, to the first call only: a response that arrives
// after it (or a later refetch, say after a write) is never served from here.
const FRESH_MS = 10_000, taken = new Set<keyof Early>();
function take<K extends keyof Early>(key: K): Early[K] {
  if (taken.has(key)) return undefined;
  taken.add(key);
  return performance.now() < FRESH_MS ? window.finsightEarly?.[key] : undefined;
}

export const earlyAuthStatus = () => take('auth');
export async function loadAccountsList() {
  return (await take('accounts')?.catch(() => null)) ?? api<Accounts>('/api/accounts');
}
export async function loadPortfolio(url: string, signal: AbortSignal) {
  const early = take('portfolio');
  return (early?.url === url ? await early.data.catch(() => null) : null) ?? api<Portfolio>(url, { signal });
}
