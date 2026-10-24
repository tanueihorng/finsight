import type {} from '../bootstrap.ts';
import type { ApiErrorBody } from '../../../shared/types.ts';

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.name = 'ApiError'; this.status = status; }
}

// Injectable dependencies keep HTTP/error tests independent of the browser.
export function createApi(fetcher: typeof fetch, lock: () => void) {
  return async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (!path.startsWith('/api/') || path.includes('\\')) throw new TypeError('Expected a same-origin /api/ path');
    const headers = new Headers(init.headers);
    if (!headers.has('Accept')) headers.set('Accept', 'application/json');
    const response = await fetcher(path, { ...init, headers, credentials: 'same-origin' });
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
});
