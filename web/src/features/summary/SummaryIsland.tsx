import { useStore } from 'zustand';
import { usePortfolio, useFxRisk } from '../../api/queries.ts';
import { signClass } from '../../ui/format.ts';
import { CARD_DEFS, CASH_CARDS, visibleCards } from './cards.ts';
import { cardPrefs } from './cardPrefs.ts';

// Summary cards (PILOT-2 / C1). Renders inside the legacy #summary grid; the
// cash editor still opens from the legacy click handler on [data-cash-card].
// Peek stays legacy for now: body.unpeek must apply synchronously at page load
// (a lazily loaded island would flash unblurred figures), so it moves with the topbar (F8).
export default function SummaryIsland() {
  const portfolio = usePortfolio();
  const fxRisk = useFxRisk();
  const prefs = useStore(cardPrefs);
  const data = portfolio.data;
  if (!data) return null; // legacy left #summary empty until the first portfolio load
  const input = { s: data.summary, base: data.base || window.FinSight.store.getState().base, positions: data.positions || [], cash: data.cash || [], fxRisk: fxRisk.data ?? null };
  return (
    <>
      {visibleCards(prefs).map((id) => {
        const def = CARD_DEFS[id]!;
        const r = def.render(input);
        const cls = r.signVal != null ? signClass(r.signVal) : '';
        const cash = CASH_CARDS.has(id) ? { title: 'Click to edit cash', 'data-cash-card': '1' } : {};
        return (
          <div {...cash} className="card" key={id}>
            <div className="label">{def.label}</div>
            <div className={`value ${cls}`}>{r.value}</div>
            <div className={`sub ${cls}`}>{r.sub || ''}</div>
          </div>
        );
      })}
    </>
  );
}
