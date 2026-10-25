import { useEffect } from 'react';
import { useStore } from 'zustand';
import { CARD_DEFS, moveCard, toggleCard } from './cards.ts';
import { cardPrefs, resetCardPrefs, setCardPrefs } from './cardPrefs.ts';

// The summary-card part of the ⚙ Layout modal (#cards-list). The modal itself,
// themes and the panels list stay legacy until F8/F10.
export default function CardsEditorIsland() {
  const prefs = useStore(cardPrefs);
  // "RESET TO DEFAULT" sits in the legacy modal footer and resets only the cards.
  useEffect(() => {
    const btn = document.getElementById('cards-reset');
    btn?.addEventListener('click', resetCardPrefs);
    return () => btn?.removeEventListener('click', resetCardPrefs);
  }, []);
  return (
    <>
      {prefs.order.map((id) => {
        const on = prefs.enabled.includes(id);
        return (
          <div className={`card-edit-row ${on ? '' : 'off'}`} key={id}>
            <label><input type="checkbox" data-id={id} checked={on} onChange={(e) => setCardPrefs(toggleCard(cardPrefs.getState(), id, e.target.checked))} /> {CARD_DEFS[id]!.label}</label>
            <span className="ce-move">
              <button data-dir="up" data-id={id} onClick={() => setCardPrefs(moveCard(cardPrefs.getState(), id, 'up'))}>▲</button>
              <button data-dir="down" data-id={id} onClick={() => setCardPrefs(moveCard(cardPrefs.getState(), id, 'down'))}>▼</button>
            </span>
          </div>
        );
      })}
    </>
  );
}
