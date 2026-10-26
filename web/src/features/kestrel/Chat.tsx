import { lazy, Suspense, memo, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useStore } from 'zustand';
import { IslandBoundary } from '../../ui/IslandBoundary.tsx';
import { agentApi } from './api.ts';
import { addFiles, chat, chooseBrain, chooseEffort, chooseSearch, closeOverlay, deleteThread, menuItems, newChat, openThread, pageContext, railShown, removeFile, setDraft, setNarrow, stop, submit, toggleThreads, type FileChip, type Item } from './chat.ts';
import type { Thread } from './api.ts';
import { Icon } from './icons.tsx';
import { costLabel, ctxButton, LS, ls, prettyArgs } from './labels.ts';
import { md } from './md.ts';
import { citeHost, type Turn } from './turns.ts';

const UiView = lazy(() => import('./ui/UiView.tsx'));

// The Kestrel conversation (G1: log, turns, tool rows, status, markdown;
// G2: composer, slash menu, attachments, model picker, page context).
// Rendered into the side drawer or the dock by KestrelIsland (G3).
// KESTRELUI-001 layout: the chat list as a rail beside the conversation (an
// overlay when the panel is narrow), a start screen for new chats, and a
// composer with context, search-provider and model pickers.
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

// Markdown is parsed again only when its segment's text changes (each streamed delta).
const TextPart = memo(function TextPart({ text }: { text: string }) {
  return <div className="agent-text" dangerouslySetInnerHTML={{ __html: md(text) }} />;
});

type ToolPart = Extract<Turn['parts'][number], { kind: 'tool' }>;
function ToolRow({ p }: { p: ToolPart }) {
  return (
    <details className={'agent-tool ' + p.state}>
      <summary><span className="st" aria-hidden="true">{p.state === 'running' ? <i className="kx-spin" /> : <Icon name={p.state === 'ok' ? 'check' : 'x'} size={13} />}</span>
        <span className="nm">{p.name}</span><span className="args">{prettyArgs(p.args)}</span></summary>
      <div className="res">{p.res}</div><div className="detail">{p.detail}</div>
    </details>
  );
}
// Consecutive tool calls fold into one "Used 3 tools" step list; it stays open while a tool runs.
function ToolGroup({ tools }: { tools: ToolPart[] }) {
  const running = tools.some((p) => p.state === 'running'), failed = tools.filter((p) => p.state === 'err').length;
  const [open, setOpen] = useState<boolean | null>(null);
  const label = running ? `Working · ${tools.length} step${tools.length === 1 ? '' : 's'}` : `Used ${tools.length} tool${tools.length === 1 ? '' : 's'}${failed ? ` · ${failed} failed` : ''}`;
  return (
    <details className={'agent-steps' + (running ? ' running' : '') + (failed ? ' err' : '')} open={open ?? running}
      onToggle={(e) => { const v = (e.currentTarget as HTMLDetailsElement).open; if (v !== running || open !== null) setOpen(v); }}>
      <summary><span className="lbl">{label}</span><Icon name="chevron" size={14} /></summary>
      <div className="agent-steps-list">{tools.map((p) => <ToolRow key={p.key} p={p} />)}</div>
    </details>
  );
}

async function copyAnswer(t: Turn): Promise<boolean> {
  // Ordinary answers keep their existing cheap path, even with the feature off.
  let text = t.allText;
  if (t.parts.some((p) => p.kind === 'ui')) {
    const { answerText } = await import('./ui/UiView.tsx');
    text = answerText(t, window.FinSight.store.getState().peek);
  }
  if (window.FinSight.auth.unlocked === false || !navigator.clipboard) return false;
  await navigator.clipboard.writeText(text);
  return true;
}

function TurnView({ t }: { t: Turn }) {
  const [copied, setCopied] = useState(false), [trace, setTrace] = useState(false);
  const blocks: ReactNode[] = [];
  for (let i = 0; i < t.parts.length; i++) {
    const p = t.parts[i]!;
    if (p.kind === 'tool') {
      const tools: ToolPart[] = [];
      while (i < t.parts.length && t.parts[i]!.kind === 'tool') tools.push(t.parts[i++] as ToolPart);
      i--; blocks.push(<ToolGroup key={'g' + tools[0]!.key} tools={tools} />);
    } else if (p.kind === 'text') blocks.push(<TextPart key={i} text={p.text} />);
    else if (p.kind === 'ui') blocks.push(<Suspense key={p.key} fallback={<div className="agent-notice">Loading snapshot…</div>}><IslandBoundary><UiView view={p.view} /></IslandBoundary></Suspense>);
    else blocks.push(<div key={i} className={'agent-notice ' + p.cls}>{p.text}</div>);
  }
  const search = t.search ? chat.getState().searchProviders.find((x) => x.id === t.search)?.label || t.search : '';
  return (
    <div className="agent-turn">
      {blocks}
      <div className="agent-cites">
        {t.cites.map((c) => (
          <a key={c.url} className={`agent-cite ${c.class || 'unverified'}`} href={c.url} target="_blank" rel="noopener noreferrer"
            title={`${c.title || c.url}\nretrieved ${String(c.retrievedAt || '').slice(0, 10)} · ${c.class || 'unverified'}`}>
            {citeHost(c.url)}
          </a>
        ))}
      </div>
      <div className="agent-meta">
        {t.meta && <>
          {t.meta.label && <span>{t.meta.label}</span>}
          {search && <span title="Web search provider for this answer">{`${search} search`}</span>}
          {t.meta.costUsd != null && <span title="API cost of this answer">{costLabel(t.meta.costUsd)}</span>}
          {!!t.meta.ms && <span>{(t.meta.ms / 1000).toFixed(1)}s</span>}
          {(t.allText || t.parts.some((p) => p.kind === 'ui')) && <button title="Copy answer" onClick={() => { void copyAnswer(t).then((ok) => { if (ok) { setCopied(true); setTimeout(() => setCopied(false), 1200); } }).catch(() => setCopied(false)); }}>{copied ? 'copied' : 'copy'}</button>}
          {/^turn_/.test(t.id) && <button title="Show every model, tool and data call for this answer" onClick={() => setTrace((v) => !v)}>trace</button>}
        </>}
      </div>
      {trace && <Trace turnId={t.id} />}
    </div>
  );
}

// Memoised: the chat re-renders on every stream delta, but an item only re-renders
// when its own turn changes in the store (finished turns are left alone).
const ItemView = memo(function ItemView({ item }: { item: Item }) {
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
});

// ---- chat list ----
const DAY = 864e5;
function dayGroup(ts: number, now = Date.now()): string {
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  const d = start.getTime() - ts;
  return d <= 0 ? 'Today' : d <= DAY ? 'Yesterday' : d <= 7 * DAY ? 'Previous 7 days' : d <= 30 * DAY ? 'Previous 30 days' : 'Older';
}
const when = (ts: number) => (dayGroup(ts) === 'Today' ? new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
function ThreadRow({ t, active }: { t: Thread; active: boolean }) {
  const open = () => { void openThread(t.id); closeOverlay(); };
  return (
    <div className={'agent-thread-row' + (active ? ' active' : '')} role="listitem" onClick={open}>
      <button className="agent-thread-open" aria-current={active ? 'page' : undefined} onClick={(e) => { e.stopPropagation(); open(); }}>
        <span className="t">{t.title}</span>
        {t.preview && <span className="p">{t.preview}</span>}
      </button>
      <span className="d">{when(t.updatedAt)}</span>
      <button className="agent-icon-btn x" title="Delete chat" aria-label={`Delete ${t.title}`} onClick={(e) => { e.stopPropagation(); void deleteThread(t); }}><Icon name="trash" size={14} /></button>
    </div>
  );
}
function Rail({ onNew }: { onNew: () => void }) {
  const s = useStore(chat);
  const [q, setQ] = useState('');
  const list = (s.threads || []).filter((t) => !q || `${t.title} ${t.preview || ''}`.toLowerCase().includes(q.toLowerCase()));
  const groups: [string, Thread[]][] = [];
  for (const t of list) { const g = dayGroup(t.updatedAt); const last = groups[groups.length - 1]; if (last?.[0] === g) last[1].push(t); else groups.push([g, [t]]); }
  return (
    <nav className="kx-rail" aria-label="Chats">
      <button className="kx-new" onClick={onNew}><Icon name="plus" size={15} />New chat</button>
      <label className="kx-find"><Icon name="search" size={14} /><input type="search" placeholder="Search chats" aria-label="Search chats" value={q} onChange={(e) => setQ(e.target.value)} /></label>
      <div className="agent-threads" id="agent-threads" role="list" aria-label="Chats">
        {s.threads?.length === 0 && <div className="kx-empty" role="listitem">Your chats show up here.</div>}
        {s.threads && s.threads.length > 0 && !list.length && <div className="kx-empty" role="listitem">No chats match.</div>}
        {groups.map(([g, ts]) => (
          <div key={g} role="presentation">
            <div className="kx-group" role="presentation">{g}</div>
            {ts.map((t) => <ThreadRow key={t.id} t={t} active={s.thread?.id === t.id} />)}
          </div>
        ))}
      </div>
      {s.todayUsd != null && <div className="kx-spend" title="API spend today (models and paid search)"><span>Today</span><span>{costLabel(s.todayUsd)}</span></div>}
    </nav>
  );
}

// ---- start screen ----
function Welcome({ list, onTry }: { list: string[]; onTry: (s: string) => void }) {
  const s = useStore(chat);
  const recent = s.narrow ? (s.threads || []).slice(0, 4) : [];
  return (
    <>
      <div className="agent-welcome">
        <div className="hi">What are we looking at today?</div>
        <div className="sub">Answers use your FinSight data, strategy library, records and the web, with sources and data times. {s.name} never trades.</div>
      </div>
      <div className="agent-try" aria-label="Suggestions">{list.map((x) => <button key={x} className="agent-chip" onClick={() => onTry(x)}>{x}</button>)}</div>
      {recent.length > 0 && (
        <div className="kx-recent">
          <div className="kx-group">Recent chats</div>
          {recent.map((t) => (
            <button key={t.id} className="kx-recent-row" onClick={() => void openThread(t.id)}>
              <span className="t">{t.title}</span>{t.preview && <span className="p">{t.preview}</span>}
            </button>
          ))}
          <button className="kx-all" onClick={() => toggleThreads(true)}>All chats</button>
        </div>
      )}
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

// The rail sits beside the chat from this panel width; below it the list is an overlay.
const RAIL_MIN = 680;

export function Chat({ inputRef, onRetry }: { inputRef: RefObject<HTMLTextAreaElement | null>; onRetry: () => void }) {
  const s = useStore(chat);
  const rootRef = useRef<HTMLDivElement>(null), logRef = useRef<HTMLDivElement>(null), fileRef = useRef<HTMLInputElement>(null);
  const [stick, setStick] = useState(true), [menuSel, setMenuSel] = useState(0), [menuOpen, setMenuOpen] = useState(true), [drag, setDrag] = useState(false);
  const [ctxOn, setCtxOn] = useState(() => ls.get(LS.ctx, '1') === '1');
  const [, tick] = useState(0);
  // The context label follows the selection; the chart strategy is polled like legacy (2 s).
  useEffect(() => { const t = setInterval(() => { if (!document.hidden) tick((n) => n + 1); }, 2000); return () => clearInterval(t); }, []);
  useEffect(() => window.FinSight.store.subscribe(() => tick((n) => n + 1)), []);
  useLayoutEffect(() => {
    const el = rootRef.current; if (!el) return;
    const measure = () => { if (el.clientWidth) setNarrow(el.clientWidth < RAIL_MIN); };
    measure();
    const ro = new ResizeObserver(measure); ro.observe(el);
    return () => ro.disconnect();
  }, []);
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
  const onNew = () => { newChat(); closeOverlay(); inputRef.current?.focus(); };
  const pc = pageContext();
  const rail = railShown(s);
  const searchDefault = s.searchProviders.find((p) => p.id === s.searchDefault)?.label || s.searchDefault;

  let body: ReactNode;
  const items = s.items.map((item) => <ItemView key={item.key} item={item} />);
  if (s.view === 'offline' && s.offline) body = <Offline name={s.name} why={s.offline.why} onRetry={onRetry} />;
  // Notices on a fresh chat (a rejected file, "wait for uploads") show under the welcome, like legacy.
  else if (s.view === 'welcome') body = <><Welcome list={s.welcome} onTry={send} />{items}</>;
  else body = items;

  return (
    <div ref={rootRef} className={'agent-chat' + (s.narrow ? ' narrow' : '') + (rail ? ' rail-on' : '') + (s.view === 'welcome' ? ' fresh' : '')}>
      {rail && <Rail onNew={onNew} />}
      {rail && s.narrow && <div className="kx-scrim" onClick={() => toggleThreads(false)} aria-hidden="true" />}
      <section className="kx-main">
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
          <div id="agent-command-menu" className="agent-menu" hidden={!menu} role="listbox" aria-label="Commands and skills">
            {menu && <>
              {menu.skills.length > 0 && <div className="grp">SKILLS</div>}
              {menu.skills.map((it, i) => <MenuRow key={it.k} id={`agent-option-${i}`} k={it.k} v={it.v} on={i === sel} onPick={() => pick(i)} />)}
              {menu.cmds.length > 0 && <div className="grp">COMMANDS</div>}
              {menu.cmds.map((it, i) => <MenuRow key={it.k} id={`agent-option-${i + menu.skills.length}`} k={it.k} v={it.v} on={i + menu.skills.length === sel} onPick={() => pick(i + menu.skills.length)} />)}
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
            <textarea ref={inputRef} className="agent-input" rows={1} maxLength={12000} aria-label="Message" aria-autocomplete="list" aria-controls={menu ? 'agent-command-menu' : undefined} aria-activedescendant={menu && all.length ? `agent-option-${sel}` : undefined}
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
            {brain?.thinking && <div className="kx-thinking">
              <label htmlFor="kestrel-effort">Thinking <strong>{s.effort === 'none' ? 'Off' : s.effort === 'xhigh' ? 'Extra high' : s.effort.charAt(0).toUpperCase() + s.effort.slice(1)}</strong></label>
              <input id="kestrel-effort" type="range" aria-label="Thinking effort" min="0" max={brain.thinking.levels.length - 1} step="1"
                value={Math.max(0, brain.thinking.levels.indexOf(s.effort))} disabled={!!s.running || s.sending}
                aria-valuetext={s.effort === 'none' ? 'Off' : s.effort === 'xhigh' ? 'Extra high' : s.effort}
                onChange={(e) => chooseEffort(brain.thinking!.levels[Number(e.target.value)]!)} />
              <div className="kx-thinking-ticks" aria-hidden="true">{brain.thinking.levels.map((level) => <span key={level}>{level === 'none' ? 'Off' : level === 'xhigh' ? 'XHigh' : level.charAt(0).toUpperCase() + level.slice(1)}</span>)}</div>
              <small>Higher effort can take longer and cost more.</small>
            </div>}
            <div className="agent-tools-row">
              <button className="agent-icon-btn" title="Attach images or documents (or paste / drop)" aria-label="Attach files" onClick={() => fileRef.current?.click()}><Icon name="clip" /></button>
              <button className={'agent-ctx kx-pill' + (ctxOn ? ' on' : '')} title="Send what you are looking at (symbol, timeframe, strategy) with your message"
                onClick={() => { const v = !ctxOn; setCtxOn(v); ls.set(LS.ctx, v ? '1' : '0'); }}>{ctxButton(ctxOn, pc)}</button>
              {s.searchProviders.length > 0 && (
                <label className="kx-pill kx-select" title="Web search provider, independent of the model">
                  <Icon name="globe" size={13} />
                  <select className="agent-search" aria-label="Web search" value={s.search} onChange={(e) => chooseSearch(e.target.value)}>
                    <option value="auto">{`Auto${searchDefault ? ` (${searchDefault})` : ''}`}</option>
                    {s.searchProviders.map((p) => <option key={p.id} value={p.id} disabled={!p.available} title={p.reason}>{`${p.label}${p.available ? '' : ' · no key'}`}</option>)}
                  </select>
                </label>
              )}
              <label className="kx-pill kx-select" title="Model for this chat">
                <Icon name="spark" size={13} />
                <select className="agent-model" aria-label="Model" disabled={!!s.running || s.sending} value={s.brain} onChange={(e) => chooseBrain(e.target.value)}>
                  {s.brains.map((b) => <option key={b.id} value={b.id} disabled={!b.available} title={b.available ? b.label : b.reason}>{`${b.label} ${b.costTier}${b.available ? '' : ' · n/a'}`}</option>)}
                </select>
              </label>
              <button className={'agent-send' + (s.running ? ' stop' : '')} title={s.running ? 'Stop (Esc)' : 'Send (Enter)'} aria-label={s.running ? 'Stop' : 'Send'}
                disabled={!s.running && (s.sending || s.view === 'offline' || !brain)} onClick={() => (s.running ? void stop() : send(s.draft))}><Icon name={s.running ? 'stop' : 'up'} /></button>
            </div>
          </div>
          <input ref={fileRef} type="file" multiple hidden accept="image/png,image/jpeg,image/gif,image/webp,application/pdf,.docx,.txt,.md,.csv,.json"
            onChange={(e) => { if (e.target.files) void addFiles(e.target.files); e.target.value = ''; }} />
          {s.brains.length > 0 && !brain && <div className="agent-hints">No model available: add an API key (see agent README).</div>}
        </div>
      </section>
    </div>
  );
}
function MenuRow({ id, k, v, on, onPick }: { id: string; k: string; v: string; on: boolean; onPick: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (on) ref.current?.scrollIntoView({ block: 'nearest' }); }, [on]);
  return <div id={id} ref={ref} className={'it' + (on ? ' sel' : '')} role="option" aria-selected={on} onMouseDown={(e) => { e.preventDefault(); onPick(); }}><span className="k">{k}</span><span className="v">{v}</span></div>;
}
export { newChat, toggleThreads };
