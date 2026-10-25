import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { useDividends } from '../../api/queries.ts';
import { PanelHeadSlot } from '../../ui/PanelHeadSlot.tsx';
import { fmt, money } from '../../ui/format.ts';
function Cell({ label, value, sub, color = '' }: { label: string; value: ReactNode; sub: ReactNode; color?: string }) {
  return <div className="fxr-cell"><span className="k">{label}</span><span className={`v ${color}`}>{value}</span><span className="s">{sub}</span></div>;
}
export default function DividendsIsland() {
  useEffect(() => { const el = document.getElementById('dividends'); if (el) { el.tabIndex = 0; el.setAttribute('aria-label', 'Dividend income'); } }, []);
  // intended fix (B3): an old account's income response cannot replace a new
  // account's view. The query key scopes cache and cancellation to account/base.
  const q = useDividends(), d = q.data;
  const base = d?.base || window.FinSight.store.getState().base;
  const rc = d?.received || { ttm: { gross: d?.ttm, tax: 0, net: d?.ttm }, total: { gross: d?.total, tax: 0, net: d?.total } };
  const fw = d?.forwardTotal || { gross: 0, tax: 0, net: 0 };
  const head = <PanelHeadSlot island="dividends">{fw.net ? 'FWD ' + money(base, fw.net, 0) + '/yr net' : d?.count ? 'TTM ' + money(base, rc.ttm.net) : ''}</PanelHeadSlot>;
  if (q.isError) return <>{head}<span className="down">{q.error.message}</span></>;
  if (!d) return <>{head}Import a broker statement (IBKR) to see dividend income.</>;
  if (!d.count && !d.forward?.length) return <>{head}<span className="muted">No dividends yet — hold dividend payers, or import an IBKR statement to track income received.</span></>;
  const dd = (ms: number | null) => ms ? new Date(ms).toLocaleDateString('en-US', { month: 'short', day: '2-digit' }) : '—';
  const w = d.withholding || {};
  return <>{head}<div className="div-strip">
    {!!fw.gross && <Cell label="FORWARD / YR" value={money(base, fw.net, 0)} sub={`net · ${money(base, fw.gross, 0)} gross`} color="up" />}
    {!!fw.tax && <Cell label="WITHHOLDING / YR" value={money(base, fw.tax, 0)} sub="tax at source (est.)" color="down" />}
    {!!d.count && <><Cell label="RECEIVED · 12M" value={money(base, rc.ttm.net, 0)} sub={`net · ${money(base, rc.ttm.tax, 0)} withheld`} /><Cell label="ALL-TIME" value={money(base, rc.total.net, 0)} sub={`net · ${d.count} payments`} /></>}
  </div>{!!d.forward?.length && <><div className="fxr-sub">FORWARD INCOME · current holdings</div><table className="tbl div-tbl"><thead><tr><th>SYM</th><th className="r">/SHARE·YR</th><th className="r">YOC</th><th className="r">YIELD</th><th className="r">NET/YR</th><th className="r">NEXT EX</th></tr></thead><tbody>{d.forward.map((f) => <tr key={f.symbol}><td className="sym">{f.symbol}</td><td className="r">{fmt(f.perShare, 2)} <span className="dim">{f.currency}</span></td><td className="r">{f.yieldOnCost != null ? fmt(f.yieldOnCost, 2) + '%' : '—'}</td><td className="r">{f.currentYield != null ? fmt(f.currentYield, 2) + '%' : '—'}</td><td className="r up">{money(base, f.annualNet, 0)}</td><td className="r">{dd(f.nextEx)}{f.nextExEstimated && <span className="dim">~</span>}</td></tr>)}</tbody></table></>}
    {!!d.recent?.length && <><div className="fxr-sub">RECEIVED · net of withholding</div><div className="div-recent">{d.recent.slice(0, 8).map((r, i) => <div className="dr" key={i}><span>{r.date}</span><span className="ds">{r.symbol}</span><span>{money(base, r.baseNet ?? r.baseAmount)}{!!r.baseTax && <> <span className="dim">(−{money(base, r.baseTax)}{r.whtActual ? '' : ' est.'})</span></>}</span></div>)}</div></>}
    <div className="fxr-note">Withholding assumed: US {w.US ?? 30}% · SG {w.SG ?? 0}% · HK {w.HK ?? 0}% · EU {w.EU ?? 15}% (IBKR statements use the actual tax). Change with <b>WHT US 15</b>. ~ = estimated from payment history. YOC = yield on your cost.</div>
  </>;
}
