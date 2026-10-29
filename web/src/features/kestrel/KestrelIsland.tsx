import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from 'zustand';
import { boot, chat, deleteThread, closeOverlay, closeStream, newChat, railShown, resumeStream, stop, toggleThreads } from './chat.ts';
import { Icon, type IconName } from './icons.tsx';
import { Chat } from './Chat.tsx';
import { kestrelDock } from './dock.ts';
import { clampHeight, clampWidth, DEFAULT_H, DEFAULT_W, LS, ls, nextWidth } from './labels.ts';

// Kestrel shell (G3): the side drawer (resizable width) or a docked terminal
// panel (resizable height, collapsible), the ↗ ASK toggle, ⌘/ and Esc. App
// renders the dock panel (#agent-dock, pid "kestrel") from kestrelDock; this
// island fills its head, body and resize slot through portals and moves the
// one chat between the drawer and the dock.
type Mode = 'side' | 'dock';
const dockEl = () => document.getElementById('agent-dock');
const resizeEvent = () => window.dispatchEvent(new Event('resize'));
const cssWidth = () => parseInt(getComputedStyle(document.documentElement).getPropertyValue('--agent-w'), 10) || DEFAULT_W;

export default function KestrelIsland() {
  const name = useStore(chat, (s) => s.name), rail = useStore(chat, railShown);
  // The list has the title the agent set from the first message; the open thread object keeps its creation title.
  const activeThread = useStore(chat, (s) => s.thread);
  const chatTitle = useStore(chat, (s) => (s.view === 'welcome' ? 'New chat' : s.threads?.find((x) => x.id === s.thread?.id)?.title || s.thread?.title || ''));
  const [mode, setModeState] = useState<Mode>(() => (ls.get(LS.mode, 'side') === 'dock' ? 'dock' : 'side'));
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsedState] = useState(() => ls.get(LS.collapsed, '0') === '1');
  const [width, setWidthState] = useState(DEFAULT_W);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const booted = useRef(false);
  const dock = dockEl(), dockHead = dock?.querySelector('.agent-dock-head') ?? null, dockBody = dock?.querySelector('.agent-dock-body') ?? null, dockSlot = dock?.querySelector('.agent-dock-resize-slot') ?? null;
  const slot = document.getElementById('agent-toggle-slot');

  const setWidth = useCallback((w: number, save: boolean) => {
    const v = clampWidth(w, window.innerWidth);
    document.documentElement.style.setProperty('--agent-w', v + 'px'); setWidthState(v);
    if (save) { ls.set(LS.width, v); resizeEvent(); }
    return v;
  }, []);
  const setHeight = (px: number, save: boolean) => {
    const v = clampHeight(px, window.innerHeight);
    dockEl()?.style.setProperty('--agent-dock-h', v + 'px');
    dockEl()?.querySelector('.agent-dock-resize')?.setAttribute('aria-valuenow', String(v));
    if (save) ls.set(LS.dockH, v);
  };
  const curHeight = () => parseInt(dockEl()?.style.getPropertyValue('--agent-dock-h') || '', 10) || DEFAULT_H;
  const setCollapsed = (on: boolean) => { setCollapsedState(on); ls.set(LS.collapsed, on ? '1' : '0'); };
  // Boot the chat the first time it opens while FinSight is unlocked (and again after a lock).
  const maybeBoot = () => {
    if (booted.current || document.body.classList.contains('locked')) return;
    booted.current = true;
    void boot().then((r) => { if (r === 'locked') booted.current = false; });
  };
  const toggle = (force?: boolean, restoring = false, as: Mode = mode) => {
    const next = force ?? !open;
    if (!next && !document.body.classList.contains('locked')) document.getElementById('agent-toggle')?.focus({ preventScroll: true });
    setOpen(next); ls.set(LS.open, next ? '1' : '0');
    if (as === 'dock' && next && !restoring) setCollapsed(false); // a reload keeps it collapsed
    if (next) {
      maybeBoot();
      setTimeout(() => inputRef.current?.focus({ preventScroll: as === 'dock' }), 30);
      if (as === 'dock' && !restoring) setTimeout(() => dockEl()?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 0);
    }
    setTimeout(resizeEvent, 0);
  };
  const setMode = (m: Mode) => {
    if (m === mode) return;
    setModeState(m); ls.set(LS.mode, m);
    toggle(true, false, m);
  };

  useEffect(() => {
    setWidth(Number(ls.get(LS.width, String(DEFAULT_W))) || DEFAULT_W, false);
    setHeight(Number(ls.get(LS.dockH, String(DEFAULT_H))) || DEFAULT_H, false);
    if (ls.get(LS.open, '0') === '1') toggle(true, true);
    const onUnlock = () => { resumeStream(); if (ls.get(LS.open, '0') === '1') maybeBoot(); };
    const onResize = () => { if (cssWidth() > Math.max(320, Math.round(window.innerWidth * 0.6))) setWidth(window.innerWidth * 0.6, false); };
    window.addEventListener('finsight:locked', closeStream);
    window.addEventListener('finsight:unlocked', onUnlock);
    window.addEventListener('resize', onResize);
    return () => { window.removeEventListener('finsight:locked', closeStream); window.removeEventListener('finsight:unlocked', onUnlock); window.removeEventListener('resize', onResize); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Where the chat shows: body.agent-open for the drawer, the dock's hidden/collapsed state for the dock.
  useEffect(() => { document.body.classList.toggle('agent-open', mode === 'side' && open); }, [mode, open]);
  useEffect(() => { kestrelDock.setState({ visible: mode === 'dock' && open, collapsed }); }, [mode, open, collapsed]);
  // ⌘/ toggles; Esc stops a reply, or closes the drawer / collapses the dock, but never discards a typed message.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === '/') { e.preventDefault(); toggle(); return; }
      const host = mode === 'side' ? document.getElementById('agent-panel') : dockEl();
      if (e.key === 'Escape' && open && host?.contains(document.activeElement)) {
        if (chat.getState().running) return void stop();
        if (!chat.getState().draft.trim()) { if (mode === 'side') toggle(false); else setCollapsed(true); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  const drag = (axis: 'x' | 'y') => (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const el = e.currentTarget; el.setPointerCapture(e.pointerId);
    const cls = axis === 'x' ? 'agent-resizing' : 'agent-resizing-v';
    document.body.classList.add(cls);
    const top = dockEl()?.querySelector('.agent-dock-body')?.getBoundingClientRect().top ?? 0;
    const move = (ev: PointerEvent) => { if (axis === 'x') setWidth(window.innerWidth - ev.clientX, false); else setHeight(ev.clientY - top, false); };
    const up = () => { el.removeEventListener('pointermove', move); document.body.classList.remove(cls); if (axis === 'x') setWidth(cssWidth(), true); else setHeight(curHeight(), true); };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up, { once: true });
  };
  const widthKeys = (e: ReactKeyboardEvent) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); setWidth(cssWidth() + 20, true); }
    if (e.key === 'ArrowRight') { e.preventDefault(); setWidth(cssWidth() - 20, true); }
  };
  const heightKeys = (e: ReactKeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHeight(curHeight() + 40, true); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setHeight(curHeight() - 40, true); }
  };

  const title = (
    <span className="agent-title"><span className="mark">↗</span> <span className="nm">{name}</span>
      {chatTitle && <><span className="sep" aria-hidden="true">/</span><span className="chat-title" title={chatTitle}>{chatTitle}</span></>}</span>
  );
  // Frequent actions stay as icons (chats, new chat, close); layout and delete live under More.
  const tools = (
    <span className="agent-head-tools">
      <button className="agent-icon-btn" title="Chats" aria-label="Show chats" aria-expanded={rail} aria-controls="agent-threads" onClick={() => toggleThreads()}><Icon name="sidebar" /></button>
      <button className="agent-icon-btn" title="New chat (/new)" aria-label="New chat" onClick={() => { newChat(); closeOverlay(); inputRef.current?.focus(); }}><Icon name="plus" /></button>
      <MoreMenu items={[
        { label: mode === 'dock' ? 'Pop out to the side panel' : 'Dock into the terminal', icon: mode === 'dock' ? 'popout' : 'dock', run: () => setMode(mode === 'dock' ? 'side' : 'dock') },
        ...(mode === 'side' ? [{ label: 'Panel width', hint: 'S · M · L · XL', icon: 'width' as const, run: () => setWidth(nextWidth(cssWidth(), Math.max(320, Math.round(window.innerWidth * 0.6))), true), keep: true }] : []),
        ...(activeThread ? [{ label: 'Delete this chat', aria: 'Delete current chat', icon: 'trash' as const, danger: true, run: () => void deleteThread({ ...activeThread, title: chatTitle || activeThread.title }) }] : []),
      ]} />
      <button className="agent-icon-btn" title={collapsed ? 'Expand' : 'Collapse'} aria-label="Collapse chat" aria-expanded={!collapsed} hidden={mode !== 'dock'}
        onClick={() => setCollapsed(!collapsed)}><Icon name={collapsed ? 'expand' : 'collapse'} /></button>
      <button className="agent-icon-btn" title="Close (Esc)" aria-label="Close chat" onClick={() => toggle(false)}><Icon name="close" /></button>
    </span>
  );
  const body = <Chat inputRef={inputRef} docked={mode === 'dock'} onRetry={() => { booted.current = true; void boot(); }} />;
  return (
    <>
      {slot && createPortal(
        <button id="agent-toggle" className={'topbar-btn agent-toggle' + (open ? ' active' : '')} title="Open Kestrel (⌘/)"
          aria-controls={mode === 'dock' ? 'agent-dock' : 'agent-panel'} aria-expanded={open} onClick={() => toggle()}>
          <span className="mark">↗</span> <span className="tname">{name.toUpperCase()}</span><span className="kbd">⌘/</span>
        </button>, slot)}
      <aside className="agent-panel" id="agent-panel" role="complementary" aria-label="Agent chat">
        <div className="agent-resize" role="separator" aria-orientation="vertical" aria-label="Resize chat panel" aria-valuenow={width} tabIndex={0}
          title="Drag to resize · double-click to reset · ← → keys" onPointerDown={drag('x')} onDoubleClick={() => setWidth(DEFAULT_W, true)} onKeyDown={widthKeys}>
          <span className="agent-grip">⋮</span>
        </div>
        <div className="agent-head">{mode === 'side' && <>{title}{tools}</>}</div>
        {mode === 'side' && body}
      </aside>
      {mode === 'dock' && dockHead && createPortal(<>{title}{tools}</>, dockHead)}
      {mode === 'dock' && dockBody && createPortal(body, dockBody)}
      {dockSlot && createPortal(
        <div className="agent-dock-resize" role="separator" aria-orientation="horizontal" aria-label="Resize chat height" aria-valuenow={curHeight()} tabIndex={0}
          title="Drag to resize · double-click to reset · ↑ ↓ keys" onPointerDown={drag('y')} onDoubleClick={() => setHeight(DEFAULT_H, true)} onKeyDown={heightKeys}>
          <span className="agent-grip">⋯</span>
        </div>, dockSlot)}
    </>
  );
}

type MoreItem = { label: string; icon: IconName; run: () => void; aria?: string; hint?: string; danger?: boolean; keep?: boolean };
// The header's overflow menu: arrow keys move, Esc or a click outside closes it.
function MoreMenu({ items }: { items: MoreItem[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null), btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', away);
    ref.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);
  const onKey = (e: ReactKeyboardEvent) => {
    if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false); btn.current?.focus(); return; }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const rows = [...(ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') || [])];
    const i = rows.indexOf(document.activeElement as HTMLButtonElement);
    e.preventDefault(); rows[(i + (e.key === 'ArrowDown' ? 1 : rows.length - 1)) % rows.length]?.focus();
  };
  return (
    <span className="kx-more" ref={ref} onKeyDown={onKey}>
      <button ref={btn} className="agent-icon-btn" title="More" aria-label="More chat options" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}><Icon name="more" /></button>
      {open && <span className="kx-menu" role="menu" aria-label="Chat options">
        {items.map((it) => (
          <button key={it.label} role="menuitem" className={it.danger ? 'danger' : undefined} aria-label={it.aria} title={it.aria ? it.label : undefined}
            onClick={() => { if (!it.keep) setOpen(false); it.run(); }}>
            <Icon name={it.icon} size={15} /><span className="t">{it.label}</span>{it.hint && <span className="h">{it.hint}</span>}
          </button>
        ))}
      </span>}
    </span>
  );
}
