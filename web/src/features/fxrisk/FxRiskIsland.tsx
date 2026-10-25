import { Fragment, useState, type ReactNode } from 'react';
import { useFxRisk, usePortfolio } from '../../api/queries.ts';
import { PanelHeadSlot } from '../../ui/PanelHeadSlot.tsx';
import { fmt, money, moneyBig, moneySigned, signClass, signStr } from '../../ui/format.ts';
import { shock, targetExposure, conversion } from './fxrisk.ts';
function Cell({ label, value, sub, color = '', subColor = '' }: { label: string; value: ReactNode; sub: ReactNode; color?: string; subColor?: string }) {
  return <div className="fxr-cell"><span className="k">{label}</span><span className={`v ${color}`}>{value}</span><span className={`s ${subColor}`}>{sub}</span></div>;
}
export default function FxRiskIsland() {
  const { data: d } = useFxRisk(), { data: portfolio } = usePortfolio();
  const [slider, setSlider] = useState('0'), [convert, setConvert] = useState('');
  const [target, setTarget] = useState(() => { try { return localStorage.getItem('finsight-fx-target') || ''; } catch { return ''; } });
  const base = d?.base || window.FinSight.store.getState().base, exposures = d?.exposures || [], dom = exposures[0];
  const head = <PanelHeadSlot island="fxrisk">{dom ? `${dom.ccy}/${base} ${fmt(dom.nowRate, 4)}` : ''}</PanelHeadSlot>;
  // Like legacy, a failed refresh retains the last successful query data.
  if (!d) return <>{head}<span className="muted">Hold foreign-currency stocks (e.g. USD) on an SGD base to track currency exposure.</span></>;
  if (!dom) return <>{head}<span className="muted">{d.totalValue > 0 ? `No foreign-currency holdings — your book is all in ${base}, so there's no FX risk to track.` : 'No positions yet — add holdings (in a foreign currency) to track FX risk.'}</span></>;
  const multi = exposures.length > 1, foreign = d.foreignBase || 0, total = d.totalValue || 0;
  const pct = parseFloat(slider), wi = shock(foreign, pct), t = targetExposure(total, foreign, target), c = conversion(convert, dom.nowRate, dom.sigmaWeeklyPct || 0);
  const summary = portfolio?.summary, rfx = summary?.realizedFxPnl, legacySells = summary?.realizedLegacy || 0;
  return <>{head}<div className="fxr-strip">{exposures.map((e) => <Fragment key={e.ccy}>
    <Cell label={`${e.ccy} EXPOSURE`} value={moneyBig(base, e.notionalBase)} sub={`${fmt(e.pct, 0)}% of book · ${money(e.ccy, e.notionalNative, 0)}${e.cashBase ? ' · incl. cash' : ''}`} />
    <Cell label="BLENDED ENTRY" value={fmt(e.blendedEntry, 4)} sub={`avg ${e.ccy}/${base} cost`} />
    <Cell label="SPOT" value={fmt(e.nowRate, 4)} color={signClass(e.driftPct)} subColor={signClass(e.driftPct)} sub={`${signStr(e.driftPct)}% vs entry`} />
    <Cell label="FX P&L" value={moneySigned(base, e.fxPnl)} color={signClass(e.fxPnl)} subColor={signClass(e.fxPnl)} sub={`${signStr(e.fxPnlPct)}% · currency only`} />
  </Fragment>)}{rfx != null && !!(rfx || summary?.realizedStockPnl) && <Cell label="REALIZED FX" value={moneySigned(base, rfx)} color={signClass(rfx)} sub={legacySells ? `closed · excl. ${legacySells} pre-FX-tracking` : 'closed trades · currency'} />}
    {!!d.vol?.oneSigmaBase && <Cell label="1σ MOVE / WK" value={`±${money(base, d.vol.oneSigmaBase, 0)}`} sub={`σ ${fmt(d.vol.sigmaWeeklyPct, 2)}%/wk · 95% ${money(base, d.vol.var95Base, 0)}`} />}</div>
    <div className="fxr-sub">PER-BUY FX HISTORY · gain/loss from currency alone</div>
    <table className="tbl fxr-tbl"><thead><tr><th>DATE</th><th>SYM</th><th className="r">{multi ? 'FX' : dom.ccy + '/' + base} @BUY</th><th className="r">NOW</th><th className="r">FX P&L</th></tr></thead><tbody>{d.lots?.length ? d.lots.map((l, i) => <tr key={i}>
      <td>{l.t ? new Date(l.t).toLocaleDateString('en-US', { year: '2-digit', month: 'short', day: '2-digit' }) : '—'}</td><td className="sym">{l.symbol}</td><td className="r">{multi && <span className="dim">{l.currency}/{base} </span>}{fmt(l.entryRate, 4)}</td><td className="r">{fmt(l.nowRate, 4)}</td><td className={`r ${signClass(l.fxPnl)}`}>{moneySigned(base, l.fxPnl)}{!l.dated ? <span className="dim"> no date</span> : l.recent ? <span className="dim"> settling</span> : null}</td>
    </tr>) : <tr><td colSpan={5} className="muted small">No purchases recorded yet.</td></tr>}</tbody></table>
    <div className="fxr-whatif"><div className="fxr-wi-head"><span className="fxr-sub">WHAT-IF · {multi ? 'foreign-FX' : dom.ccy + '/' + base} shock</span><span id="fxr-shock" className="cyan">{pct > 0 ? '+' : ''}{pct.toFixed(1)}%</span></div>
      <input id="fxr-slider" aria-label="Foreign currency shock" type="range" min="-15" max="15" step="0.5" value={slider} onChange={(e) => setSlider(e.target.value)} />
      <div className="fxr-wi-out"><span className="muted">impact on book <b id="fxr-impact" className={signClass(wi.impact)}>{moneySigned(base, wi.impact)}</b></span><span className="muted">new value <b id="fxr-newval">{money(base, wi.value)}</b></span></div></div>
    <div className="fxr-tools"><div className="tool"><span className="fxr-sub" style={{ margin: 0 }}>TARGET EXPOSURE</span><br />Keep <input id="fxr-target" aria-label="Target foreign exposure percent" type="number" min="0" max="100" step="1" placeholder="e.g. 70" value={target} onChange={(e) => { setTarget(e.target.value); try { localStorage.setItem('finsight-fx-target', e.target.value); } catch { /* storage may be blocked */ } }} /> % in foreign currency
      <div id="fxr-target-out" className="muted">Now <b>{fmt(t.current, 1)}%</b>{t.gap == null ? <> foreign ({money(base, foreign, 0)} of {money(base, total, 0)}).</> : <>. {t.onTarget ? <span className="up">On target.</span> : t.gap > 0 ? <>To reach {fmt(t.pct, 0)}%: move <b>{money(base, t.gap, 0)}</b> into foreign currency.</> : <>To reach {fmt(t.pct, 0)}%: bring <b>{money(base, -t.gap, 0)}</b> back to {base}.</>}</>}</div></div>
      <div className="tool"><span className="fxr-sub" style={{ margin: 0 }}>CONVERT NOW vs LATER · {dom.ccy}</span><br />Convert <input id="fxr-conv" aria-label="Amount to convert" type="number" min="0" step="100" placeholder={`${base} amount`} value={convert} onChange={(e) => setConvert(e.target.value)} /> {base}
        <div id="fxr-conv-out" className="muted">{!c ? <>Spot {fmt(dom.nowRate, 4)} · your blended entry {fmt(dom.blendedEntry, 4)} ({signStr(dom.driftPct)}%).</> : <>Now: <b>{money(dom.ccy, c.now, 0)}</b> at {fmt(dom.nowRate, 4)}.{c.band && <><br />In a month, 2 in 3 outcomes: <b>{money(dom.ccy, c.band.min, 0)} – {money(dom.ccy, c.band.max, 0)}</b> (rate {fmt(c.band.lo, 4)}–{fmt(c.band.hi, 4)}). Waiting is a ±{money(dom.ccy, c.band.spread, 0)} coin flip.</>}</>}</div></div></div>
    <div className="fxr-note">Currency risk adds volatility with little long-run expected return — it bites most over short horizons and drawdowns. Informational only; no trades are placed.</div>
  </>;
}
