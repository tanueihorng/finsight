import type { CSSProperties } from 'react';
import { selectSymbol } from '../../legacy/app.ts';
import { fmt, signStr } from '../../ui/format.ts';
import { usePortfolio } from '../../api/queries.ts';

// Holdings ticker under the top bar: each held symbol's last price and day
// change, scrolling. Prices and day % are market data, so peek mode leaves it
// visible. The list is drawn twice for a seamless loop; the copy is hidden from
// assistive technology. Hover pauses it; reduced motion stops it.
export default function TickerIsland() {
  const positions = usePortfolio().data?.positions ?? [];
  if (!positions.length) return null;
  const items = (copy: boolean) => positions.map((p) => {
    const dir = p.changePct == null || p.changePct === 0 ? '' : p.changePct > 0 ? 'up' : 'down';
    return (
      <button key={(copy ? 'c-' : '') + p.symbol} type="button" className="tk-item" tabIndex={copy ? -1 : 0}
        aria-label={copy ? undefined : `View ${p.symbol}, ${fmt(p.last)} ${p.currency}, ${signStr(p.changePct)}% today`}
        onClick={() => selectSymbol(p.symbol)}>
        <b>{p.symbol}</b> {fmt(p.last)} <span className={dir}>{dir === 'up' ? '▲' : dir === 'down' ? '▼' : ''}{signStr(p.changePct)}%</span>
      </button>
    );
  });
  // About four seconds per holding keeps the pace readable at any list length.
  const style = { '--tk-duration': `${Math.max(30, positions.length * 4)}s` } as CSSProperties;
  return (
    <div className="tk-track" style={style}>
      <div className="tk-run" role="group" aria-label="Holdings, day change">{items(false)}</div>
      <div className="tk-run" aria-hidden="true">{items(true)}</div>
    </div>
  );
}
