import { createStore } from 'zustand/vanilla';
import { parsePosView, type PosView } from './table.ts';

// The table's filter/search/sort/group/collapsed view, saved under the legacy key.
const KEY = 'finsight-posview';
function load(): PosView {
  try { return parsePosView(localStorage.getItem(KEY)); } catch { return parsePosView(null); }
}
export const posView = createStore<PosView>()(load);
export function setPosView(next: PosView) {
  posView.setState(next, true);
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage blocked */ }
}
