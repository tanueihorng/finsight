import { useSyncExternalStore } from 'react';
import { chartHooks } from '../../shell/chartHooks.ts';

// Light / dark (FEAT-009 Phase 0b). The head script applies the saved mode
// before first paint; this keeps the ◐ button and APPEARANCE in step.
export type Mode = 'dark' | 'light';
const EVENT = 'finsight:mode';
export const getMode = (): Mode => (document.documentElement.dataset.mode === 'light' ? 'light' : 'dark');
export function setMode(mode: Mode) {
  try { localStorage.setItem('finsight-mode', mode); } catch { /* storage blocked */ }
  document.documentElement.dataset.mode = mode;
  chartHooks.repaint();
  window.dispatchEvent(new Event(EVENT));
}
const subscribe = (fn: () => void) => { window.addEventListener(EVENT, fn); return () => window.removeEventListener(EVENT, fn); };
export const useMode = () => useSyncExternalStore(subscribe, getMode);
