import { keyboardClick } from '../../ui/keyboard.ts';
import { useEffect, useMemo, useRef, type MouseEvent } from 'react';
import { useStore } from 'zustand';
import { api } from '../../api/client.ts';
import { useAccounts, useCategories, usePortfolio } from '../../api/queries.ts';
import { selectSymbol, setStatus } from '../../legacy/app.ts';
import { setLastPrices } from '../../state/store.ts';
import { fmt, money, moneySigned, signClass, signStr } from '../../ui/format.ts';
import type { Position } from '../../../../shared/types.ts';
import { confirmDialog } from '../../ui/dialog.tsx';
import { showToast } from '../../ui/toast.tsx';
import { openTrade, type Mode } from '../trade/trade.ts';
import { posView, setPosView } from './posView.ts';
import { tableModel, toggleCollapsed, toggleSort, priceFlashes, type Group, type Row, type SortKey, type Sums } from './table.ts';

// Positions table (D1). Renders the toolbar and table inside the legacy
// positions panel; the panel head (+ ADD, CASH, IMPORT, EXPORT, UNDO) and the
// add form stay legacy until D2–D4. Keeps the legacy ids and classes: specs,
// peek (body.unpeek #positions-body …) and styles.css all select on them.
const COLUMNS: [SortKey, string, boolean][] = [
  ['symbol', 'SYMBOL', false], ['quantity', 'QTY', true], ['avgCost', 'AVG', true], ['last', 'LAST', true],
  ['changePct', 'CHG%', true], ['marketValue', 'MKT VAL', true], ['unrealized', 'P&L', true],
  ['unrealizedPct', 'P&L%', true], ['fxPnl', 'FX P&L', true], ['weight', 'WT%', true],
];
const GROUPS: [Group, string][] = [['none', 'NONE'], ['class', 'ASSET CLASS'], ['account', 'ACCOUNT'], ['sector', 'SECTOR'], ['currency', 'CURRENCY']];
const store = () => window.FinSight.store;
const json = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const scopeQS = () => {
  const { base, account } = store().getState();
  return `?base=${encodeURIComponent(base)}&account=${encodeURIComponent(account || '')}`;
};

async function removeHolding(sym: string) {
  const ok = await confirmDialog({ title: `Remove ${sym}?`, body: 'This stops tracking the holding. It does not record a sale. UNDO brings it back.', ok: 'Remove', danger: true });
  if (!ok) return;
  try {
    await api('/api/portfolio/delete' + scopeQS(), json({ symbol: sym }));
  } catch (err) {
    // intended fix (D1): legacy let a failed delete reject unhandled, with no message.
    setStatus('DELETE failed: ' + (err as Error).message, 'err'); return;
  }
  setStatus(`REMOVED ${sym}`, 'ok');
  showToast(`Removed ${sym}`, { undoLabel: `Remove ${sym}` });
  if (store().getState().selected === sym) store().setState({ selected: null });
  await window.FinSight.bus.write('delete');
}
// In the combined view a split row belongs to one account; trade that one.
const rowAccount = (p: Row) => p.holdings?.find((h) => h.account === p.account)?.accountId ?? p.holdings?.[0]?.accountId;
const trade = (p: Row, mode: Mode) => { selectSymbol(p.symbol); openTrade(p.symbol, mode, rowAccount(p)); };

function SumCells({ base, s }: { base: string; s: Sums }) {
  return (
    <>
      <td className="r">{money(base, s.marketValue)}</td>
      <td className={`r ${signClass(s.unrealized)}`}>{moneySigned(base, s.unrealized)}</td>
      <td className={`r ${signClass(s.unrealizedPct)}`}>{signStr(s.unrealizedPct)}%</td>
      <td className={`r ${signClass(s.fxPnl)}`}>{moneySigned(base, s.fxPnl)}</td>
      <td className="r">{fmt(s.weight, 1)}</td>
    </>
  );
}

function PositionRow({ p, base, group, selected, flash, flashKey }: { p: Row; base: string; group: Group; selected: boolean; flash: string; flashKey: number }) {
  const accts = group !== 'account' && p.holdings && p.holdings.length > 1 ? ` · ${p.holdings.length} accts` : '';
  const act = (fn: () => void) => (e: MouseEvent) => { e.stopPropagation(); fn(); };
  return (
    // A flashing row remounts (new key), so the CSS animation runs again on every new price.
    <tr key={flash ? flashKey : 0} className={['clickable', selected && 'selected', flash].filter(Boolean).join(' ')} data-sym={p.symbol} tabIndex={0}
      onKeyDown={(e) => {
        // B / S on a focused row open the trade sheet; Enter/Space select it.
        const k = e.key.toLowerCase();
        if (e.target === e.currentTarget && !e.metaKey && !e.ctrlKey && !e.altKey && (k === 'b' || k === 's')) { e.preventDefault(); trade(p, k === 'b' ? 'buy' : 'sell'); return; }
        keyboardClick(e);
      }}
      onClick={() => selectSymbol(p.symbol)}>
      <td><span className="sym">{p.symbol}</span><div className="name">{String(p.name || '').slice(0, 20)} · <span className="ccy">{p.currency}</span>{accts}</div></td>
      <td className="r">{fmt(p.quantity, p.quantity % 1 ? 4 : 0)}</td>
      <td className="r">{fmt(p.avgCost)}</td>
      <td className="r">{fmt(p.last)}</td>
      <td className={`r ${signClass(p.changePct)}`}>{signStr(p.changePct)}%</td>
      <td className="r">{money(base, p.marketValue)}</td>
      <td className={`r ${signClass(p.unrealized)}`}>{moneySigned(base, p.unrealized)}</td>
      <td className={`r ${signClass(p.unrealizedPct)}`}>{signStr(p.unrealizedPct)}%</td>
      <td className={`r ${signClass(p.fxPnl)}`}>{p.currency === base ? <span className="dim">—</span> : moneySigned(base, p.fxPnl)}</td>
      <td className="r">{fmt(p.weight, 1)}</td>
      <td><div className="row-actions">
        <button aria-label={`Buy more ${p.symbol}`} title="Buy (B)" className="x-btn buy" data-act="buy" data-sym={p.symbol} onClick={act(() => trade(p, 'buy'))}>Buy</button>
        <button aria-label={`Sell ${p.symbol}`} title="Sell (S)" className="x-btn sell" data-act="sell" data-sym={p.symbol} data-qty={p.quantity} onClick={act(() => trade(p, 'sell'))}>Sell</button>
        <button aria-label={`Remove ${p.symbol}`} title="Remove from tracking" className="x-btn del" data-act="del" data-sym={p.symbol} onClick={act(() => void removeHolding(p.symbol))}>✕</button>
      </div></td>
    </tr>
  );
}

export default function PositionsIsland() {
  const portfolio = usePortfolio();
  const accounts = useAccounts();
  const view = useStore(posView);
  const selected = useStore(store(), (s) => s.selected);
  const account = useStore(store(), (s) => s.account);
  const data = portfolio.data;
  const positions: Position[] = data?.positions ?? [];
  const categories = useCategories(positions.map((p) => p.symbol)).data ?? {};
  const base = data?.base || store().getState().base;
  const accountName = accounts.data?.accounts.find((a) => a.id === account)?.name || 'Account';

  // Flash against the prices seen before this fetch, then record the new ones.
  // Keyed on dataUpdatedAt: an identical refetch keeps the same data object
  // but must still clear the previous flash, as legacy's full re-render did.
  const seen = useRef(store().getState().lastPrices);
  const flashes = useMemo(() => priceFlashes(seen.current, positions), [portfolio.dataUpdatedAt]); // deliberately not [positions]
  useEffect(() => {
    if (!positions.length) return;
    setLastPrices(store(), Object.fromEntries(positions.map((p) => [p.symbol, p.last])));
    seen.current = store().getState().lastPrices;
  }, [portfolio.dataUpdatedAt]); // deliberately not [positions]

  const model = tableModel(view, categories, positions, accountName);
  const row = (p: Row) => <PositionRow key={p.symbol + '|' + (p.account ?? '')} p={p} base={base} group={view.group}
    selected={selected === p.symbol} flash={flashes[p.symbol] || ''} flashKey={portfolio.dataUpdatedAt} />;
  const b = model.body;
  return (
    <>
      <div className="pos-toolbar">
        <div className="ranges" id="pos-filter" title="Filter by asset class">
          {model.chips.map((c) => (
            <button key={c.id} data-cls={c.id} aria-pressed={view.filter === c.id} className={view.filter === c.id ? 'active' : ''} title={money(base, c.value)}
              onClick={() => setPosView({ ...view, filter: c.id })}>
              {c.label}{c.pct != null && <> <span className="dim">{c.pct}</span></>}
            </button>
          ))}
        </div>
        <div className="pos-tools">
          <input id="pos-search" aria-label="Search positions" placeholder="SEARCH" autoComplete="off" value={view.q} onChange={(e) => setPosView({ ...view, q: e.target.value })} />
          <label className="pos-group">GROUP{' '}
            <select id="pos-group" value={view.group} onChange={(e) => setPosView({ ...view, group: e.target.value as Group })}>
              {GROUPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
        </div>
      </div>
      <div id="pos-scope" className={model.scope ? 'pos-scope' : 'pos-scope hidden'}>
        {model.scope && <>
          SHOWING {model.scope.shown} OF {model.scope.of} · {money(base, model.scope.sums.marketValue)} ({model.scope.pctOfInvested.toFixed(1)}% of invested) · P&amp;L{' '}
          <span className={signClass(model.scope.sums.unrealized)}>{moneySigned(base, model.scope.sums.unrealized)} ({signStr(model.scope.sums.unrealizedPct)}%)</span>
        </>}
      </div>
      <div className="table-wrap">
        <table className="tbl" id="positions">
          <thead>
            <tr id="pos-head">
              {COLUMNS.map(([k, label, right]) => (
                <th key={k} scope="col" tabIndex={0} onKeyDown={keyboardClick} aria-sort={view.sortKey === k ? (view.sortDir > 0 ? 'ascending' : 'descending') : 'none'} data-sort={k} className={[right && 'r', view.sortKey === k && 'sorted'].filter(Boolean).join(' ') || undefined}
                  data-dir={view.sortKey === k ? (view.sortDir > 0 ? '▲' : '▼') : ''} onClick={() => setPosView(toggleSort(view, k))}>{label}</th>
              ))}
              <th scope="col"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody id="positions-body">
            {b.kind === 'empty' && <tr><td colSpan={11} className="empty">No positions yet — add one above or type <b>ADD AAPL 10 195.50</b> in the command bar.</td></tr>}
            {b.kind === 'nomatch' && <tr><td colSpan={11} className="empty">No holdings match this filter.</td></tr>}
            {b.kind === 'rows' && b.rows.map(row)}
            {b.kind === 'groups' && b.groups.map((g) => [
              <tr key={'grp:' + g.key} className="grp-row" data-grp={g.key} tabIndex={0} aria-expanded={g.open} onKeyDown={keyboardClick} onClick={() => setPosView(toggleCollapsed(view, g.key))}>
                <td colSpan={5}><span className="grp-caret">{g.open ? '▾' : '▸'}</span> {g.key.toUpperCase()} <span className="dim">· {g.rows.length}</span></td>
                <SumCells base={base} s={g.sums} /><td></td>
              </tr>,
              ...(g.open ? g.rows.map(row) : []),
            ])}
          </tbody>
        </table>
      </div>
    </>
  );
}
