import { usePortfolio } from '../../api/queries.ts';
import { fmt, signStr } from '../../ui/format.ts';
export default function ActivityIsland() {
  const { data } = usePortfolio();
  if (!data) return null;
  return data.transactions?.length ? <>{data.transactions.map((t, i) => {
    const cls = t.type === 'BUY' ? 't-buy' : t.type === 'SELL' ? 't-sell' : 't-del';
    const when = new Date(Number(t.time)).toLocaleString('en-US', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    const detail = t.type === 'DELETE' ? 'removed' : `${fmt(t.quantity, Number(t.quantity) % 1 ? 4 : 0)} @ ${fmt(t.price)}` + (t.realized != null ? `  ·  P&L ${signStr(t.realized)}` : '');
    return <div className="line" key={t.id || i}><span className="ts">{when}</span><span className={cls}>{t.type}</span><span className="sym amber">{t.symbol}</span><span className="muted">{detail}</span></div>;
  })}</> : <div className="muted small">No transactions yet.</div>;
}
