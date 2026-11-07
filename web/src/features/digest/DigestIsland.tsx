// FEAT-015 §5 Weekly digest: generated only when you press GENERATE. FinSight
// does not schedule, email or send it; SAVE writes a private copy to your data folder.
import { useEffect, useState } from 'react';
import { api } from '../../api/client.ts';
import { PanelHeadSlot } from '../../ui/PanelHeadSlot.tsx';

interface Digest { date: string; markdown: string; sections: string[]; savedAs: string | null }

export default function DigestIsland() {
  useEffect(() => { const el = document.getElementById('digest'); if (el) { el.tabIndex = 0; el.setAttribute('aria-label', 'Weekly digest'); } }, []);
  const [d, setD] = useState<Digest | null>(null), [busy, setBusy] = useState(''), [err, setErr] = useState(''), [msg, setMsg] = useState('');
  const run = async (save: boolean) => {
    setBusy(save ? 'save' : 'gen'); setErr(''); setMsg('');
    const base = window.FinSight?.store.getState().base ?? 'SGD';
    try {
      const r = await api<Digest>(`/api/digest${save ? '/save' : ''}?base=${encodeURIComponent(base)}`, save ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' } : {});
      setD(r);
      if (r.savedAs) setMsg(`Saved as digests/${r.savedAs} in your FinSight data folder.`);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(''); }
  };
  const copy = async () => { try { await navigator.clipboard.writeText(d!.markdown); setMsg('Copied.'); } catch { setErr('Copy failed'); } };
  return <>
    <PanelHeadSlot island="digest">{d && <span>{d.date}</span>}</PanelHeadSlot>
    <div className="gr-actions">
      <button className="mini-btn" disabled={!!busy} onClick={() => run(false)}>{busy === 'gen' ? 'GENERATING…' : d ? 'REGENERATE' : 'GENERATE'}</button>
      {d && <button className="mini-btn" disabled={!!busy} onClick={() => run(true)}>{busy === 'save' ? 'SAVING…' : 'SAVE'}</button>}
      {d && <button className="mini-btn" disabled={!!busy} onClick={copy}>COPY</button>}
      <span className="grow" />
      {msg && <span className="up small" role="status">{msg}</span>}
      {err && <span className="down small" role="alert">{err}</span>}
    </div>
    {d ? <pre className="dc-body dg-body">{d.markdown}</pre>
      : <div className="muted">A one-page summary of the week: performance, guardrails, theses due, the next 14 days' events, the decision log and flagged costs. Built only when you ask; nothing is scheduled or sent.</div>}
  </>;
}
