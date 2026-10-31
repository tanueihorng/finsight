import { keyboardClick } from '../../ui/keyboard.ts';
import { useRef, useState, type KeyboardEvent } from 'react';
import { useDiscover } from '../../api/queries.ts';
import { selectSymbol } from '../../legacy/app.ts';
import { fmt, fmtBig, signClass, signStr } from '../../ui/format.ts';
import { PanelHeadSlot } from '../../ui/PanelHeadSlot.tsx';
import { priceDecimals } from '../markets/markets.ts';
import type { DiscoverResponse, IpoDeal } from '../../../../shared/types.ts';
import { asOfLabel, earningsWhen, excludedSummary, excludedTitle, ipoPrice, ipoWhen, member, nextRow, readTab, ROWS, saveTab, staleNote, TABS, tzShort, type Tab } from './discover.ts';
import styles from './Discover.module.css';

// Discover (FEAT-010). Three views:
//   Your symbols — movers and earnings among holdings + watchlist (not market-wide).
//   US market    — Yahoo's Day Gainers / Day Losers screens (Yahoo's criteria).
//   IPOs         — Nasdaq's US IPO calendar; expected dates are tentative.
// Rows open the existing detail chart; nothing here places or suggests a trade.
function arrows(e: KeyboardEvent<HTMLElement>) {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
  const rows = Array.from(e.currentTarget.querySelectorAll('[data-row]'));
  const to = nextRow(rows, document.activeElement as Element, e.key);
  if (to) { e.preventDefault(); (to as HTMLElement).focus(); }
}

interface MoverRow { symbol: string; price: number; currency: string; changePct: number; held: boolean; watched: boolean; marketCap?: number | null; staleReason?: 'cached-after-failure' | 'old-session' | null; marketTime: number | null }
function Movers({ title, rows, empty, cap }: { title: string; rows: MoverRow[]; empty: string; cap?: boolean }) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, ROWS);
  return <section className={styles.col} aria-label={title}>
    <h3 className={styles.h}>{title} <span className="dim">{rows.length}</span></h3>
    {shown.length ? shown.map((r) => {
      const stale = r.staleReason !== undefined ? staleNote(r as Parameters<typeof staleNote>[0]) : null;
      const tag = r.held || r.watched ? member(r) : null;
      return <div className={styles.row} data-row data-sym={r.symbol} key={r.symbol} role="button" tabIndex={0}
        onKeyDown={keyboardClick} onClick={() => selectSymbol(r.symbol)}>
        <span className={styles.sym}>{r.symbol}{tag && <span className={styles.tag}>{tag}</span>}{stale && <span className={styles.stale} title={stale}>stale<span className="sr-only">: {stale}</span></span>}</span>
        <span className={styles.px}>{fmt(r.price, priceDecimals(r.price))} <span className="dim">{cap ? (r.marketCap ? '$' + fmtBig(r.marketCap) + ' cap' : 'cap n/a') : r.currency}</span></span>
        <span className={`${styles.chg} ${signClass(r.changePct)}`}>{signStr(r.changePct)}%</span>
      </div>;
    }) : <div className="muted small">{empty}</div>}
    {rows.length > ROWS && <button className={`mini-btn ${styles.more}`} aria-expanded={all} onClick={() => setAll((v) => !v)}>{all ? 'Show fewer' : `Show all ${rows.length}`}</button>}
  </section>;
}

function Yours({ data }: { data: DiscoverResponse }) {
  const s = data.scope, earn = data.earnings;
  if (!s.held && !s.watched) return <div className="muted small">Add holdings or watch a symbol to see movers among them. The US market and IPO views work without them.</div>;
  return <>
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

function Market({ data }: { data: DiscoverResponse }) {
  const m = data.market, t = m.totals;
  return <>
    <div className={styles.scope}>
      {m.criteria} Showing the top {m.gainers.length} of {t.gainers ?? '—'} gainers and {m.losers.length} of {t.losers ?? '—'} losers.
      {' '}Regular session vs previous close · {m.source}, delayed · {asOfLabel(m.asOf)} (your time). SG/HK not covered. A listing here is not a recommendation; it does not explain why a stock moved.
    </div>
    {m.error && <div className="down small" role="alert">{m.gainers.length || m.losers.length ? 'Part of the US market list is unavailable' : 'US market movers unavailable right now'}: {m.error}</div>}
    {m.stale && <div className="down small">Showing the last cached list (cached {m.cachedAt ? new Date(m.cachedAt).toLocaleTimeString('en-US', { hour12: false }) : '—'}); the live refresh failed.</div>}
    <div className={styles.grid} onKeyDown={arrows}>
      <Movers title="US GAINERS" rows={m.gainers} empty={m.error ? 'Unavailable.' : 'No gainers listed.'} cap />
      <Movers title="US LOSERS" rows={m.losers} empty={m.error ? 'Unavailable.' : 'No losers listed.'} cap />
    </div>
  </>;
}

function Deal({ d }: { d: IpoDeal }) {
  const w = ipoWhen(d);
  return <div className={styles.ipo} data-row tabIndex={-1} data-deal={d.id}>
    <span className={styles.when}>{w}</span>
    <span className={styles.co}><span className={styles.sym}>{d.symbol || '—'}</span> {d.company}<span className="dim"> · {d.exchange || 'exchange TBA'}</span></span>
    <span className={styles.px}>{ipoPrice(d)}{d.offerAmount != null && <span className="dim"> · ${fmtBig(d.offerAmount)}</span>}</span>
    <span className={styles.links}><a href={d.url} target="_blank" rel="noopener noreferrer">Nasdaq ↗</a> <a href={d.secUrl} target="_blank" rel="noopener noreferrer" title="Search SEC EDGAR filings (prospectus) by company name">SEC ↗</a></span>
  </div>;
}

function Ipos({ data }: { data: DiscoverResponse }) {
  const i = data.ipos;
  return <>
    <div className={styles.scope}>
      US IPOs from the {i.source} ({i.months.join(', ')} · last updated {i.lastUpdated || '—'}). Expected dates and price ranges are <b>tentative</b> and often move; dates are US Eastern days.
      {' '}{i.counts.filed} filed and {i.counts.withdrawn} withdrawn deals not listed. Subscription, grey-market and broker data are not available.
    </div>
    {i.error && <div className="down small" role="alert">{i.upcoming.length || i.priced.length ? 'Part of the IPO calendar is unavailable' : 'IPO calendar unavailable right now'}: {i.error}</div>}
    {i.stale && <div className="down small">Showing the last cached calendar; the live refresh failed.</div>}
    <section aria-label="Upcoming IPOs" onKeyDown={arrows}>
      <h3 className={styles.h}>UPCOMING · expected dates tentative <span className="dim">{i.upcoming.length}</span></h3>
      {i.upcoming.length ? i.upcoming.map((d) => <Deal d={d} key={d.id} />) : <div className="muted small">{i.error ? 'Unavailable.' : 'No upcoming IPOs listed.'}</div>}
      <h3 className={styles.h}>PRICED · last 14 days <span className="dim">{i.priced.length}</span></h3>
      {i.priced.length ? i.priced.map((d) => <Deal d={d} key={d.id} />) : <div className="muted small">{i.error ? 'Unavailable.' : 'None priced in the last 14 days.'}</div>}
    </section>
  </>;
}

const LABEL: Record<Tab, string> = { yours: 'Your symbols', market: 'US market', ipos: 'IPOs' };
export default function DiscoverIsland() {
  const { data, error, isError, isPending } = useDiscover();
  const [tab, setTab] = useState<Tab>(readTab);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const choose = (t: Tab, focus = false) => { setTab(t); saveTab(t); if (focus) tabs.current[TABS.indexOf(t)]?.focus(); };
  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const i = TABS.indexOf(tab);
    const to = e.key === 'ArrowRight' ? TABS[(i + 1) % TABS.length] : e.key === 'ArrowLeft' ? TABS[(i + TABS.length - 1) % TABS.length] : e.key === 'Home' ? TABS[0] : e.key === 'End' ? TABS[TABS.length - 1] : null;
    if (to) { e.preventDefault(); choose(to, true); }
  };
  const asOf = data ? (tab === 'yours' ? data.asOf : tab === 'market' ? data.market.asOf : null) : null;
  const head = data ? <PanelHeadSlot island="discover">{tab === 'ipos' ? 'tentative dates' : asOfLabel(asOf) + ' · delayed'}</PanelHeadSlot> : null;
  return <>
    {head}
    <div role="tablist" aria-label="Discover views" className={styles.tabs}>
      {TABS.map((t, i) => <button key={t} ref={(el) => { tabs.current[i] = el; }} role="tab" id={`discover-tab-${t}`} aria-controls="discover-view"
        aria-selected={tab === t} tabIndex={tab === t ? 0 : -1} className={`${styles.tab} ${tab === t ? styles.on : ''}`} onClick={() => choose(t)} onKeyDown={onTabKey}>{LABEL[t]}</button>)}
    </div>
    <div role="tabpanel" id="discover-view" aria-labelledby={`discover-tab-${tab}`}>
      {isError ? <div className="down small" role="alert">Discover failed: {error.message}</div>
        : isPending || !data ? <span className="muted small">Loading…</span>
        : tab === 'yours' ? <Yours data={data} /> : tab === 'market' ? <Market data={data} /> : <Ipos data={data} />}
    </div>
  </>;
}
