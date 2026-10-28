import { LENSES } from '../../../../shared/council-lenses.ts';
import { CouncilActivity } from './CouncilActivity.tsx';
import { lazy, Suspense, memo, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { useStore } from 'zustand';
import { useCalendar, useEvents, useIntraday, usePortfolio } from '../../api/queries.ts';
import { Money } from '../../ui/Money.tsx';
import { IslandBoundary } from '../../ui/IslandBoundary.tsx';
import { agentApi } from './api.ts';
import { addFiles, chat, chooseLens, chooseBrain, chooseEffort, chooseSearch, clearAllChats, closeOverlay, deleteThread, menuItems, newChat, openThread, pageContext, railShown, removeFile, setDraft, setNarrow, stop, submit, toggleThreads, type FileChip, type Item } from './chat.ts';
import type { Thread } from './api.ts';
import { asks, brief, eventTime, greeting, pctText, portfolioLine, prevClose, symbolLine, usMarket, type Ask, type Brief, type Kind } from './briefing.ts';
import { Icon, type IconName } from './icons.tsx';
import { costLabel, ctxButton, LS, ls, prettyArgs, type PageContext } from './labels.ts';
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
    else if (p.kind === 'council') blocks.push(<CouncilActivity key={p.key} run={p} />);
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
      <button className="kx-all kx-clear-all" onClick={() => void clearAllChats()}>Clear all chats</button>
      {s.todayUsd != null && <div className="kx-spend" title="API spend today (models and paid search)"><span>Today</span><span>{costLabel(s.todayUsd)}</span></div>}
    </nav>
  );
}

// ---- start screen ----
const KIND_ICON: Record<Kind, IconName> = { portfolio: 'trend', event: 'calendar', macro: 'globe', table: 'table', strategy: 'target' };
// A small area chart of today's line, coloured by the day's direction, with a
// dashed baseline at the previous close.
function Spark({ values, base, dir }: { values: number[]; base: number | null; dir: string }) {
  const id = useId();
  if (values.length < 2) return <div className="kx-spark empty" aria-hidden="true" />;
  const lo = Math.min(...values, base ?? Infinity), hi = Math.max(...values, base ?? -Infinity), span = hi - lo || 1;
  const x = (i: number) => (i / (values.length - 1)) * 100, y = (v: number) => 4 + (1 - (v - lo) / span) * 28;
  const line = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(2)},${y(v).toFixed(2)}`).join('');
  return (
    <svg className={'kx-spark' + dir} viewBox="0 0 100 36" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="currentColor" stopOpacity="0.28" /><stop offset="1" stopColor="currentColor" stopOpacity="0" /></linearGradient></defs>
      {base != null && <line x1="0" x2="100" y1={y(base)} y2={y(base)} className="base" vectorEffect="non-scaling-stroke" />}
      <path d={`${line}L100,36L0,36Z`} fill={`url(#${id})`} />
      <path d={line} className="ln" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
// Thinking menu labels (the menu is headed Thinking; the pill shows the bulb).
const effortLabel = (e: string) => (e === 'none' ? 'Off' : e === 'xhigh' ? 'Extra high' : e.charAt(0).toUpperCase() + e.slice(1));
const WEEK = 7 * 864e5;
const until = (t: number, now: number) => { const m = Math.round((t - now) / 6e4); return m <= 0 ? 'now' : m < 60 ? `in ${m}m` : m < 1440 ? `in ${Math.round(m / 60)}h` : `in ${Math.round(m / 1440)}d`; };
function Briefing({ b, now, lines }: { b: Brief; now: number; lines: { portfolio: number[]; mover: number[]; moverBase: number | null } }) {
  const sign = (n: number | null) => (n == null ? '' : n > 0 ? ' up' : n < 0 ? ' down' : '');
  const pLast = lines.portfolio[lines.portfolio.length - 1];
  const pBase = pLast != null && b.dayPct != null ? pLast / (1 + b.dayPct / 100) : lines.portfolio[0] ?? null;
  return (
    <div className="kx-brief" aria-label="Briefing">
      <div className="kx-tile">
        <span className="lbl">Portfolio today</span>
        <span className={'big' + sign(b.dayPct)}>{b.dayPct == null ? '—' : pctText(b.dayPct)}</span>
        <span className="sm">{b.dayPnl == null ? (b.holdings ? 'no quotes yet' : 'no holdings') : <Money value={b.dayPnl} currency={b.base} signed decimals={0} />}</span>
        <Spark values={lines.portfolio} base={pBase} dir={sign(b.dayPct)} />
      </div>
      <div className="kx-tile">
        <span className="lbl">Top mover</span>
        <span className="big">{b.mover?.symbol || '—'}</span>
        <span className={'sm' + sign(b.mover?.pct ?? null)}>{b.mover ? pctText(b.mover.pct) : 'nothing moving'}</span>
        <Spark values={lines.mover} base={lines.moverBase} dir={sign(b.mover?.pct ?? null)} />
      </div>
      <div className="kx-tile ev">
        <span className="lbl">Next event{b.next && <span className="kx-when">{until(b.next.t, now)}</span>}</span>
        <span className="big ev">{b.next?.label || '—'}</span>
        <span className="sm">{b.next ? eventTime(b.next.t, now, b.next.timed) : 'none this week'}</span>
        {/* how close it is: the bar fills over the final week */}
        <div className="kx-count" aria-hidden="true"><i style={{ width: `${b.next ? Math.round(Math.max(4, Math.min(100, (1 - (b.next.t - now) / WEEK) * 100))) : 0}%` }} /></div>
      </div>
    </div>
  );
}
function Welcome({ onTry, onCommand }: { onTry: (s: string) => void; onCommand: () => void }) {
  const s = useStore(chat);
  const portfolio = usePortfolio(), events = useEvents(), calendar = useCalendar();
  const positions = portfolio.data?.positions || [];
  const bars = useIntraday(positions.map((p) => p.symbol)).data?.results;
  const now = Date.now();
  const b = brief(portfolio.data, events.data?.events, calendar.data, now);
  const lines = { portfolio: portfolioLine(positions, bars), mover: b.mover ? symbolLine(bars, b.mover.symbol) : [], moverBase: b.mover ? prevClose(bars, b.mover.symbol) : null };
  const market = usMarket(now);
  const views = !!s.brains.find((x) => x.id === s.brain)?.ui;
  // The questions are fixed when the start screen opens (like legacy), and once
  // more when the briefing data first arrives, so a button never changes under the pointer.
  const loaded = !portfolio.isPending && !events.isPending && !calendar.isPending;
  const frozen = useRef<{ ctx: PageContext; loaded: boolean; views: boolean; cards: Ask[] } | null>(null);
  const f = frozen.current;
  if (!f || f.ctx !== s.welcomeCtx || f.views !== views || (loaded && !f.loaded)) frozen.current = { ctx: s.welcomeCtx, loaded, views, cards: asks(b, s.welcomeCtx, views) };
  const cards = frozen.current!.cards;
  const recent = railShown(s) ? [] : (s.threads || []).slice(0, s.narrow ? 4 : 5);
  const listRef = useRef<HTMLDivElement>(null);
  // Up/Down move between the jump rows; Enter opens the focused one (it is a button).
  const onKeys = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const rows = [...(listRef.current?.querySelectorAll<HTMLButtonElement>('.kx-jump-row') || [])];
    const i = rows.indexOf(document.activeElement as HTMLButtonElement);
    e.preventDefault();
    rows[(i + (e.key === 'ArrowDown' ? 1 : rows.length - 1)) % rows.length]?.focus();
  };
  return (
    <div className="kx-start">
      <div className="kx-hello">
        <span className="hi">{greeting(now)}</span>
        <span className={'kx-market' + (market.open ? ' open' : '')} title="NYSE regular hours; exchange holidays are not checked">{market.label}</span>
      </div>
      <Briefing b={b} now={now} lines={lines} />
      <div className="kx-sec">Ask about it</div>
      <div className="agent-try" aria-label="Suggestions">
        {cards.map((c) => (
          <button key={c.kind} className={'agent-chip kx-' + c.kind} onClick={() => onTry(c.text)}>
            <span className="kx-ic"><Icon name={KIND_ICON[c.kind]} size={14} /></span><span>{c.text}</span>
          </button>
        ))}
      </div>
      <div className="kx-sec"><span>Jump to</span>{recent.length > 0 && <button className="kx-all" onClick={() => toggleThreads(true)}>All chats</button>}</div>
      <div className="kx-jump" ref={listRef} onKeyDown={onKeys}>
        {recent.map((t) => (
          <div key={t.id} className="kx-jump-entry"><button className="kx-jump-row" title={t.preview || t.title} onClick={() => void openThread(t.id)}>
            <Icon name="chat" size={14} /><span className="t">{t.title}</span><span className="when">{ago(t.updatedAt, now)}</span>
          </button><button className="agent-icon-btn kx-jump-delete" aria-label={`Delete recent chat ${t.title}`} onClick={() => void deleteThread(t)}><Icon name="trash" size={14} /></button></div>
        ))}
        <button className="kx-jump-row cmd" onClick={onCommand}>
          <Icon name="slash" size={14} /><span className="t">Commands and skills</span><span className="when">/cost · /skills · /strategies</span>
        </button>
      </div>
      <div className="kx-foot">Answers cite sources and data times. {s.name} never trades.</div>
    </div>
  );
}
const ago = (ts: number, now: number) => { const m = Math.max(0, Math.round((now - ts) / 6e4)); return m < 1 ? 'now' : m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`; };

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

export function Chat({ inputRef, onRetry, docked }: { inputRef: RefObject<HTMLTextAreaElement | null>; onRetry: () => void; docked: boolean }) {
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
    const measure = () => { if (el.clientWidth) setNarrow(!docked && el.clientWidth < RAIL_MIN); };
    measure();
    const ro = new ResizeObserver(measure); ro.observe(el);
    return () => ro.disconnect();
  }, [docked]);
  const lastTop = useRef(0);
  // A blur closes the slash menu shortly after (so a click on it still lands); refocusing cancels that.
  const blurTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const scrollBottom = (force = false) => { const el = logRef.current; if (el && (force || stick)) { el.scrollTop = el.scrollHeight; setStick(true); } };
  useLayoutEffect(() => { scrollBottom(); }, [s.stick, s.items.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => { scrollBottom(true); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const autosize = () => { const el = inputRef.current; if (el) { el.style.height = 'auto'; el.style.height = Math.min(200, el.scrollHeight) + 'px'; } };
  useLayoutEffect(autosize, [s.draft]); // eslint-disable-line react-hooks/exhaustive-deps

  const brain = s.brains.find((b) => b.id === s.brain && b.available);
  const menu = menuOpen ? menuItems(s.draft) : null;
  const all = menu ? [...menu.skills, ...menu.cmds] : [];
  const sel = Math.min(menuSel, Math.max(0, all.length - 1));
  useLayoutEffect(() => { if (menu) document.getElementById(`agent-option-${sel}`)?.scrollIntoView({ block: 'nearest' }); }, [sel, !!menu]);
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
  else if (s.view === 'welcome') body = <><Welcome onTry={send} onCommand={() => { setDraft('/'); setMenuOpen(true); inputRef.current?.focus(); }} />{items}</>;
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
          <div id="agent-command-menu" className="agent-menu" hidden={!menu} role="listbox" tabIndex={0} aria-label="Commands and skills" aria-activedescendant={menu && all.length ? `agent-option-${sel}` : undefined}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setMenuSel((sel + (e.key === 'ArrowDown' ? 1 : -1) + all.length) % Math.max(1, all.length)); }
              if (e.key === 'Enter') { e.preventDefault(); pick(sel); }
              if (e.key === 'Escape') { e.stopPropagation(); setMenuOpen(false); inputRef.current?.focus(); }
            }}>
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
              onBlur={() => { blurTimer.current = setTimeout(() => setMenuOpen(false), 120); }} onFocus={() => { clearTimeout(blurTimer.current); setMenuOpen(true); }}
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
            <div className="agent-tools-row">
              {s.council && <><label className="kx-pill kx-select" title="Analytical lens"><select aria-label="Analytical lens" value={s.lens} onChange={(e) => chooseLens(e.target.value)}>{LENSES.map(({id, label}) => <option key={id} value={id}>{label}</option>)}</select></label><button className="agent-ctx kx-pill" disabled={!!s.running} onClick={() => setDraft('/committee ')} title="Ask the investment council">Council</button></>}

              <button className="agent-icon-btn" title="Attach images or documents (or paste / drop)" aria-label="Attach files" onClick={() => fileRef.current?.click()}><Icon name="clip" /></button>
              <button className={'agent-ctx kx-pill' + (ctxOn ? ' on' : '')} title="Send what you are looking at (symbol, timeframe, strategy) with your message"
                onClick={() => { const v = !ctxOn; setCtxOn(v); ls.set(LS.ctx, v ? '1' : '0'); }}>{ctxButton(ctxOn, pc)}</button>
              <label className="kx-pill kx-select" title="Model for this chat">
                <Icon name="spark" size={13} />
                <select className="agent-model" aria-label="Model" disabled={!!s.running || s.sending} value={s.brain} onChange={(e) => chooseBrain(e.target.value)}>
                  {s.brains.map((b) => <option key={b.id} value={b.id} disabled={!b.available} title={b.available ? b.label : b.reason}>{`${b.label} ${b.costTier}${b.ui ? ' · views' : ''}${b.available ? '' : ' · n/a'}`}</option>)}
                </select>
              </label>
              {brain?.thinking && (
                <label className={'kx-pill kx-select kx-think' + (s.effort && s.effort !== 'none' ? ' on' : '')} title="Thinking for the next message. More thinking can take longer and cost more.">
                  <Icon name="bulb" size={13} />
                  <select className="agent-effort" aria-label="Thinking effort" value={s.effort} disabled={!!s.running || s.sending} onChange={(e) => chooseEffort(e.target.value)}>
                    <optgroup label="Thinking">{brain.thinking.levels.map((l) => <option key={l} value={l}>{effortLabel(l)}</option>)}</optgroup>
                  </select>
                </label>
              )}
              {s.searchProviders.length > 0 && (
                <label className="kx-pill kx-select" title="Web search provider, independent of the model">
                  <Icon name="globe" size={13} />
                  <select className="agent-search" aria-label="Web search" value={s.search} onChange={(e) => chooseSearch(e.target.value)}>
                    <option value="auto">{`Auto${searchDefault ? ` (${searchDefault})` : ''}`}</option>
                    {s.searchProviders.map((p) => <option key={p.id} value={p.id} disabled={!p.available} title={p.reason}>{`${p.label}${p.available ? '' : ' · no key'}`}</option>)}
                  </select>
                </label>
              )}
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
