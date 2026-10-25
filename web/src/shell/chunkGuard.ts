// A retry belongs to the loaded chunk graph, not a network-fetched manifest
// (which could already describe the next deploy). Bundled loader source embeds
// esbuild's content-hashed URLs. Use the full signature to avoid hash collisions.
type Loader<T> = () => Promise<T>;
export const MARKER_PREFIX = 'finsight:chunk-retry:';
export function chunkBuild(loaders: Record<string, Loader<unknown>>) {
  return JSON.stringify(Object.keys(loaders).sort().map((id) => [id, String(loaders[id])]));
}
type Environment = {
  storage: () => Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  hasInput: () => boolean;
  reload: () => void;
  afterBoot: (callback: () => void) => void;
};
export function hasUnsavedInput(doc: Document): boolean {
  // Includes PIN, chat, command and trade forms. Never persist their contents.
  return [...doc.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')]
    .some((el) => !['hidden', 'checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color'].includes(el.type) && !!el.value)
    || [...doc.querySelectorAll<HTMLElement>('[contenteditable="true"]')].some((el) => !!el.textContent?.trim());
}
// Module fetch failures have browser-specific TypeError messages. Syntax errors
// can indicate a truncated deploy too. Ordinary component/loader exceptions
// belong to IslandBoundary and must not discard the user's page.
export function isChunkLoadError(error: unknown): boolean {
  return error instanceof SyntaxError || error instanceof TypeError &&
    /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed/i.test(error.message);
}
export function createChunkGuard(build: string, env: Environment) {
  const key = MARKER_PREFIX + build;
  let pending = 0, failed = false, reloading = false;
  const recovered = new Set<string>();
  return <T>(loader: Loader<T>): Loader<T> => async () => {
    const identity = String(loader);
    pending++;
    try {
      const result = await loader();
      recovered.add(identity);
      env.afterBoot(() => {
        if (pending || failed || reloading) return;
        try {
          const marker = env.storage().getItem(key);
          // Only the previously FAILED import can prove recovery. A successful
          // clock/lock import must never clear a permanently broken panel's fuse.
          if (marker && recovered.has(marker)) env.storage().removeItem(key);
        } catch { /* storage denied: automatic reload is disabled too */ }
      });
      return result;
    } catch (error) {
      failed = true;
      try {
        const storage = env.storage();
        if (isChunkLoadError(error) && !reloading && !env.hasInput() && !storage.getItem(key)) {
          storage.setItem(key, identity); // write and verify BEFORE navigation
          if (storage.getItem(key) === identity) { reloading = true; env.reload(); }
        }
      } catch { /* fail closed: no storage / navigation -> existing boundary */ }
      throw error; // React's existing IslandBoundary remains the fallback.
    } finally { pending--; }
  };
}
let guard: ReturnType<typeof createChunkGuard> | undefined;
export function guardedIslandLoader<T>(loader: Loader<T>, registry: Record<string, Loader<unknown>>): Loader<T> {
  guard ??= createChunkGuard(chunkBuild(registry), {
    storage: () => window.sessionStorage,
    hasInput: () => hasUnsavedInput(document),
    reload: () => window.location.reload(),
    afterBoot: (callback) => {
      const defer = () => { setTimeout(callback, 0); };
      if (document.readyState === 'complete') defer();
      else window.addEventListener('load', defer, { once: true });
    },
  });
  return guard(loader);
}
