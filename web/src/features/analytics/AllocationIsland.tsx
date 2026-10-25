import { keyboardClick } from '../../ui/keyboard.ts';
import { useState } from 'react';
import { selectSymbol } from '../../legacy/app.ts';
import { PanelHeadSlot } from '../../ui/PanelHeadSlot.tsx';
import { allocationSlices, type AllocMode } from './analytics.ts';
import { usePositions } from './usePositions.ts';

// Allocation donut (C3). The HOLDING/SECTOR/CLASS/ACCOUNT switch renders into the panel head.
const MODES: [AllocMode, string][] = [['holding', 'HOLDING'], ['sector', 'SECTOR'], ['class', 'CLASS'], ['account', 'ACCOUNT']];
export default function AllocationIsland() {
  const { loaded, positions, categories, accountName } = usePositions();
  const [mode, setMode] = useState<AllocMode>('holding');
  const head = (
    <PanelHeadSlot island="allocation">
      <div className="ranges" id="alloc-mode">
        {MODES.map(([m, l]) => <button key={m} data-mode={m} aria-pressed={mode === m} className={mode === m ? 'active' : ''} onClick={() => setMode(m)}>{l}</button>)}
      </div>
    </PanelHeadSlot>
  );
  if (!loaded || !positions.length) return <>{head}<span className="muted">Add positions to see allocation.</span></>;
  const slices = allocationSlices(positions, mode, categories, accountName);
  const sym = (label: string) => (mode === 'holding' ? label : '');
  const pick = (label: string) => { if (sym(label)) selectSymbol(label); };
  return (
    <>
      {head}
      <div className="donut-wrap">
        <svg width="140" height="140" viewBox="0 0 140 140">
          {slices.map((s) => s.path
            ? <path key={s.label} d={s.path} fill={s.color} data-sym={sym(s.label)} role={mode === 'holding' ? 'button' : undefined} tabIndex={mode === 'holding' ? 0 : undefined} aria-label={mode === 'holding' ? `${s.label.slice(0, 18)} ${(s.frac * 100).toFixed(1)}%` : undefined} onKeyDown={keyboardClick} onClick={() => pick(s.label)} />
            : [<circle key={s.label} cx="70" cy="70" r="60" fill={s.color} data-sym={sym(s.label)} role={mode === 'holding' ? 'button' : undefined} tabIndex={mode === 'holding' ? 0 : undefined} aria-label={mode === 'holding' ? `${s.label.slice(0, 18)} ${(s.frac * 100).toFixed(1)}%` : undefined} onKeyDown={keyboardClick} onClick={() => pick(s.label)} />,
              <circle key={s.label + ':in'} cx="70" cy="70" r="36" fill="var(--panel)" />])}
        </svg>
        <div className="donut-legend">
          {slices.slice(0, 11).map((s) => (
            <div key={s.label} className="lg" data-sym={sym(s.label)} role={mode === 'holding' ? 'button' : undefined} tabIndex={mode === 'holding' ? 0 : undefined} onKeyDown={keyboardClick} onClick={() => pick(s.label)}>
              <span className="sw" style={{ background: s.color }}></span>{s.label.slice(0, 18)}<span className="pct">{(s.frac * 100).toFixed(1)}%</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
