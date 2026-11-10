import { useEffect, useState } from 'react';
import { agentApi } from './api.ts';
import { modelTokens, rateLabel, tokenLabel, USAGE_PERIODS, usdLabel, type UsagePeriod, type UsageReport } from './usage.ts';

// Tokens, search requests and cost from the agent's ledger, with the prices used.
export function UsagePanel() {
  const [period, setPeriod] = useState<UsagePeriod>('month');
  const [data, setData] = useState<UsageReport | null>(null), [err, setErr] = useState('');
  useEffect(() => {
    let live = true;
    setErr('');
    agentApi<UsageReport>(`/usage?period=${period}`).then((d) => { if (live) setData(d); }, (e: Error) => { if (live) setErr(e.message); });
    return () => { live = false; };
  }, [period]);
  const unsplit = !!data?.models.some((m) => m.unsplitTokens > 0);
  return (
    <div className="kx-usage" data-usage-panel>
      <div className="kx-usage-periods" role="group" aria-label="Usage period">
        {USAGE_PERIODS.map((p) => <button key={p.id} type="button" aria-pressed={period === p.id} className={period === p.id ? 'on' : ''} onClick={() => setPeriod(p.id)}>{p.label}</button>)}
      </div>
      {err && <div role="alert" className="down small">{err}</div>}
      {!data && !err && <p className="muted small">Loading…</p>}
      {data && <>
        <div className="kx-usage-tiles">
          <div><span>Total cost</span><b data-usage-total>{usdLabel(data.totals.usd)}</b></div>
          <div><span>Models</span><b>{usdLabel(data.totals.modelUsd)}</b></div>
          <div><span>Web search</span><b>{usdLabel(data.totals.webUsd)}</b></div>
          <div><span>Tokens</span><b>{tokenLabel(data.totals.tokens)}</b></div>
        </div>
        <h4>Models</h4>
        {data.models.length === 0 ? <p className="muted small">No model usage in this period.</p> : <div className="kx-usage-scroll"><table>
          <thead><tr><th>Model</th><th>Calls</th><th>Input</th><th>Cached</th><th>Output</th><th>Total</th><th>Cost</th></tr></thead>
          <tbody>{data.models.map((m) => <tr key={m.id}><td>{m.label}</td><td>{m.calls.toLocaleString()}</td><td>{tokenLabel(m.inputTokens)}</td><td>{tokenLabel(m.cacheReadTokens)}</td><td>{tokenLabel(m.outputTokens)}</td><td>{tokenLabel(modelTokens(m))}</td><td>{usdLabel(m.usd)}</td></tr>)}</tbody>
        </table></div>}
        <h4>Web search and fetch</h4>
        {data.web.length === 0 ? <p className="muted small">No paid web requests in this period.</p> : <div className="kx-usage-scroll"><table>
          <thead><tr><th>Provider</th><th>Type</th><th>Requests</th><th>Cost</th></tr></thead>
          <tbody>{data.web.map((w) => <tr key={w.provider + w.kind}><td>{w.label}</td><td>{w.kind === 'fetch' ? 'Fetch' : 'Search'}</td><td>{w.requests.toLocaleString()}</td><td>{usdLabel(w.usd)}</td></tr>)}</tbody>
        </table></div>}
        <h4>Prices used <span className="muted">checked {data.rates.checked}</span></h4>
        <div className="kx-usage-scroll"><table>
          <thead><tr><th>Model, per 1M tokens</th><th>Input</th><th>Cached</th><th>Output</th></tr></thead>
          <tbody>{data.rates.models.map((m) => m.cli
            ? <tr key={m.id}><td>{m.label}</td><td colSpan={3} className="muted">Cost reported by the CLI</td></tr>
            : <tr key={m.id}><td>{m.label}{m.notes.map((n) => <small key={n}>{n}</small>)}</td><td>{rateLabel(m.inputPerM)}</td><td>{rateLabel(m.cachedPerM)}</td><td>{rateLabel(m.outputPerM)}</td></tr>)}</tbody>
        </table></div>
        <div className="kx-usage-scroll"><table>
          <thead><tr><th>Search</th><th>Price</th><th>Per</th></tr></thead>
          <tbody>{data.rates.web.map((w) => <tr key={w.provider}><td>{w.label}<small>{w.note}</small></td><td>{rateLabel(w.usd)}</td><td>{w.unit}</td></tr>)}</tbody>
        </table></div>
        <p className="muted small">Estimates from provider-reported tokens and published prices, not invoices. Search is charged per request, so its result text counts as model input. Tavily and Brave use list prices; free monthly credits are not deducted. Cached is part of Input.{unsplit ? ' Total includes older usage recorded without an input and output split.' : ''}</p>
      </>}
    </div>
  );
}
