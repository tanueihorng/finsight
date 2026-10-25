import { createStore } from 'zustand/vanilla';

// Profile + setup state (F8), saved under the legacy key finsight-profile.
export interface Profile { name?: string; base?: string; setupDone?: boolean }
const KEY = 'finsight-profile';
export function parseProfile(raw: string | null): Profile {
  try { return JSON.parse(raw || 'null') || {}; } catch { return {}; }
}
export const firstName = (p: Profile) => (p.name ? p.name.split(' ')[0]! : 'Profile');
export const profile = createStore<Profile>()(() => { try { return parseProfile(localStorage.getItem(KEY)); } catch { return {}; } });
export function saveProfile(next: Profile) {
  profile.setState(next, true);
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage blocked */ }
}
