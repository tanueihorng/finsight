import { keyboardClick } from '../../ui/keyboard.ts';
import { useEffect } from 'react';
import { useMarkets } from '../../api/queries.ts';
import { selectSymbol } from '../../legacy/app.ts';
import { fmt, signClass, signStr } from '../../ui/format.ts';
import { PanelHeadSlot } from '../../ui/PanelHeadSlot.tsx';
import { marketState, priceDecimals, updatedLabel } from './markets.ts';
import styles from './Markets.module.css';

// World Markets (PILOT-1). Renders inside the legacy #markets body; the panel
// host, header and drag/hide stay with the legacy layout. 15 s polling comes
// from useMarkets(); it stops while locked and when this island unmounts.
export default function MarketsIsland() {
  const { data, error, isError, dataUpdatedAt } = useMarkets();

  // The topbar pill belongs to the shell (F8); until then this island updates it like legacy did.
  useEffect(() => {
    if (!data) return;
    const state = marketState(data, Date.now());
    const pill = document.getElementById('market-state');
    if (state && pill) { pill.textContent = state.text; pill.className = state.className; }
  }, [data, dataUpdatedAt]);

  const head = dataUpdatedAt ? <PanelHeadSlot island="markets">{updatedLabel(dataUpdatedAt)}</PanelHeadSlot> : null;
  if (isError) return <>{head}<div className="down small">Markets failed: {error.message}</div></>;
  if (!data) return head;
  return (
    <>
      {head}
      {Object.entries(data).map(([name, items]) => (
        <div className={styles.group} key={name}>
          <div className={styles.h}>{name.toUpperCase()}</div>
          {items.map((q) => ('error' in q
            ? <div className={styles.row} key={q.symbol}><span className={styles.label}>{q.label || q.symbol}</span><span className="muted small">n/a</span></div>
            : (
              <div className={styles.row} data-sym={q.symbol} key={q.symbol} role="button" tabIndex={0} onKeyDown={keyboardClick} onClick={() => selectSymbol(q.symbol)}>
                <span className={styles.label}>{q.label || q.symbol}</span>
                <span className={styles.px}>{fmt(q.price, priceDecimals(q.price))}</span>
                <span className={`${styles.chg} ${signClass(q.changePct)}`}>{signStr(q.changePct)}%</span>
              </div>
            )))}
        </div>
      ))}
    </>
  );
}
