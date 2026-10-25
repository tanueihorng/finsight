import { createStore } from 'zustand/vanilla';

// The layout system (F10), ported from public/app.js S11/S12. The legacy
// .panel hosts stay in index.html until X1's single App renders them; this
// module tags them, adds the ⠿ grips, moves them between columns and
// persists finsight-layout (order) and finsight-panels (hidden) as before.
export const PANELS: [string, string][] = [
  ['perf-body', 'Performance'], ['alloc-body', 'Allocation'], ['heatmap-body', 'Sector Heatmap'],
  ['fxrisk', 'FX Risk'], ['dividends', 'Dividends'], ['watchlist', 'Watchlist'], ['alerts', 'Price Alerts'], ['activity', 'Recent Activity'],
  ['news', 'News'], ['markets', 'World Markets'], ['calendar', 'Econ Calendar'], ['wb-body', 'World Bank'], ['fred-body', 'US Fed (FRED)'], ['infl-body', 'US Inflation Gauges'],
];
// A stable pid per panel, found through a known element inside it.
export const PANEL_PIDS: [string, string][] = [
  ['#positions-view', 'positions'], ['#wealth-body', 'wealth'], ['#perf-body', 'performance'], ['#alloc-body', 'allocation'],
  ['#heatmap-body', 'heatmap'], ['#fxrisk', 'fxrisk'], ['#dividends', 'dividends'], ['#watchlist', 'watchlist'], ['#alerts', 'alerts'], ['#activity', 'activity'],
  ['#detail-panel', 'detail'], ['#agent-dock', 'kestrel'], ['#news', 'news'], ['#markets', 'markets'], ['#calendar', 'calendar'], ['#wb-body', 'worldbank'], ['#fred-body', 'fred'], ['#infl-body', 'inflation'],
];
export interface SavedLayout { left?: string[]; right?: string[] }
const LAYOUT_KEY = 'finsight-layout', PANELS_KEY = 'finsight-panels';
const read = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
export function parseHidden(raw: string | null): string[] {
  try { const v: unknown = JSON.parse(raw || 'null'); return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []; } catch { return []; }
}
export function parseLayout(raw: string | null): SavedLayout | null {
  try { const v = JSON.parse(raw || 'null') as SavedLayout | null; return v && typeof v === 'object' ? v : null; } catch { return null; }
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

export const hiddenPanels = createStore<string[]>()(() => parseHidden(read(PANELS_KEY)));
export function setPanelHidden(id: string, hidden: boolean) {
  const next = hidden ? [...new Set([...hiddenPanels.getState(), id])] : hiddenPanels.getState().filter((x) => x !== id);
  hiddenPanels.setState(next, true);
  try { localStorage.setItem(PANELS_KEY, JSON.stringify(next)); } catch { /* storage blocked */ }
}

const panelOf = (el: Element | null) => (el ? (el.classList.contains('panel') ? el : el.closest('.panel')) as HTMLElement | null : null);
function applyPanels(hidden: string[]) {
  PANELS.forEach(([id]) => { const el = panelOf(document.getElementById(id)); if (el) el.style.display = hidden.includes(id) ? 'none' : ''; });
}
function saveLayout() {
  const cols = (sel: string) => [...document.querySelectorAll<HTMLElement>(`${sel} > .panel.draggable-block`)].map((p) => p.dataset.pid!);
  try { localStorage.setItem(LAYOUT_KEY, JSON.stringify({ left: cols('.col-left'), right: cols('.col-right') })); } catch { /* storage blocked */ }
}
function applyLayout() {
  const saved = parseLayout(read(LAYOUT_KEY));
  if (!saved) return;
  ([['left', '.col-left'], ['right', '.col-right']] as const).forEach(([side, sel]) => {
    const col = document.querySelector(sel); if (!col) return;
    (saved[side] || []).forEach((pid) => {
      const panel = document.querySelector(`.panel.draggable-block[data-pid="${CSS.escape(pid)}"]`);
      if (panel) col.appendChild(panel); // append in saved order (also moves across columns)
    });
  });
}
export function resetLayout() {
  try { localStorage.removeItem(LAYOUT_KEY); } catch { /* storage blocked */ }
  location.reload();
}

// Once, at boot (the Kestrel dock exists by then): tag, add grips, restore
// the saved order and hidden panels, then follow later show/hide changes.
let inited = false;
export function initLayout() {
  if (inited) return; inited = true;
  PANEL_PIDS.forEach(([sel, pid]) => {
    const panel = panelOf(document.querySelector(sel));
    const head = panel?.querySelector('.panel-head');
    if (!panel || !head) return;
    panel.dataset.pid = pid; panel.classList.add('draggable-block');
    if (head.querySelector('.drag-grip')) return;
    const grip = document.createElement('span');
    grip.className = 'drag-grip'; grip.textContent = '⠿'; grip.title = 'Drag to rearrange';
    grip.setAttribute('draggable', 'true');
    grip.addEventListener('dragstart', (e) => {
      panel.classList.add('dragging');
      if (!e.dataTransfer) return;
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', pid); e.dataTransfer.setDragImage(panel, 12, 12); } catch { /* not supported */ }
    });
    grip.addEventListener('dragend', () => {
      panel.classList.remove('dragging');
      document.querySelectorAll('.drop-on').forEach((c) => c.classList.remove('drop-on'));
      saveLayout();
    });
    head.insertBefore(grip, head.firstChild);
  });
  ['.col-left', '.col-right'].forEach((sel) => {
    const col = document.querySelector<HTMLElement>(sel); if (!col) return;
    col.addEventListener('dragover', (e) => {
      const dragging = document.querySelector('.panel.dragging'); if (!dragging) return;
      e.preventDefault(); col.classList.add('drop-on');
      const items = [...col.querySelectorAll<HTMLElement>(':scope > .panel.draggable-block:not(.dragging)')]
        .filter((el) => el.offsetParent !== null)
        .map((el) => { const r = el.getBoundingClientRect(); return { el, top: r.top, height: r.height }; });
      const after = dropBefore(items, e.clientY);
      if (after == null) col.appendChild(dragging); else col.insertBefore(dragging, after);
    });
    col.addEventListener('dragleave', (e) => { if (!col.contains(e.relatedTarget as Node | null)) col.classList.remove('drop-on'); });
    col.addEventListener('drop', (e) => e.preventDefault());
  });
  applyLayout();
  applyPanels(hiddenPanels.getState());
  hiddenPanels.subscribe(applyPanels);
}
