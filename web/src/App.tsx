import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { usePortfolio } from './api/queries.ts';
import { kestrelDock } from './features/kestrel/dock.ts';
import { setFooter } from './legacy/app.ts';
import { setChartHoldings } from './shell/chartHooks.ts';
import { columns, dropBefore, hiddenPanels, HIDE_ID, movePanel, saveLayout, type Side } from './shell/layout.ts';

// The whole page as one React app (X1). The markup, ids and classes are the
// pre-X1 index.html's, so styles.css, specs and the peek rules still apply.
// Each mount point is an island host (data-island): main.tsx's runtime gives
// it its own lazily loaded root, so a chunk failure stays in its panel, a
// moved panel keeps its state and a removed host unmounts (the PILOT-gate
// guarantees the specs check). Panels live in stable elements that the
// layout moves between the columns, as legacy did, with their head and body
// rendered into them through portals. Order and visibility: shell/layout.ts.
type HostProps = { id?: string; className?: string; title?: string; style?: object; [k: `data-${string}`]: string };
const Host = ({ island, as = 'div', ...rest }: { island: string; as?: 'div' | 'span' | 'label' } & HostProps) => {
  const Tag = as;
  return <Tag data-island={island} {...rest} />;
};
const contents = { display: 'contents' } as const;
const store = () => window.FinSight.store;
const open = (key: 'addFormOpen' | 'cashEditorOpen' | 'importOpen' | 'ledgerOpen') => store().setState({ [key]: true });
const ui = createStore<{ dragging: string | null; dropOn: Side | null }>()(() => ({ dragging: null, dropOn: null }));

const panelEls = new Map<string, HTMLDivElement>();
export const panelEl = (pid: string) => {
  let el = panelEls.get(pid);
  if (!el) { el = document.createElement('div'); panelEls.set(pid, el); }
  return el;
};
function Panel({ pid, id, className, headClass, title, head, children, hidden }: {
  pid: string; id?: string; className?: string; headClass?: string; title?: ReactNode; head?: ReactNode; children?: ReactNode; hidden?: boolean;
}) {
  const dragging = useStore(ui, (s) => s.dragging === pid);
  const hiddenIds = useStore(hiddenPanels);
  const el = panelEl(pid);
  const off = HIDE_ID[pid] ? hiddenIds.includes(HIDE_ID[pid]!) : false;
  useLayoutEffect(() => {
    el.className = ['panel', className, 'draggable-block', dragging && 'dragging'].filter(Boolean).join(' ');
    if (id) el.id = id; else el.removeAttribute('id');
    el.dataset.pid = pid;
    el.hidden = !!hidden;
    if (hidden) el.setAttribute('aria-label', 'Agent chat');
    el.style.display = off ? 'none' : '';
  });
  return createPortal(
    <>
      <div className={'panel-head' + (headClass ? ' ' + headClass : '')}>
        <span className="drag-grip" title="Drag to rearrange" draggable onDragStart={(e) => {
          ui.setState({ dragging: pid });
          e.dataTransfer.effectAllowed = 'move';
          try { e.dataTransfer.setData('text/plain', pid); e.dataTransfer.setDragImage(el, 12, 12); } catch { /* not supported */ }
        }} onDragEnd={() => { ui.setState({ dragging: null, dropOn: null }); saveLayout(); }}>⠿</span>
        {title}{head}
      </div>
      {children}
    </>, el);
}

function UndoButton() {
  const [title, setTitle] = useState('Undo the last change');
  return <button id="undo-btn" className="mini-btn" title={title} onClick={() => void window.FinSight.actions?.undo()}
    onMouseEnter={async () => { const t = await window.FinSight.actions?.undoTitle(); if (t) setTitle(t); }}>↶ UNDO</button>;
}
function KestrelDock() {
  const dock = useStore(kestrelDock);
  return (
    <Panel pid="kestrel" id="agent-dock" className={'agent-dock' + (dock.collapsed ? ' collapsed' : '')} headClass="agent-dock-head" hidden={!dock.visible}>
      <div className="agent-dock-body"></div>
      <span className="agent-dock-resize-slot" style={{ display: 'contents' }}></span>
    </Panel>
  );
}

const PANELS: Record<string, () => ReactNode> = {
  positions: () => (
    <Panel pid="positions" title={<span className="panel-title">PORTFOLIO &nbsp;·&nbsp; POSITIONS</span>} head={
      <div className="head-btns">
        <button id="add-toggle" className="mini-btn" onClick={() => store().setState({ addFormOpen: !store().getState().addFormOpen })}>+ ADD</button>
        <button id="cash-btn" className="mini-btn" title="Set uninvested cash per currency (counts toward net worth and FX exposure)" onClick={() => open('cashEditorOpen')}>CASH</button>
        <button id="import-btn" className="mini-btn" onClick={() => open('importOpen')}>IMPORT</button>
        <button id="export-btn" className="mini-btn" onClick={() => void window.FinSight.actions?.exportPortfolio()}>EXPORT</button>
        <UndoButton />
      </div>}>
      <Host island="add-form" id="add-view" />
      <Host island="positions" id="positions-view" />
    </Panel>
  ),
  performance: () => (
    <Panel pid="performance" title={<span className="panel-title">PORTFOLIO PERFORMANCE</span>} head={<div className="head-btns" data-island-slot="performance:head"></div>}>
      <Host island="performance" id="perf-body" className="chart-body muted" />
    </Panel>
  ),
  wealth: () => (
    <Panel pid="wealth" title={<span className="panel-title">NET WORTH &nbsp;·&nbsp; BREAKDOWN</span>} head={
      <div className="head-btns"><span className="muted small">invested by asset class + cash, per account</span>
        <button id="wealth-cash-btn" className="mini-btn" title="Edit cash balances" onClick={() => open('cashEditorOpen')}>EDIT CASH</button></div>}>
      <Host island="wealth" id="wealth-body" className="chart-body muted" />
    </Panel>
  ),
  allocation: () => (
    <Panel pid="allocation" title={<span className="panel-title">ALLOCATION</span>} head={<span data-island-slot="allocation:head"></span>}>
      <Host island="allocation" id="alloc-body" className="chart-body muted" />
    </Panel>
  ),
  heatmap: () => (
    <Panel pid="heatmap" title={<span className="panel-title">SECTOR HEATMAP</span>} head={<span data-island-slot="heatmap:head"></span>}>
      <Host island="heatmap" id="heatmap-body" className="heatmap-body muted" data-metric="day" />
    </Panel>
  ),
  watchlist: () => (
    <Panel pid="watchlist" title={<span className="panel-title">WATCHLIST</span>} head={<span data-island-slot="watchlist:head"></span>}>
      <div data-island-slot="watchlist-form:head"></div>
      <Host island="watchlist" id="watchlist" className="watchlist" />
    </Panel>
  ),
  alerts: () => (
    <Panel pid="alerts" title={<span className="panel-title">PRICE ALERTS</span>} head={<span data-island-slot="alerts:head"></span>}>
      <div data-island-slot="alerts-form:head"></div>
      <Host island="alerts" id="alerts" className="alerts" />
    </Panel>
  ),
  fxrisk: () => (
    <Panel pid="fxrisk" title={<span className="panel-title">FX RISK</span>} head={<span id="fxr-spot" className="dim small" data-island-slot="fxrisk:head"></span>}>
      <Host island="fxrisk" id="fxrisk" className="fxrisk" />
    </Panel>
  ),
  dividends: () => (
    <Panel pid="dividends" title={<span className="panel-title">DIVIDENDS</span>} head={<span id="div-ttm" className="dim small" data-island-slot="dividends:head"></span>}>
      <Host island="dividends" id="dividends" className="dividends muted" />
    </Panel>
  ),
  activity: () => (
    <Panel pid="activity" title={<span className="panel-title">RECENT ACTIVITY</span>} head={
      <button id="ledger-btn" className="mini-btn" title="All trades — fix dates/prices, realized gains by year" onClick={() => open('ledgerOpen')}>LEDGER</button>}>
      <Host island="activity" id="activity" className="activity" />
    </Panel>
  ),
  detail: () => (
    <Panel pid="detail" id="detail-panel" title={<span className="panel-title" id="detail-title">SECURITY DETAIL</span>} head={<span data-island-slot="detail:head"></span>}>
      <Host island="detail" id="detail-body" className="detail-body" />
    </Panel>
  ),
  kestrel: () => <KestrelDock />,
  news: () => (
    <Panel pid="news" title={<span className="panel-title">NEWS</span>} head={<span id="news-sym" className="dim small" data-island-slot="news:head"></span>}>
      <Host island="news" id="news" className="news muted" />
    </Panel>
  ),
  markets: () => (
    <Panel pid="markets" title={<span className="panel-title">WORLD MARKETS</span>} head={<span id="markets-time" className="dim small" data-island-slot="markets:head"></span>}>
      <Host island="markets" id="markets" className="markets" />
    </Panel>
  ),
  calendar: () => (
    <Panel pid="calendar" title={<span className="panel-title">ECON CALENDAR · FED · CPI · PCE</span>} head={<span className="dim small">no key</span>}>
      <Host island="calendar" id="calendar" className="calendar" />
    </Panel>
  ),
  worldbank: () => (
    <Panel pid="worldbank" title={<span className="panel-title">WORLD BANK · MACRO</span>}>
      <div className="wb-controls" data-island-slot="worldbank:head"></div>
      <Host island="worldbank" id="wb-body" className="wb-body muted" />
    </Panel>
  ),
  fred: () => (
    <Panel pid="fred" title={<span className="panel-title">US FED · MACRO (FRED)</span>} head={<span className="dim small">no key</span>}>
      <div className="wb-controls" data-island-slot="fred:head"></div>
      <Host island="fred" id="fred-body" className="wb-body muted" />
    </Panel>
  ),
  inflation: () => (
    <Panel pid="inflation" title={<span className="panel-title">US INFLATION · FED GAUGES</span>} head={<span data-island-slot="inflation:head"></span>}>
      <Host island="inflation" id="infl-body" className="wb-body muted" />
    </Panel>
  ),
};

// Drag-to-rearrange (F10): the dragged panel moves live as the pointer
// crosses another panel's middle; the order is saved when the drag ends.
// The panel elements are placed in their column after the column's own
// React children (the summary), in state order.
function Column({ side, children }: { side: Side; children?: ReactNode }) {
  const pids = useStore(columns, (c) => c[side]);
  const dropOn = useStore(ui, (s) => s.dropOn === side);
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => { const col = ref.current; if (col) for (const pid of pids) col.appendChild(panelEl(pid)); }, [pids]);
  // Native listeners: panels are portalled, so React's synthetic drag events
  // would not bubble from them to the column.
  useEffect(() => {
    const col = ref.current; if (!col) return;
    const over = (e: globalThis.DragEvent) => {
      const pid = ui.getState().dragging; if (!pid) return;
      e.preventDefault();
      if (ui.getState().dropOn !== side) ui.setState({ dropOn: side });
      const items = [...col.querySelectorAll<HTMLElement>(':scope > .panel.draggable-block:not(.dragging)')]
        .filter((el) => el.offsetParent !== null)
        .map((el) => { const r = el.getBoundingClientRect(); return { el: el.dataset.pid!, top: r.top, height: r.height }; });
      const before = dropBefore(items, e.clientY);
      const cur = columns.getState(), list = cur[side], at = list.indexOf(pid);
      const already = at >= 0 && (before == null ? at === list.length - 1 : list[at + 1] === before);
      if (!already) columns.setState(movePanel(cur, pid, side, before), true);
    };
    const leave = (e: globalThis.DragEvent) => { if (!col.contains(e.relatedTarget as Node | null)) ui.setState({ dropOn: null }); };
    const drop = (e: globalThis.DragEvent) => e.preventDefault();
    col.addEventListener('dragover', over); col.addEventListener('dragleave', leave); col.addEventListener('drop', drop);
    return () => { col.removeEventListener('dragover', over); col.removeEventListener('dragleave', leave); col.removeEventListener('drop', drop); };
  }, [side]);
  return (
    <section ref={ref} className={`col-${side}` + (dropOn ? ' drop-on' : '')}>
      {children}
    </section>
  );
}
// The NET WORTH / CASH cards open the cash editor. They are rendered by the
// summary island's own root, so this listens on the host natively.
function Summary() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const onClick = (e: MouseEvent) => { if ((e.target as Element).closest('[data-cash-card]')) open('cashEditorOpen'); };
    el.addEventListener('click', onClick); return () => el.removeEventListener('click', onClick);
  }, []);
  return <div ref={ref} className="summary" id="summary" data-island="summary" />;
}

function PanelRender({ render }: { render: () => ReactNode }) { return <>{render()}</>; }

// Effects of each portfolio load that are not a panel: the chart watch list
// and the footer's FX coverage note.
function PortfolioEffects() {
  const { data } = usePortfolio();
  useEffect(() => {
    if (!data) return;
    setChartHoldings(data.positions);
    if (data.fxMissing && data.fxMissing.length) setFooter(`Note: no FX rate for ${data.fxMissing.join(', ')} → shown unconverted.`);
  }, [data]);
  return null;
}

export default function App() {
  return (
    <>
      <div id="lock-screen" className="lock">
        <div className="lock-box">
          <div className="lock-logo"><img className="logo-img lock-logo-img" src="/icon.png" alt="" aria-hidden="true" /> FINSIGHT</div>
          <Host island="lock" style={contents} />
          <div className="lock-hint muted small">Locked behind your PIN. Data stays on this computer only.</div>
        </div>
      </div>

      <header className="topbar">
        <div className="brand">
          <img className="logo-img" src="/icon.png" alt="" aria-hidden="true" /> FINSIGHT<span className="dim">//</span><span className="amber">PERSONAL&nbsp;TERMINAL</span>
        </div>
        <div className="topbar-right">
          <span id="agent-toggle-slot" style={{ display: 'contents' }}></span>
          <Host as="label" island="account" className="base-sel" title="Account / portfolio — each holds its own positions" />
          <Host as="span" island="profile" style={contents} />
          <Host as="span" island="peek" style={contents} />
          <Host as="span" island="layout-button" style={contents} />
          <Host as="label" island="base" className="base-sel" title="Base currency — your whole portfolio is converted into this. You deposit SGD." />
          <span id="market-state" className="pill">MKT</span>
          <Host as="span" island="clock" id="clock" className="clock" />
          <Host as="span" island="lock-button" style={contents} />
        </div>
      </header>

      <Host island="command" className="cmdbar" />
      <Host island="status" />

      <main className="grid">
        <Column side="left">
          <Summary />
        </Column>
        <Column side="right" />
      </main>

      <footer className="statusbar">
        <Host as="span" island="footer" />
        <span className="dim">FREE DATA · NO API KEYS · YAHOO FINANCE + WORLD BANK + FRED · DATA MAY BE DELAYED · NOT INVESTMENT ADVICE</span>
      </footer>

      <Host island="import" id="import-modal-host" />
      <Host island="setup" />
      <Host island="layout" />
      <Host island="accounts" />
      <Host island="cash-editor" id="cash-modal-host" />
      <Host island="ledger" id="ledger-modal-host" />
      <div id="toasts" className="toasts"></div>
      <Host island="kestrel" />
      {Object.entries(PANELS).map(([pid, render]) => <PanelRender key={pid} render={render} />)}
      <PortfolioEffects />
    </>
  );
}
