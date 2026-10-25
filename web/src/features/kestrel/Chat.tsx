import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useStore } from 'zustand';
import { agentApi } from './api.ts';
import { addFiles, chat, chooseBrain, deleteThread, menuItems, newChat, openThread, removeFile, setDraft, stop, submit, toggleThreads, type FileChip, type Item } from './chat.ts';
import { costLabel, ctxButton, LS, ls, prettyArgs, suggestions, type PageContext } from './labels.ts';
import { md } from './md.ts';
import { citeHost, type Turn } from './turns.ts';

// The Kestrel conversation (G1: log, turns, tool rows, status, markdown;
// G2: composer, slash menu, attachments, model picker, page context).
// Rendered into the side drawer or the dock by KestrelIsland (G3).
export function pageContext(): PageContext {
  const c: PageContext = { view: 'terminal' };
  try {
    const s = window.FinSight.store.getState();
    if (s.selected) c.symbol = String(s.selected).slice(0, 24);
    if (s.account) c.account = String(s.account).slice(0, 64);
    if (s.base) c.base = String(s.base).slice(0, 3);
    if (s.detailRange?.interval) c.timeframe = String(s.detailRange.interval).slice(0, 10);
    const strategy = (window.detailChart as unknown as { cfg?: { strategy?: string } } | null | undefined)?.cfg?.strategy;
    if (strategy) c.strategy = String(strategy).slice(0, 40);
  } catch { /* app not ready */ }
  return c;
}

export function Candles() {
  return (
    <span className="candles" aria-hidden="true">
      {([[6, ''], [5, 'dn'], [10, ''], [14, ''], [18, '']] as const).map(([px, cls], i) =>
        <i key={i} className={cls || undefined} style={{ height: px + 'px', animationDelay: `${i * 0.15}s` }} />)}
      <b className="money">$</b>
    </span>
  );
}
const fileChip = (f: { name: string; kind?: string; thumb?: string | null }, extra?: ReactNode) => (
  <span className="agent-file" title={f.name}>{f.thumb ? <img src={f.thumb} alt="" /> : (f.kind === 'image' ? '🖼' : '📄')} {f.name}{extra}</span>
);

function Status() {
  const status = useStore(chat, (s) => s.status);
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 120); return () => clearInterval(t); }, []);
  const secs = Math.floor((Date.now() - status.start) / 1000);
  return (
    <div className="agent-status" aria-live="off">
      <Candles /><span className="verb">{status.verb}…</span>
      <span className="sub">{`(${secs}s${status.chars ? ` · ↓ ~${Math.round(status.chars / 4)} tokens` : ''} · esc to interrupt)`}</span>
    </div>
  );
}

function Trace({ turnId }: { turnId: string }) {
  const [lines, setLines] = useState<Record<string, unknown>[] | string | null>(null);
  useEffect(() => {
    agentApi<{ lines: Record<string, unknown>[] }>(`/logs?turnId=${encodeURIComponent(turnId)}&limit=500`).then((r) => setLines(r.lines), (e: Error) => setLines(e.message));
  }, [turnId]);
  if (lines == null) return <div className="agent-trace"><div>loading…</div></div>;
  if (typeof lines === 'string') return <div className="agent-trace"><div className="bad">{lines}</div></div>;
  return (
    <div className="agent-trace">
      <div><b>{turnId}</b> · {lines.length} events · full detail: agent logs {turnId}</div>
      {lines.map((l, i) => {
        const bad = l.ok === false || /error|failed/.test(String(l.kind)) || l.status === 'failed';
        const usage = l.usage as { inputTokens: number; outputTokens: number } | undefined;
        const extra = [l.ms != null ? `${l.ms}ms` : '', l.stopReason || '', usage ? `in ${usage.inputTokens} / out ${usage.outputTokens}` : '', l.code || '', l.error ? String(l.error).slice(0, 80) : ''].filter(Boolean).join(' · ');
        return <div key={i} className={bad ? 'bad' : ''}>{`${String(l.ts).slice(11, 19)} `}<b>{String(l.kind)}</b>{` ${String(l.tool || l.path || l.brain || '')} ${extra}`}</div>;
      })}
    </div>
  );
}

function TurnView({ t }: { t: Turn }) {
  const [copied, setCopied] = useState(false), [trace, setTrace] = useState(false);
  return (
    <div className="agent-turn">
      {t.parts.map((p, i) => p.kind === 'text' ? <div key={i} className="agent-text" dangerouslySetInnerHTML={{ __html: md(p.text) }} />
        : p.kind === 'notice' ? <div key={i} className={'agent-notice ' + p.cls}>{p.text}</div>
        : <details key={i} className={'agent-tool ' + p.state}>
            <summary><span className="nm">{p.name}</span><span className="args">{prettyArgs(p.args)}</span></summary>
            <div className="res">{p.res}</div><div className="detail">{p.detail}</div>
          </details>)}
      <div className="agent-cites">
        {t.cites.map((c) => (
          <a key={c.url} className={`agent-cite ${c.class || 'unverified'}`} href={c.url} target="_blank" rel="noopener noreferrer"
            title={`${c.title || c.url}\nretrieved ${String(c.retrievedAt || '').slice(0, 10)} · ${c.class || 'unverified'}`}>
            <b>{(c.class || 'web')[0]!.toUpperCase()}</b> {citeHost(c.url)}
          </a>
        ))}
      </div>
      <div className="agent-meta">
        {t.meta && <>
          {t.meta.label && <span>{t.meta.label}</span>}
          {t.meta.costUsd != null && <span title="API cost of this answer">{costLabel(t.meta.costUsd)}</span>}
          {!!t.meta.ms && <span>{(t.meta.ms / 1000).toFixed(1)}s</span>}
          {t.allText && <button title="Copy answer" onClick={() => { void navigator.clipboard?.writeText(t.allText); setCopied(true); setTimeout(() => setCopied(false), 1200); }}>{copied ? 'copied' : 'copy'}</button>}
          {/^turn_/.test(t.id) && <button title="Show every model, tool and data call for this answer" onClick={() => setTrace((v) => !v)}>trace</button>}
        </>}
      </div>
      {trace && <Trace turnId={t.id} />}
    </div>
  );
}

function ItemView({ item }: { item: Item }) {
  const turn = useStore(chat, (s) => (item.kind === 'turn' ? s.turns[item.id] : undefined));
  if (item.kind === 'notice') return <div className={'agent-notice ' + item.cls}>{item.text}</div>;
  if (item.kind === 'turn') return turn ? <TurnView t={turn} /> : null;
  return (
    <div className="agent-user">
      <span className="q">{item.text}</span>
      {item.files.length > 0 && <div className="agent-files">{item.files.map((f, i) => <span key={i}>{fileChip(f)}</span>)}</div>}
      {item.ctx && <span className="meta">{item.ctx}</span>}
    </div>
  );
}

function Welcome({ name, onTry }: { name: string; onTry: (s: string) => void }) {
  return (
    <>
      <div className="agent-welcome">
        <div className="hi"><span className="star">↗ </span>{`Welcome to ${name}`}</div>
        <div>Your research agent inside FinSight. Answers use your live data, strategy library, records and the web, with sources and data times. It never trades.</div>
        <ul>
          <li><code>/</code> shows skills and commands (<code>/pre-trade-check</code>, <code>/earnings-review</code> …)</li>
          <li>paste or drop images, PDFs, DOCX or CSV to analyse them</li>
          <li>switch model at the bottom right; <code>esc</code> stops a reply</li>
        </ul>
      </div>
      <div className="agent-try"><div className="lbl">Try</div>{suggestions(pageContext()).map((s) => <button key={s} className="agent-chip" onClick={() => onTry(s)}>{s}</button>)}</div>
    </>
  );
}

function Offline({ name, why, onRetry }: { name: string; why: [string, string]; onRetry: () => void }) {
  return (
    <div className="agent-offline">
      <div><strong>{`${name} offline. `}</strong>{why[0]}</div>
      {why[1] && <code>{why[1]}</code>}
      <div style={{ marginTop: 8 }}><button className="agent-chip" onClick={onRetry}>retry</button></div>
    </div>
  );
}

export function Chat({ inputRef, onRetry }: { inputRef: RefObject<HTMLTextAreaElement | null>; onRetry: () => void }) {
  const s = useStore(chat);
  const logRef = useRef<HTMLDivElement>(null), fileRef = useRef<HTMLInputElement>(null);
  const [stick, setStick] = useState(true), [menuSel, setMenuSel] = useState(0), [menuOpen, setMenuOpen] = useState(true), [drag, setDrag] = useState(false);
  const [ctxOn, setCtxOn] = useState(() => ls.get(LS.ctx, '1') === '1');
  const [, tick] = useState(0);
  // The context label follows the selection; the chart strategy is polled like legacy (2 s).
  useEffect(() => { const t = setInterval(() => { if (!document.hidden) tick((n) => n + 1); }, 2000); return () => clearInterval(t); }, []);
  useEffect(() => window.FinSight.store.subscribe(() => tick((n) => n + 1)), []);
  const lastTop = useRef(0);
  const scrollBottom = (force = false) => { const el = logRef.current; if (el && (force || stick)) { el.scrollTop = el.scrollHeight; setStick(true); } };
  useLayoutEffect(() => { scrollBottom(); }, [s.stick, s.items.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => { scrollBottom(true); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const autosize = () => { const el = inputRef.current; if (el) { el.style.height = 'auto'; el.style.height = Math.min(200, el.scrollHeight) + 'px'; } };
  useLayoutEffect(autosize, [s.draft]); // eslint-disable-line react-hooks/exhaustive-deps

  const brain = s.brains.find((b) => b.id === s.brain && b.available);
  const menu = menuOpen ? menuItems(s.draft) : null;
  const all = menu ? [...menu.skills, ...menu.cmds] : [];
  const sel = Math.min(menuSel, Math.max(0, all.length - 1));
  const send = (text: string) => void submit(text.trim(), ctxOn ? pageContext() : undefined, (t) => setDraft(t));
  const pick = (i: number) => { const it = all[i]; if (!it) return; setDraft(it.k + ' '); setMenuSel(0); setMenuOpen(false); inputRef.current?.focus(); };
  const pc = pageContext();

  let body: ReactNode;
  if (s.view === 'offline' && s.offline) body = <Offline name={s.name} why={s.offline.why} onRetry={onRetry} />;
  else if (s.view === 'welcome') body = <Welcome name={s.name} onTry={send} />;
  else body = s.items.map((item) => <ItemView key={item.key} item={item} />);

  return (
    <div className="agent-chat">
      <div className="agent-threads" id="agent-threads" hidden={!s.threadsOpen} role="listbox" aria-label="Chats">
        {s.threads?.length === 0 && <div className="agent-thread-row"><span className="t">No chats yet</span></div>}
        {s.threads?.map((t) => {
          const active = s.thread?.id === t.id;
          const open = () => { void openThread(t.id); toggleThreads(false); };
          return (
            <div key={t.id} className={'agent-thread-row' + (active ? ' active' : '')} role="option" tabIndex={0} aria-selected={active}
              onClick={open} onKeyDown={(e) => { if (e.key === 'Enter') open(); }}>
              <span className="t">{t.title}</span><span className="d">{new Date(t.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
              <button className="agent-icon-btn x" title="Delete chat" aria-label={`Delete ${t.title}`} onClick={(e) => { e.stopPropagation(); void deleteThread(t); }}>✕</button>
            </div>
          );
        })}
      </div>
      <div className="agent-log" role="log" aria-live="polite" aria-relevant="additions" ref={logRef} onScroll={() => {
        const el = logRef.current!; const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        if (atBottom) setStick(true); else if (el.scrollTop < lastTop.current - 2) setStick(false);
        lastTop.current = el.scrollTop;
      }}>
        {body}
        {s.running && <Status />}
        {!stick && <button className="agent-jump" onClick={() => scrollBottom(true)}>↓ latest</button>}
      </div>
      <div className="agent-compose">
        <div className="agent-menu" hidden={!menu} role="listbox" aria-label="Commands and skills">
          {menu && <>
            {menu.skills.length > 0 && <div className="grp">SKILLS</div>}
            {menu.skills.map((it, i) => <MenuRow key={it.k} k={it.k} v={it.v} on={i === sel} onPick={() => pick(i)} />)}
            {menu.cmds.length > 0 && <div className="grp">COMMANDS</div>}
            {menu.cmds.map((it, i) => <MenuRow key={it.k} k={it.k} v={it.v} on={i + menu.skills.length === sel} onPick={() => pick(i + menu.skills.length)} />)}
          </>}
        </div>
        <div className={'agent-box' + (drag ? ' drag' : '')} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); if (e.dataTransfer?.files.length) void addFiles(e.dataTransfer.files); }}>
          <div className="agent-attach-row">
            {s.files.map((f: FileChip, i) => {
              const label = f.state === 'uploading' ? ' uploading…' : f.state === 'error' ? ` ✕ ${f.error}` : f.state === 'notext' ? ' (no text found)' : '';
              return <span key={i}>{fileChip({ ...f, name: f.name + label }, <button title="Remove" aria-label={`Remove ${f.name}`} onClick={() => removeFile(i)}>×</button>)}</span>;
            })}
          </div>
          <div className="agent-row">
            <span className="agent-prompt-glyph">&gt;</span>
            <textarea ref={inputRef} className="agent-input" rows={1} maxLength={12000} aria-label="Message"
              placeholder={s.named ? `Ask ${s.name} anything…  (/ for skills)` : 'Ask anything about your portfolio, a stock, a strategy…  (/ for skills)'}
              value={s.draft} onChange={(e) => { setDraft(e.target.value); setMenuOpen(true); }}
              onBlur={() => setTimeout(() => setMenuOpen(false), 120)} onFocus={() => setMenuOpen(true)}
              onPaste={(e) => { const files = [...(e.clipboardData?.files || [])]; if (files.length) { e.preventDefault(); void addFiles(files); } }}
              onKeyDown={(e) => {
                // Esc closes the menu first; the shell's Esc (stop / close) must not also run.
                if (e.key === 'Escape' && menu) { e.stopPropagation(); setMenuOpen(false); return; }
                if (menu && all.length) {
                  if (e.key === 'ArrowDown') { e.preventDefault(); setMenuSel((sel + 1) % all.length); return; }
                  if (e.key === 'ArrowUp') { e.preventDefault(); setMenuSel((sel - 1 + all.length) % all.length); return; }
                  if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) { e.preventDefault(); pick(sel); return; }
                }
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (!s.running) send(s.draft); }
              }} />
            <button className="agent-icon-btn" title="Attach images or documents (or paste / drop)" aria-label="Attach files" onClick={() => fileRef.current?.click()}>⊕</button>
            <button className={'agent-send' + (s.running ? ' stop' : '')} title={s.running ? 'Stop (Esc)' : 'Send (Enter)'} aria-label={s.running ? 'Stop' : 'Send'}
              disabled={!s.running && (s.sending || s.view === 'offline' || !brain)} onClick={() => (s.running ? void stop() : send(s.draft))}>{s.running ? '■' : '⏎'}</button>
          </div>
        </div>
        <input ref={fileRef} type="file" multiple hidden accept="image/png,image/jpeg,image/gif,image/webp,application/pdf,.docx,.txt,.md,.csv,.json"
          onChange={(e) => { if (e.target.files) void addFiles(e.target.files); e.target.value = ''; }} />
        <div className="agent-hints">
          <span>{s.brains.length && !brain ? 'No model available: add an API key (see agent README).' : '⏎ send · / skills · ⊕ files'}</span>
          <span className="r">
            <button className={'agent-ctx' + (ctxOn ? ' on' : '')} title="Send what you are looking at (symbol, timeframe, strategy) with your message"
              onClick={() => { const v = !ctxOn; setCtxOn(v); ls.set(LS.ctx, v ? '1' : '0'); }}>{ctxButton(ctxOn, pc)}</button>
            <span>·</span>
            <select className="agent-model" aria-label="Model" title="Model for this chat" value={s.brain} onChange={(e) => chooseBrain(e.target.value)}>
              {s.brains.map((b) => <option key={b.id} value={b.id} disabled={!b.available} title={b.available ? b.label : b.reason}>{`${b.label} ${b.costTier}${b.available ? '' : ' · n/a'}`}</option>)}
            </select>
          </span>
        </div>
      </div>
    </div>
  );
}
function MenuRow({ k, v, on, onPick }: { k: string; v: string; on: boolean; onPick: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (on) ref.current?.scrollIntoView({ block: 'nearest' }); }, [on]);
  return <div ref={ref} className={'it' + (on ? ' sel' : '')} role="option" aria-selected={on} onMouseDown={(e) => { e.preventDefault(); onPick(); }}><span className="k">{k}</span><span className="v">{v}</span></div>;
}
export { newChat, toggleThreads };
