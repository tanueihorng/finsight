import { keyboardClick } from '../../ui/keyboard.ts';
import { useState, type KeyboardEvent } from 'react';
import { useDiscover } from '../../api/queries.ts';
import { selectSymbol } from '../../legacy/app.ts';
import { fmt, signClass, signStr } from '../../ui/format.ts';
import { PanelHeadSlot } from '../../ui/PanelHeadSlot.tsx';
import { priceDecimals } from '../markets/markets.ts';
import type { DiscoverMover } from '../../../../shared/types.ts';
import { asOfLabel, earningsWhen, excludedSummary, excludedTitle, member, nextRow, ROWS, staleNote, tzShort } from './discover.ts';
import styles from './Discover.module.css';

// Discover (FEAT-010, first slice): gainers, losers and upcoming earnings among
// your holdings and watchlist. Not market-wide; the panel says so. Rows open
// the existing detail chart; nothing here places or suggests a trade.
function arrows(e: KeyboardEvent<HTMLElement>) {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
  const rows = Array.from(e.currentTarget.querySelectorAll('[data-row]'));
  const to = nextRow(rows, document.activeElement as Element, e.key);
  if (to) { e.preventDefault(); (to as HTMLElement).focus(); }
}

function Movers({ title, rows, empty }: { title: string; rows: DiscoverMover[]; empty: string }) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, ROWS);
  return <section className={styles.col} aria-label={title}>
    <h3 className={styles.h}>{title} <span className="dim">{rows.length}</span></h3>
    {shown.length ? shown.map((r) => {
      const stale = staleNote(r);
      return <div className={styles.row} data-row data-sym={r.symbol} key={r.symbol} role="button" tabIndex={0}
        onKeyDown={keyboardClick} onClick={() => selectSymbol(r.symbol)}>
        <span className={styles.sym}>{r.symbol}<span className={styles.tag}>{member(r)}</span>{stale && <span className={styles.stale} title={stale}>stale<span className="sr-only">: {stale}</span></span>}</span>
        <span className={styles.px}>{fmt(r.price, priceDecimals(r.price))} <span className="dim">{r.currency}</span></span>
        <span className={`${styles.chg} ${signClass(r.changePct)}`}>{signStr(r.changePct)}%</span>
      </div>;
    }) : <div className="muted small">{empty}</div>}
    {rows.length > ROWS && <button className={`mini-btn ${styles.more}`} aria-expanded={all} onClick={() => setAll((v) => !v)}>{all ? 'Show fewer' : `Show all ${rows.length}`}</button>}
  </section>;
}

export default function DiscoverIsland() {
  const { data, error, isError, isPending } = useDiscover();
  const head = data ? <PanelHeadSlot island="discover">{asOfLabel(data.asOf)} · delayed</PanelHeadSlot> : null;
  if (isError) return <><div className="down small" role="alert">Discover failed: {error.message}</div></>;
  if (isPending || !data) return <span className="muted small">Loading movers…</span>;
  const s = data.scope;
  if (!s.held && !s.watched) return <>{head}<div className="muted small">Add holdings or watch a symbol to see movers among them.</div></>;
  const earn = data.earnings;
  return <>
    {head}
    <div className={styles.scope}>
      Ranked among <b>{s.ranked}</b> of {s.held} held + {s.watched} watched symbols (overlap counted once) — not the whole market.
      {' '}Regular session vs previous close, each on its own exchange · {data.basis.source}, delayed.
      {!!s.unchanged && <> {s.unchanged} unchanged.</>}
      {!!data.excluded.length && <> <span className={styles.excl} title={excludedTitle(data.excluded)} tabIndex={0}>Excluded: {excludedSummary(data.excluded)}</span>.</>}
    </div>
    <div className={styles.grid} onKeyDown={arrows}>
      <Movers title="GAINERS" rows={data.gainers} empty="No gainers among your symbols." />
      <Movers title="LOSERS" rows={data.losers} empty="No losers among your symbols." />
      <section className={styles.col} aria-label="Upcoming earnings">
        <h3 className={styles.h}>EARNINGS · next {earn.horizonDays}d <span className="dim">{earn.items.length}</span></h3>
        {!earn.ok && <div className="down small">Earnings dates unavailable right now{earn.items.length ? ' — list may be incomplete' : ''}.</div>}
        {earn.items.length ? earn.items.map((e) => {
          const w = earningsWhen(e);
          return <div className={styles.row} data-row data-sym={e.symbol} key={e.symbol + e.t} role="button" tabIndex={0}
            onKeyDown={keyboardClick} onClick={() => selectSymbol(e.symbol)}>
            <span className={styles.sym}>{e.symbol}<span className={styles.tag}>{member(e)}</span></span>
            <span className={styles.when}>{w.date}{e.estimated && <span className="dim" title="Estimated date"> ~est<span className="sr-only">imated</span></span>} <span className="dim">{tzShort(e.tz)}</span></span>
            <span className={styles.rel}>{w.rel}</span>
          </div>;
        }) : earn.ok && <div className="muted small">No earnings dates in the next {earn.horizonDays} days.</div>}
      </section>
    </div>
  </>;
}
