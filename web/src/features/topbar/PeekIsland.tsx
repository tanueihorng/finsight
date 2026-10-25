import { useStore } from 'zustand';

// PEEK / UNPEEK (F8). Purely visual: bootstrap applies body.unpeek from the
// store at load (before any island) and on every change.
export default function PeekIsland() {
  const peek = useStore(window.FinSight.store, (s) => s.peek);
  const toggle = () => {
    const next = !peek;
    window.FinSight.store.setState({ peek: next });
    try { localStorage.setItem('finsight-unpeek', !next ? '1' : '0'); } catch { /* storage blocked */ }
  };
  return (
    <button id="peek-btn" className={'topbar-btn' + (!peek ? ' active' : '')} onClick={toggle}
      title="Hide or show your personal figures (holdings, values, P&L, cash). Prices and market data stay visible.">
      {!peek ? '◌ PEEK' : '◉ UNPEEK'}
    </button>
  );
}
