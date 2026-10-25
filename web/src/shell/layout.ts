import { createStore } from 'zustand/vanilla';

// The panel layout (F10, React since X1): which column each panel is in, its
// order, and which panels are hidden. Keys finsight-layout (order) and
// finsight-panels (hidden ids) are unchanged; App renders the columns from this.
export type Side = 'left' | 'right';
export interface Columns { left: string[]; right: string[] }
// Default order, as in the pre-X1 index.html (Kestrel's dock sits after the detail).
export const DEFAULT_COLUMNS: Columns = {
  left: ['positions', 'performance', 'wealth', 'allocation', 'heatmap', 'watchlist', 'alerts', 'fxrisk', 'dividends', 'activity'],
  right: ['detail', 'kestrel', 'news', 'markets', 'calendar', 'worldbank', 'fred', 'inflation'],
};
// ⚙ Layout's show/hide list: [body id, label]; the body id is what finsight-panels stores.
export const PANELS: [string, string][] = [
  ['perf-body', 'Performance'], ['alloc-body', 'Allocation'], ['heatmap-body', 'Sector Heatmap'],
  ['fxrisk', 'FX Risk'], ['dividends', 'Dividends'], ['watchlist', 'Watchlist'], ['alerts', 'Price Alerts'], ['activity', 'Recent Activity'],
  ['news', 'News'], ['markets', 'World Markets'], ['calendar', 'Econ Calendar'], ['wb-body', 'World Bank'], ['fred-body', 'US Fed (FRED)'], ['infl-body', 'US Inflation Gauges'],
];
export const HIDE_ID: Record<string, string> = {
  performance: 'perf-body', allocation: 'alloc-body', heatmap: 'heatmap-body', fxrisk: 'fxrisk', dividends: 'dividends', watchlist: 'watchlist',
  alerts: 'alerts', activity: 'activity', news: 'news', markets: 'markets', calendar: 'calendar', worldbank: 'wb-body', fred: 'fred-body', inflation: 'infl-body',
};
export interface SavedLayout { left?: string[]; right?: string[] }
const LAYOUT_KEY = 'finsight-layout', PANELS_KEY = 'finsight-panels';
const read = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
export function parseHidden(raw: string | null): string[] {
  try { const v: unknown = JSON.parse(raw || 'null'); return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []; } catch { return []; }
}
export function parseLayout(raw: string | null): SavedLayout | null {
  try { const v = JSON.parse(raw || 'null') as SavedLayout | null; return v && typeof v === 'object' ? v : null; } catch { return null; }
}
// Legacy applyLayout appended each saved pid, in saved order, to the end of
// its saved column (left first, then right); unsaved panels keep their place.
export function applySaved(defaults: Columns, saved: SavedLayout | null): Columns {
  const cols: Columns = { left: [...defaults.left], right: [...defaults.right] };
  if (!saved) return cols;
  const known = new Set([...defaults.left, ...defaults.right]);
  (['left', 'right'] as const).forEach((side) => {
    for (const pid of saved[side] || []) {
      if (!known.has(pid)) continue;
      cols.left = cols.left.filter((p) => p !== pid); cols.right = cols.right.filter((p) => p !== pid);
      cols[side].push(pid);
    }
  });
  return cols;
}
// Move pid into a column before another pid (null: append).
export function movePanel(cols: Columns, pid: string, side: Side, before: string | null): Columns {
  const next: Columns = { left: cols.left.filter((p) => p !== pid), right: cols.right.filter((p) => p !== pid) };
  const i = before == null ? -1 : next[side].indexOf(before);
  if (i < 0) next[side].push(pid); else next[side].splice(i, 0, pid);
  return next;
}
// The panel to drop before: the nearest one whose middle is below the pointer.
export function dropBefore<T>(items: { el: T; top: number; height: number }[], y: number): T | null {
  let best: T | null = null, bestOff = -Infinity;
  for (const { el, top, height } of items) {
    const off = y - top - height / 2;
    if (off < 0 && off > bestOff) { bestOff = off; best = el; }
  }
  return best;
}

export const columns = createStore<Columns>()(() => applySaved(DEFAULT_COLUMNS, parseLayout(read(LAYOUT_KEY))));
export const hiddenPanels = createStore<string[]>()(() => parseHidden(read(PANELS_KEY)));
export function saveLayout() {
  try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(columns.getState())); } catch { /* storage blocked */ }
}
export function setPanelHidden(id: string, hidden: boolean) {
  const next = hidden ? [...new Set([...hiddenPanels.getState(), id])] : hiddenPanels.getState().filter((x) => x !== id);
  hiddenPanels.setState(next, true);
  try { localStorage.setItem(PANELS_KEY, JSON.stringify(next)); } catch { /* storage blocked */ }
}
export function resetLayout() {
  try { localStorage.removeItem(LAYOUT_KEY); } catch { /* storage blocked */ }
  location.reload();
}

// Keyboard equivalent of the existing drag handle. Decorate the shell-owned
// hosts here so the shared App.tsx stays outside the H3 lane's file ownership.
let keyboardInstalled = false;
export function installKeyboardLayout() {
  if (keyboardInstalled) return; keyboardInstalled = true;
  const enhance = () => {
    document.querySelectorAll<HTMLElement>('.drag-grip').forEach((grip) => {
      if (grip.hasAttribute('tabindex')) return;
      const panel = grip.closest<HTMLElement>('[data-pid]');
      grip.tabIndex = 0; grip.setAttribute('role', 'button');
      grip.setAttribute('aria-label', `Move ${panel?.dataset.pid || 'panel'}: arrow keys reorder or change column`);
      grip.setAttribute('aria-keyshortcuts', 'ArrowUp ArrowDown ArrowLeft ArrowRight');
    });
    const brand = document.querySelector('.brand');
    brand?.setAttribute('role', 'heading'); brand?.setAttribute('aria-level', '1');
  };
  enhance();
  new MutationObserver(enhance).observe(document.getElementById('root')!, { childList: true, subtree: true });
  document.addEventListener('keydown', (e) => {
    const grip = e.target instanceof HTMLElement && e.target.closest<HTMLElement>('.drag-grip');
    if (!grip || document.body.classList.contains('locked') || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    const pid = grip.closest<HTMLElement>('[data-pid]')?.dataset.pid;
    if (!pid) return;
    e.preventDefault(); e.stopPropagation();
    const cols = columns.getState(), side: Side = cols.left.includes(pid) ? 'left' : 'right';
    const index = cols[side].indexOf(pid);
    let to = side, before: string | null = null;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') to = e.key === 'ArrowLeft' ? 'left' : 'right';
    else if (e.key === 'ArrowUp') before = cols[side][Math.max(0, index - 1)]!;
    else before = cols[side][index + 2] ?? null;
    if (before === pid || to === side && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) return;
    columns.setState(movePanel(cols, pid, to, before), true); saveLayout();
    requestAnimationFrame(() => grip.focus({ preventScroll: true }));
  });
}
