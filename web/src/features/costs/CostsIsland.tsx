// FEAT-015 §1 After-cost returns: what the book made after withholding tax,
// split into price, FX, realized and dividends. Fees FinSight cannot see are
// shown as unknown, never as zero.
import { useEffect, useState } from 'react';
import { useCosts } from '../../api/queries.ts';
import { PanelHeadSlot } from '../../ui/PanelHeadSlot.tsx';
import { fmt, moneySigned, money, signClass } from '../../ui/format.ts';

export default function CostsIsland() {
  useEffect(() => { const el = document.getElementById('costs'); if (el) { el.tabIndex = 0; el.setAttribute('aria-label', 'Returns after costs'); } }, []);
  const q = useCosts(), d = q.data;
  const [rows, setRows] = useState(false);
  const head = <PanelHeadSlot island="costs">{d && <span className={signClass(d.totals.netGain)}>NET {moneySigned(d.base, d.totals.netGain, 0)}</span>}</PanelHeadSlot>;
  if (q.isError) return <>{head}<span className="down">{q.error.message}</span></>;
  if (!d) return <>{head}<span className="muted">Loading…</span></>;
  const t = d.totals, b = d.base;
  const line = (label: string, v: number | null, note?: string) => <tr key={label}><td>{label}{note && <span className="dim"> · {note}</span>}</td>
    <td className={'r ' + signClass(v)}>{v == null ? <span className="dim">unknown</span> : moneySigned(b, v, 0)}</td></tr>;
  const pct = (v: number | null | undefined, dd = 1) => v == null ? '—' : fmt(v, dd) + '%';
  return <>{head}
    <table className="tbl cs-tbl"><tbody>
      {line('Price, open positions', t.unrealizedPrice)}
      {line('FX, open positions', t.unrealizedFx)}
      {line('Realized price', t.realizedPrice)}
      {line('Realized FX', t.realizedFx)}
      {!!t.realizedLegacy && line('Realized, older sales', t.realizedLegacy, 'no price/FX split')}
      {line('Dividends, gross', t.divGross)}
      {line('Withholding tax', -t.withholding, t.withholdingPctOfGross == null ? undefined : pct(t.withholdingPctOfGross) + ' of gross')}
      {line('Broker fees', t.fees, 'not in the ledger')}
      <tr className="cs-total"><td>Net gain after recorded costs</td><td className={'r ' + signClass(t.netGain)}>{moneySigned(b, t.netGain, 0)}</td></tr>
      <tr><td>Fund expense ratios, per year <span className="dim">· already inside fund prices</span></td><td className="r dim">{money(b, t.annualFundFees, 0)} ({pct(t.fundFeePctOfBook, 2)} of holdings)</td></tr>
      {d.returns && <tr><td>Time-weighted / money-weighted return <span className="dim">· {d.returns.spanDays ?? '—'} days, before withholding</span></td>
        <td className="r">{pct(d.returns.twrPct)} / {pct(d.returns.mwrPct)}</td></tr>}
    </tbody></table>
    <div className="gr-actions"><button className="mini-btn" aria-expanded={rows} onClick={() => setRows(!rows)}>{rows ? 'HIDE' : 'SHOW'} BY HOLDING</button></div>
    {rows && <table className="tbl cs-tbl"><thead><tr><th>SYMBOL</th><th className="r">PRICE</th><th className="r">FX</th><th className="r">DIV NET</th><th className="r">TAX</th><th className="r">FUND FEE/YR</th></tr></thead><tbody>
      {d.rows.map((r) => <tr key={r.symbol} className={r.held ? '' : 'dim'}>
        <td>{r.symbol}{!r.held && ' (sold)'}</td>
        <td className={'r ' + signClass(r.pricePnl)}>{moneySigned(b, r.pricePnl, 0)}</td>
        <td className={'r ' + signClass(r.fxPnl)}>{moneySigned(b, r.fxPnl, 0)}</td>
        <td className="r">{r.divNet ? money(b, r.divNet, 0) : '—'}</td>
        <td className="r">{r.divTax ? money(b, r.divTax, 0) : '—'}</td>
        <td className="r">{r.annualFundFee != null ? `${money(b, r.annualFundFee, 0)} (${fmt(r.expenseRatioPct, 2)}%)` : r.isFund ? <span className="dim">unknown</span> : '—'}</td>
      </tr>)}
    </tbody></table>}
    <div className="fxr-note">{d.notes.join(' ')}</div>
  </>;
}
