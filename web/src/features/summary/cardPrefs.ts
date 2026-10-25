import { createStore } from 'zustand/vanilla';
import { defaultPrefs, parsePrefs, type CardPrefs } from './cards.ts';

// One prefs store shared by the summary and the ⚙ Layout card editor islands
// (both chunks import this module, so the bundler shares one instance).
const KEY = 'finsight-cards';
function load(): CardPrefs {
  let raw: string | null = null;
  try { raw = localStorage.getItem(KEY); } catch { /* storage blocked */ }
  const { prefs, migrated } = parsePrefs(raw);
  if (migrated) save(prefs);
  return prefs;
}
function save(p: CardPrefs) { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* storage blocked */ } }

export const cardPrefs = createStore<CardPrefs>()(load);
export function setCardPrefs(next: CardPrefs) { cardPrefs.setState(next, true); save(next); }
export const resetCardPrefs = () => setCardPrefs(defaultPrefs());
