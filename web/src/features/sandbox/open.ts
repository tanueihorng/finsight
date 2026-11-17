import { createStore } from 'zustand/vanilla';

export const sandboxOpen = createStore<{ open: boolean }>()(() => ({ open: false }));
export const openSandbox = () => sandboxOpen.setState({ open: true });
export const closeSandbox = () => sandboxOpen.setState({ open: false });
