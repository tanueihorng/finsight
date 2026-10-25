import { createStore } from 'zustand/vanilla';
// The docked Kestrel panel's state (G3): App renders the dock panel from it.
export const kestrelDock = createStore<{ visible: boolean; collapsed: boolean }>()(() => ({ visible: false, collapsed: false }));
