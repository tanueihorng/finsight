import { useStore } from 'zustand';
import { CURRENCIES } from './topbar.ts';
import { switchBase } from './actions.ts';

// BASE currency selector (F8).
export default function BaseIsland() {
  const base = useStore(window.FinSight.store, (s) => s.base);
  return (
    <>
      BASE{' '}
      <select id="base-ccy" value={base} onChange={(e) => void switchBase(e.target.value.toUpperCase())}>
        {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
    </>
  );
}
