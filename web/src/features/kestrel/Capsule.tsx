import { useEffect, useState } from 'react';
import { useStore } from 'zustand';
import { chat } from './chat.ts';
import { councilModel, type CouncilPart } from './council.ts';
import { Icon } from './icons.tsx';

// FEAT-009 §4: while Kestrel works with its panel closed, a small capsule keeps
// the run in view without covering the terminal. Status, time and council stage
// only: no finding text, so it is safe under UNPEEK too.
const elapsed = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`; };
export function Capsule({ onOpen, onFull }: { onOpen: () => void; onFull: () => void }) {
  const status = useStore(chat, (s) => s.status);
  const parts = useStore(chat, (s) => (s.running ? s.turns[s.running]?.parts : undefined));
  const runs = parts?.filter((p): p is CouncilPart => p.kind === 'council');
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const council = runs?.length ? councilModel(runs, false, false) : null;
  return (
    <div className="kx-capsule" role="status" aria-label="Kestrel is working" data-kx-capsule="">
      <span className="kx-capsule-pulse" aria-hidden="true" />
      <span className="kx-capsule-text">
        <b>{council ? council.activeLabel : (status.verb || 'Working') + '…'}</b>
        <span className="kx-capsule-time">{elapsed(now - status.start)}</span>
      </span>
      {council && (
        <span className="kx-capsule-roles" aria-label={`${council.done} of ${council.total} council steps done`}>
          {council.roles.map((r) => <i key={r.id} data-role={r.id} data-state={r.state} title={`${r.label}: ${r.phaseNote}`} />)}
          <i data-role="chair" data-state={council.chair.state} title={`Chair: ${council.chair.waiting}`} />
        </span>
      )}
      <button className="agent-icon-btn" title="Open Kestrel (⌘/)" aria-label="Open Kestrel" onClick={onOpen}><Icon name="popout" /></button>
      <button className="agent-icon-btn" title="Full page (⌘⇧/)" aria-label="Open Kestrel full page" onClick={onFull}><Icon name="maximize" /></button>
    </div>
  );
}
