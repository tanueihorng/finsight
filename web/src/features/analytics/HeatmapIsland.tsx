import { useEffect, useState } from 'react';
import { selectSymbol } from '../../legacy/app.ts';
import { signStr } from '../../ui/format.ts';
import { PanelHeadSlot } from '../../ui/PanelHeadSlot.tsx';
import { heatColor, sectors, treemap } from './analytics.ts';
import { usePositions } from './usePositions.ts';

// Sector heatmap (C3): tiles sized by value, coloured by day or total %.
// The host keeps data-metric for peek (body.unpeek hides TOTAL %, a personal figure).
const W = 800, H = 380, pad = 2, labelH = 14;
export default function HeatmapIsland() {
  const { loaded, positions, categories } = usePositions();
  const [metric, setMetric] = useState<'day' | 'total'>('day');
  useEffect(() => {
    const host = document.getElementById('heatmap-body');
    if (host) host.dataset.metric = metric;
  }, [metric]);
  const head = (
    <PanelHeadSlot island="heatmap">
      <div className="ranges" id="heat-metric">
        {([['day', 'DAY %'], ['total', 'TOTAL %']] as const).map(([m, l]) =>
          <button key={m} data-metric={m} className={metric === m ? 'active' : ''} onClick={() => setMetric(m)}>{l}</button>)}
      </div>
    </PanelHeadSlot>
  );
  if (!loaded || !positions.length) return <>{head}<span className="muted">Add positions to see the heatmap.</span></>;
  return (
    <>
      {head}
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ height: 380 }}>
        {treemap(sectors(positions, categories).map((s) => ({ ...s })), 0, 0, W, H).map((sr) => {
          const showLbl = sr.w > 56 && sr.h > 26;
          const iy = sr.y + (showLbl ? labelH : pad), ih = sr.h - (showLbl ? labelH : pad) - pad, ix = sr.x + pad, iw = sr.w - 2 * pad;
          return (
            <g key={sr.category}>
              <rect x={sr.x} y={sr.y} width={sr.w} height={sr.h} fill="#0a0c10" stroke="#000" strokeWidth="2" />
              {showLbl && <text x={sr.x + 4} y={sr.y + 10} fill="#8aa0b5" fontSize="9" letterSpacing="0.5">{sr.category.toUpperCase().slice(0, Math.floor(sr.w / 6))}</text>}
              {iw > 2 && ih > 2 && treemap(sr.items.map((p) => ({ p, value: p.marketValue })), ix, iy, iw, ih).map((t) => {
                const pct = metric === 'day' ? t.p.changePct : t.p.unrealizedPct;
                return (
                  <g key={t.p.symbol} className="hm-tile" data-sym={t.p.symbol} style={{ cursor: 'pointer' }} onClick={() => selectSymbol(t.p.symbol)}>
                    <rect x={t.x} y={t.y} width={t.w} height={t.h} fill={heatColor(pct)} stroke="#050608" strokeWidth="1" />
                    {t.w > 32 && t.h > 24 && <>
                      <text x={t.x + t.w / 2} y={t.y + t.h / 2 - 1} fill="#fff" fontSize={Math.min(13, t.w / 4.2)} fontWeight="700" textAnchor="middle">{t.p.symbol}</text>
                      <text x={t.x + t.w / 2} y={t.y + t.h / 2 + 11} fill="#e6edf3" fontSize="9" textAnchor="middle">{signStr(pct)}%</text>
                    </>}
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>
    </>
  );
}
