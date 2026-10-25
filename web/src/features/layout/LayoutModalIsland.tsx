import { useStore } from 'zustand';
import AppearanceSection from '../topbar/AppearanceIsland.tsx';
import CardsEditor from '../summary/CardsEditorIsland.tsx';
import { resetCardPrefs } from '../summary/cardPrefs.ts';
import { hiddenPanels, PANELS, resetLayout, setPanelHidden } from './layout.ts';

// ⚙ CUSTOMISE LAYOUT (F10): appearance (F8), summary cards (C1) and panel
// show/hide, rendered here as plain components rather than nested islands.
const store = () => window.FinSight.store;
export default function LayoutModalIsland() {
  const open = useStore(store(), (s) => s.layoutOpen);
  const hidden = useStore(hiddenPanels);
  const close = () => store().setState({ layoutOpen: false });
  return (
    <div id="cards-modal" className={open ? 'modal' : 'modal hidden'} onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="modal-box">
        <div className="modal-head">
          <span className="panel-title">CUSTOMISE LAYOUT</span>
          <button id="cards-close" className="x-btn" onClick={close}>✕</button>
        </div>
        <div className="modal-body">
          <AppearanceSection />
          <div style={{ borderTop: '1px solid var(--border)', margin: '16px 0 12px' }}></div>
          <p className="muted small">Summary cards — tick the ones you want and use ▲▼ to reorder. Changes apply instantly.</p>
          <div id="cards-list" className="cards-list"><CardsEditor /></div>
          <div className="setup-label muted small" style={{ marginTop: 14 }}>PANELS — show / hide whole widgets</div>
          <div id="panels-list" className="cards-list">
            {PANELS.map(([id, label]) => {
              const on = !hidden.includes(id);
              return (
                <div key={id} className={'card-edit-row ' + (on ? '' : 'off')}>
                  <label><input type="checkbox" data-panel={id} checked={on} onChange={(e) => setPanelHidden(id, !e.target.checked)} /> {label}</label>
                </div>
              );
            })}
          </div>
          <div className="muted small" style={{ marginTop: 8 }}>Tip: drag the <b>⠿</b> grip in any panel's header to rearrange widgets (even between columns).
            {' '}<button id="layout-reset" className="mini-btn" onClick={resetLayout}>Reset order</button></div>
        </div>
        <div className="modal-foot">
          <button id="cards-reset" className="mini-btn" onClick={resetCardPrefs}>RESET TO DEFAULT</button>
          <button id="cards-done" className="mini-btn solid" onClick={close}>DONE</button>
        </div>
      </div>
    </div>
  );
}
