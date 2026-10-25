import type {} from '../bootstrap.ts';
import type { ApiErrorBody } from '../../../shared/types.ts';

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.name = 'ApiError'; this.status = status; }
}

// Injectable dependencies keep HTTP/error tests independent of the browser.
// While locked, protected requests fail without touching the network: an
// island that renders just before a lock can subscribe just after it, and
// Query would otherwise send one request with the expired session (PILOT-1).
export function createApi(fetcher: typeof fetch, lock: () => void, isLocked: () => boolean = () => false) {
  return async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (!path.startsWith('/api/') || path.includes('\\')) throw new TypeError('Expected a same-origin /api/ path');
    if (isLocked() && !path.startsWith('/api/auth/')) throw new ApiError(401, 'Locked. Enter your PIN.');
    const headers = new Headers(init.headers);
    if (!headers.has('Accept')) headers.set('Accept', 'application/json');
    const response = await fetcher(path, { ...init, headers, credentials: 'same-origin' }).catch((e: unknown) => {
      // The server may have stopped: the shell re-checks and shows the offline screen (X1, from app.js onNetError).
      if (!(e instanceof DOMException && e.name === 'AbortError')) globalThis.dispatchEvent?.(new Event('finsight:network-error'));
      throw e;
    });
    if (response.status === 401) lock();
    const body: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      const error = (body as ApiErrorBody | undefined)?.error;
      const message = typeof error === 'string' ? error : error?.message;
      throw new ApiError(response.status, message || `HTTP ${response.status}`);
    }
    return body as T; // Compile-time assertion only; endpoint producers define the wire contract.
  };
}

export const api = createApi((...args) => fetch(...args), () => {
  if (window.FinSight.auth) window.FinSight.auth.lock();
  else window.dispatchEvent(new Event('finsight:locked')); // F4 installs the auth bridge.
}, () => window.FinSight.auth?.unlocked === false);
