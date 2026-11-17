import { createStore } from 'zustand/vanilla';

// Whether the Quant Lab workspace is showing. `mounted` stays true after the
// first open, so a running backtest keeps going while the workspace is closed.
export const quantLab = createStore<{ open: boolean; mounted: boolean }>()(() => ({ open: false, mounted: false }));
export const openQuantLab = () => quantLab.setState({ open: true, mounted: true });
export const closeQuantLab = () => quantLab.setState({ open: false });
