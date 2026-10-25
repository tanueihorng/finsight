import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from 'zustand';
import { boot, chat, newChat, resumeStream, stop, toggleThreads } from './chat.ts';
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
  const name = useStore(chat, (s) => s.name), named = useStore(chat, (s) => s.named), threadsOpen = useStore(chat, (s) => s.threadsOpen);
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
    window.addEventListener('finsight:unlocked', onUnlock);
    window.addEventListener('resize', onResize);
    return () => { window.removeEventListener('finsight:unlocked', onUnlock); window.removeEventListener('resize', onResize); };
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

  const title = <span className="agent-title"><span className="mark">↗</span> <span className="nm">{name}</span><small>research agent</small></span>;
  const dockTitle = mode === 'dock' ? 'Pop out to the side panel' : 'Dock into the terminal';
  const tools = (
    <span className="agent-head-tools">
      <button className="agent-icon-btn" title="Chats" aria-label="Show chats" aria-expanded={threadsOpen} aria-controls="agent-threads" onClick={() => toggleThreads()}>☰</button>
      <button className="agent-icon-btn" title="New chat (/new)" aria-label="New chat" onClick={() => { newChat(); inputRef.current?.focus(); }}>＋</button>
      <button className="agent-icon-btn" title="Panel width: small · medium · large · wide" aria-label="Change panel width" hidden={mode !== 'side'}
        onClick={() => setWidth(nextWidth(cssWidth(), Math.max(320, Math.round(window.innerWidth * 0.6))), true)}>↔</button>
      <button className="agent-icon-btn" title={dockTitle} aria-label={dockTitle} onClick={() => setMode(mode === 'dock' ? 'side' : 'dock')}>{mode === 'dock' ? '⊡' : '⊟'}</button>
      <button className="agent-icon-btn" title={collapsed ? 'Expand' : 'Collapse'} aria-label="Collapse chat" aria-expanded={!collapsed} hidden={mode !== 'dock'}
        onClick={() => setCollapsed(!collapsed)}>{collapsed ? '▸' : '▾'}</button>
      <button className="agent-icon-btn" title="Close (Esc)" aria-label="Close chat" onClick={() => toggle(false)}>✕</button>
    </span>
  );
  const body = <Chat inputRef={inputRef} onRetry={() => { booted.current = true; void boot(); }} />;
  return (
    <>
      {slot && createPortal(
        <button id="agent-toggle" className={'topbar-btn agent-toggle' + (open ? ' active' : '')} title="Ask the agent (⌘/)"
          aria-controls={mode === 'dock' ? 'agent-dock' : 'agent-panel'} aria-expanded={open} onClick={() => toggle()}>
          <span className="mark">↗</span> <span className="tname">{named ? name.toUpperCase() : 'ASK'}</span><span className="kbd">⌘/</span>
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
        <div className="agent-dock-resize" role="separator" aria-orientation="horizontal" aria-label="Resize chat height" tabIndex={0}
          title="Drag to resize · double-click to reset · ↑ ↓ keys" onPointerDown={drag('y')} onDoubleClick={() => setHeight(DEFAULT_H, true)} onKeyDown={heightKeys}>
          <span className="agent-grip">⋯</span>
        </div>, dockSlot)}
    </>
  );
}
