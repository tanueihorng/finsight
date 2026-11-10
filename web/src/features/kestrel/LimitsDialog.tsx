import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useStore } from 'zustand';
import { useModalFocus } from '../../ui/modalFocus.ts';
import { showToast } from '../../ui/toast.tsx';
import { agentApi } from './api.ts';
import { chat } from './chat.ts';
import { defaultText, LIMIT_FIELDS, limitsDialog, limitsForm, limitsPatch, type LimitsResponse, type SettingsTab } from './limits.ts';
import { UsagePanel } from './UsagePanel.tsx';

// Kestrel limits: the user's own spending and tool ceilings, saved to the
// agent's config.json and applied from the next reply, beside the usage
// dashboard. Opened from the "Today" spend in the chat list or /limits.
// Kestrel cannot reach this route.
const usd2 = (v: number | undefined) => (v == null ? '—' : `US$${v.toFixed(2)}`);
export function LimitsDialog() {
  const open = useStore(limitsDialog, (s) => s.open), tab = useStore(limitsDialog, (s) => s.tab);
  const setTab = (next: SettingsTab) => limitsDialog.setState({ tab: next });
  const boxRef = useRef<HTMLFormElement>(null);
  const [data, setData] = useState<LimitsResponse | null>(null), [form, setForm] = useState<Record<string, string>>({});
  const [err, setErr] = useState(''), [busy, setBusy] = useState(false);
  const close = () => limitsDialog.setState({ open: false });
  useModalFocus(open, close, boxRef);
  useEffect(() => {
    if (!open) return;
    setErr(''); setData(null);
    agentApi<LimitsResponse>('/limits').then((d) => { setData(d); setForm(limitsForm(d.set)); }, (e: Error) => setErr(e.message));
  }, [open]);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!data) return;
    const r = limitsPatch(form, data.set);
    if ('error' in r) return setErr(r.error);
    if (!Object.keys(r.body).length) return close();
    setBusy(true); setErr('');
    try {
      await agentApi<LimitsResponse>('/limits', { method: 'PATCH', body: r.body });
      showToast(`${chat.getState().name} limits saved; they apply from the next reply`);
      close();
    } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  };
  const name = useStore(chat, (s) => s.name);
  return (
    <div id="limits-modal" className={open ? 'modal' : 'modal hidden'} onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <form className="modal-box" ref={boxRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={`${name} settings`} onSubmit={(e) => void save(e)}>
        <div className="modal-head">
          <span className="panel-title">{name.toUpperCase()} SETTINGS</span>
          <button type="button" aria-label="Close dialog" className="x-btn" onClick={close}>✕</button>
        </div>
        <div className="kx-settings-tabs" role="tablist" aria-label="Settings sections">
          {(['usage', 'limits'] as const).map((t) => <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t === 'usage' ? 'Usage' : 'Limits'}</button>)}
        </div>
        {tab === 'usage' && open && <div className="modal-body"><UsagePanel /></div>}
        {tab === 'limits' && <div className="modal-body kx-limits">
          <p className="muted small">Ceilings on what {name} may spend and do. Leave a field empty to use the default. Changes apply from the next reply; your other settings are untouched.</p>
          {data && <p className="small">Spent today: <b>{usd2(data.todayUsd)}</b> of {usd2(data.limits.dayUsd)}</p>}
          {!data && !err && <p className="muted small">Loading…</p>}
          {data && LIMIT_FIELDS.map((f) => (
            <label key={f.key} className="kx-limit">
              <span className="kx-limit-k">{f.label}{f.key in data.set && <span className="kx-limit-set">set</span>}</span>
              <input id={`limit-${f.key}`} className="kx-limit-in" inputMode="decimal" value={form[f.key] ?? ''} placeholder={defaultText(f, data.defaults)}
                onChange={(e) => setForm((x) => ({ ...x, [f.key]: e.target.value }))} aria-describedby={`limit-${f.key}-help`} />
              <span id={`limit-${f.key}-help`} className="kx-limit-help">{f.help} Default: {defaultText(f, data.defaults)}.</span>
            </label>
          ))}
          {err && <div role="alert" className="down small">{err}</div>}
        </div>}
        {tab === 'limits' && <div className="modal-foot">
          <button type="button" className="mini-btn" disabled={!data} onClick={() => setForm(limitsForm({}))}>ALL DEFAULTS</button>
          <button id="limits-save" className="mini-btn solid" disabled={!data || busy}>{busy ? 'SAVING…' : 'SAVE'}</button>
        </div>}
      </form>
    </div>
  );
}
