import { useState } from 'react';
import { chartHooks } from '../../shell/chartHooks.ts';
import { FONTS, THEMES } from './topbar.ts';

// APPEARANCE in ⚙ Layout (F8): theme and font, system fonts only. The head
// script applies the saved choice before first paint.
const read = (key: string, fallback: string) => { try { return localStorage.getItem(key) || fallback; } catch { return fallback; } };
export default function AppearanceIsland() {
  const [theme, setTheme] = useState(() => read('finsight-theme', 'violet'));
  const [font, setFont] = useState(() => read('finsight-font', 'mono'));
  const apply = (key: 'theme' | 'font', id: string) => {
    try { localStorage.setItem('finsight-' + key, id); } catch { /* storage blocked */ }
    document.documentElement.dataset[key] = id;
    if (key === 'theme') { setTheme(id); chartHooks.repaint(); } else setFont(id);
  };
  return (
    <>
      <div className="setup-label muted small">APPEARANCE — theme</div>
      <div id="theme-list" className="swatch-row">
        {THEMES.map((t) => <button key={t.id} className={'swatch' + (t.id === theme ? ' on' : '')} data-theme={t.id} aria-pressed={t.id === theme} onClick={() => apply('theme', t.id)}>
          <span className="dot" style={{ background: t.accent }}></span>{t.label}</button>)}
      </div>
      <div className="setup-label muted small" style={{ marginTop: 12 }}>APPEARANCE — font</div>
      <div id="font-list" className="swatch-row">
        {FONTS.map((f) => <button key={f.id} className={'font-btn' + (f.id === font ? ' on' : '')} data-font={f.id} aria-pressed={f.id === font} onClick={() => apply('font', f.id)}>{f.label}</button>)}
      </div>
    </>
  );
}
