import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useWorldBank } from '../../api/queries.ts';
import { PanelHeadSlot } from '../../ui/PanelHeadSlot.tsx';
import { Spark } from '../../ui/Spark.tsx';
import { fmt, fmtBig } from '../../ui/format.ts';
import { worldBankOptions } from './options.ts';
export default function WorldBankIsland() {
  const [draft, setDraft] = useState('US');
  const [selection, setSelection] = useState({ country: 'US', indicator: 'NY.GDP.MKTP.CD' });
  const client = useQueryClient(), q = useWorldBank(selection.country, selection.indicator);
  const load = (indicator = selection.indicator) => {
    const country = draft.trim().toUpperCase() || 'US';
    if (country === selection.country && indicator === selection.indicator) { void q.refetch(); return; }
    void client.invalidateQueries({ queryKey: ['worldbank', country, indicator], refetchType: 'none' });
    setSelection({ country, indicator });
  };
  const head = <PanelHeadSlot island="worldbank"><input id="wb-country" aria-label="Country ISO code" value={draft} maxLength={3} title="ISO country code (US, GB, DE, JP, CN, IN, SG, WLD...)" onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') load(); }} /><select id="wb-indicator" aria-label="World Bank indicator" value={selection.indicator} onChange={(e) => load(e.target.value)}>{worldBankOptions.map((o) => <option value={o.value} key={o.value}>{o.label}</option>)}</select><button id="wb-go" className="mini-btn" onClick={() => load()}>LOAD</button></PanelHeadSlot>;
  if (q.isFetching || (!q.data && !q.isError)) return <>{head}<span className="muted">Loading World Bank data…</span></>;
  if (q.isError) return <>{head}<span className="down">World Bank error: {q.error.message}</span></>;
  const d = q.data, latest = d?.series.at(-1);
  if (!d || !latest) return <>{head}<span className="muted">No data for {selection.country}.</span></>;
  const isPct = /%/.test(d.label) || /ZS|ZG/.test(selection.indicator);
  return <>{head}<div className="wb-headline"><span className="wb-val">{isPct ? fmt(latest.value, 2) + '%' : fmtBig(latest.value)}</span><span className="wb-yr">{d.countryName} · {latest.year}</span></div><div className="wb-label">{d.label} · annual, latest available (use FRED for monthly)</div><Spark points={d.series.map((s) => ({ c: s.value }))} up={latest.value >= d.series[0]!.value} /></>;
}
