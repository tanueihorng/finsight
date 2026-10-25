import { useStore } from 'zustand';
import { CARD_DEFS, moveCard, toggleCard } from './cards.ts';
import { cardPrefs, setCardPrefs } from './cardPrefs.ts';

// The summary-card part of the ⚙ Layout modal (#cards-list), rendered by the
// layout modal (F10); its RESET TO DEFAULT resets only the cards.
export default function CardsEditor() {
  const prefs = useStore(cardPrefs);
  return (
    <>
      {prefs.order.map((id) => {
        const on = prefs.enabled.includes(id);
        return (
          <div className={`card-edit-row ${on ? '' : 'off'}`} key={id}>
            <label><input type="checkbox" data-id={id} checked={on} onChange={(e) => setCardPrefs(toggleCard(cardPrefs.getState(), id, e.target.checked))} /> {CARD_DEFS[id]!.label}</label>
            <span className="ce-move">
              <button aria-label={`Move ${CARD_DEFS[id]!.label} up`} data-dir="up" data-id={id} onClick={() => setCardPrefs(moveCard(cardPrefs.getState(), id, 'up'))}>▲</button>
              <button aria-label={`Move ${CARD_DEFS[id]!.label} down`} data-dir="down" data-id={id} onClick={() => setCardPrefs(moveCard(cardPrefs.getState(), id, 'down'))}>▼</button>
            </span>
          </div>
        );
      })}
    </>
  );
}
