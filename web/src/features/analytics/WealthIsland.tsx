import { useAccounts, useWealth } from '../../api/queries.ts';
import { fmt, money } from '../../ui/format.ts';
import { CLASS_COLORS, WEALTH_ORDER, wealthAccount, wealthTotals } from './analytics.ts';

// Net worth breakdown (C3): asset classes + cash, overall and per account.
// The EDIT CASH button stays in the legacy panel head (opens the D3 editor).
export default function WealthIsland() {
  const accounts = useAccounts();
  const wealth = useWealth(accounts.data?.accounts);
  if (wealth.error && !wealth.data) return <span className="muted">Breakdown unavailable: {wealth.error.message}</span>;
  if (!wealth.data) return <>Loading…</>;
  const { base, categories } = wealth.data;
  const accts = wealth.data.accounts.map((a) => wealthAccount(a.id, a.name, a.portfolio.positions, a.portfolio.cash || [], categories));
  const { tot, net, cashCcy, maxNet } = wealthTotals(accts);
  if (!net) return <span className="muted">Add positions or cash to see your breakdown.</span>;
  const seg = (parts: Record<string, number>, scale: number) => WEALTH_ORDER.filter((k) => parts[k]! > 0).map((k) => (
    <span key={k} className="w-seg" style={{ width: (parts[k]! / scale * 100).toFixed(3) + '%', background: CLASS_COLORS[k] }}
      title={`${k} · ${money(base, parts[k])} (${(parts[k]! / net * 100).toFixed(1)}% of net worth)`}></span>
  ));
  const rows = accts.length > 1 ? accts.filter((a) => a.net > 0).sort((a, b) => b.net - a.net) : [];
  return (
    <>
      <div className="w-head"><span className="muted small">NET WORTH</span><span className="w-total">{money(base, net)}</span></div>
      <div className="w-stack">{seg(tot, net)}</div>
      <div className="w-legend">{WEALTH_ORDER.filter((k) => tot[k]! > 0).map((k) => (
        <div key={k} className="w-lg"><span className="sw" style={{ background: CLASS_COLORS[k] }}></span><span className="w-lab">{k.toUpperCase()}</span>
          <span className="w-amt">{money(base, tot[k])}</span><span className="pct">{(tot[k]! / net * 100).toFixed(1)}%</span></div>
      ))}</div>
      {Object.keys(cashCcy).length > 0 && <div className="w-note">CASH · {Object.entries(cashCcy).map(([c, v]) => `${c} ${fmt(v)}`).join(' · ')}</div>}
      {rows.length > 0 && <>
        <div className="fxr-sub">BY ACCOUNT</div>
        <div className="w-rows">{rows.map((a) => (
          <div key={a.id} className="w-row"><span className="w-name" title={a.name}>{a.name}</span>
            <span className="w-track"><span className="w-bar" style={{ width: (a.net / maxNet * 100).toFixed(2) + '%' }}>{seg(a.parts, a.net)}</span></span>
            <span className="w-amt">{money(base, a.net)}</span><span className="pct">{(a.net / net * 100).toFixed(1)}%</span></div>
        ))}</div>
      </>}
    </>
  );
}
