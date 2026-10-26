// Preloaded into a test server (`node --import`) to observe outbound fetches.
// It wraps whatever is assigned to globalThis.fetch (the fake market installs
// itself later), so the probe sits outside the fake without changing it.
//   FETCH_PROBE_FILE   write {max, total} in-flight counts here after each fetch
//   FETCH_PROBE_DELAY  ms each fetch is held, so concurrent calls overlap
//   FETCH_PROBE_FAIL=1 every fetch rejects (an upstream outage)
import fs from 'node:fs';

const file = process.env.FETCH_PROBE_FILE;
const delay = Number(process.env.FETCH_PROBE_DELAY) || 0;
const fail = process.env.FETCH_PROBE_FAIL === '1';
let inner = globalThis.fetch, active = 0, max = 0, total = 0;

async function probed(input, init) {
  active++; total++; max = Math.max(max, active);
  try {
    if (delay) await new Promise((r) => setTimeout(r, delay));
    if (fail) throw new TypeError('fetch failed (FETCH_PROBE_FAIL)');
    return await inner(input, init);
  } finally {
    active--;
    if (file) fs.writeFileSync(file, JSON.stringify({ max, total }));
  }
}
Object.defineProperty(globalThis, 'fetch', {
  configurable: true,
  get: () => probed,
  set: (fn) => { inner = fn; },
});
