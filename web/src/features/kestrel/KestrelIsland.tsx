import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from 'zustand';
import { boot, chat, deleteThread, closeOverlay, closeStream, newChat, railShown, resumeStream, stop, toggleThreads } from './chat.ts';
import { Icon } from './icons.tsx';
import { Chat } from './Chat.tsx';
import { Capsule } from './Capsule.tsx';
import { councilView, setCouncilView } from './council.ts';
import { kestrelDock } from './dock.ts';
import { clampHeight, clampWidth, DEFAULT_H, DEFAULT_W, LS, ls, nextWidth } from './labels.ts';

// Kestrel shell (G3): the side drawer (resizable width) or a docked terminal
// panel (resizable height, collapsible), the ↗ ASK toggle, ⌘/ and Esc. App
// renders the dock panel (#agent-dock, pid "kestrel") from kestrelDock; this
// island fills its head, body and resize slot through portals and moves the
// one chat between the drawer and the dock. FEAT-009: the drawer can grow to a
// full page below the top bar (body.agent-full, same element, so the chat never
// remounts), and a capsule shows a run in progress while the panel is closed.
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
  const [full, setFullState] = useState(false);
  const running = useStore(chat, (s) => !!s.running);
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
    if (!next) setFullState(false);
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

  // Full page is a drawer state: a docked chat pops out first. Not persisted.
  const setFull = (on: boolean) => {
    if (on && mode === 'dock') { setModeState('side'); ls.set(LS.mode, 'side'); }
    setFullState(on);
    if (on && !open) toggle(true, false, 'side'); else setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 30);
    setTimeout(resizeEvent, 0);
  };

  const fullRef = useRef(setFull); fullRef.current = setFull;
  useEffect(() => {
    setWidth(Number(ls.get(LS.width, String(DEFAULT_W))) || DEFAULT_W, false);
    setHeight(Number(ls.get(LS.dockH, String(DEFAULT_H))) || DEFAULT_H, false);
    if (ls.get(LS.open, '0') === '1') toggle(true, true);
    const onUnlock = () => { resumeStream(); if (ls.get(LS.open, '0') === '1') maybeBoot(); };
    const onResize = () => { if (cssWidth() > Math.max(320, Math.round(window.innerWidth * 0.6))) setWidth(window.innerWidth * 0.6, false); };
    const onFull = () => fullRef.current(true);
    window.addEventListener('kestrel:full', onFull);
    window.addEventListener('finsight:locked', closeStream);
    window.addEventListener('finsight:unlocked', onUnlock);
    window.addEventListener('resize', onResize);
    return () => { window.removeEventListener('finsight:locked', closeStream); window.removeEventListener('finsight:unlocked', onUnlock); window.removeEventListener('resize', onResize); window.removeEventListener('kestrel:full', onFull); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Where the chat shows: body.agent-open for the drawer, the dock's hidden/collapsed state for the dock.
  useEffect(() => { document.body.classList.toggle('agent-open', mode === 'side' && open); }, [mode, open]);
  // Full page covers the grid below the top bar; the grid is inert so Tab stays in the chat.
  useEffect(() => {
    const on = mode === 'side' && open && full;
    document.body.classList.toggle('agent-full', on);
    document.querySelector('main.grid')?.toggleAttribute('inert', on);
    if (!on) return;
    // Measured after the class lands: the top bar wraps differently without the drawer's padding.
    const measure = () => document.documentElement.style.setProperty('--kx-top', Math.round(document.querySelector('header.topbar')?.getBoundingClientRect().bottom ?? 0) + 'px');
    measure(); window.addEventListener('resize', measure);
    return () => { window.removeEventListener('resize', measure); document.body.classList.remove('agent-full'); document.querySelector('main.grid')?.removeAttribute('inert'); };
  }, [mode, open, full]);
  useEffect(() => { document.body.classList.toggle('kx-busy', running); }, [running]);
  useEffect(() => { kestrelDock.setState({ visible: mode === 'dock' && open, collapsed }); }, [mode, open, collapsed]);
  // ⌘/ toggles; Esc stops a reply, or closes the drawer / collapses the dock, but never discards a typed message.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === '/' || e.key === '?')) { e.preventDefault(); setFull(!(full && open)); return; }
      if ((e.metaKey || e.ctrlKey) && e.key === '/') { e.preventDefault(); toggle(); return; }
      if ((e.metaKey || e.ctrlKey) && e.key === '.' && full && open) { e.preventDefault(); setCouncilView(councilView.getState().view === 'cards' ? 'chain' : 'cards'); return; }
      const host = mode === 'side' ? document.getElementById('agent-panel') : dockEl();
      if (e.key === 'Escape' && open && host?.contains(document.activeElement)) {
        if (chat.getState().running) return void stop();
        if (!chat.getState().draft.trim()) { if (full) setFull(false); else if (mode === 'side') toggle(false); else setCollapsed(true); }
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
  const dockTitle = mode === 'dock' ? 'Pop out to the side panel' : 'Dock into the terminal';
  const tools = (
    <span className="agent-head-tools">
      {activeThread && <button className="agent-icon-btn" title="Delete this chat" aria-label="Delete current chat" onClick={() => void deleteThread({ ...activeThread, title: chatTitle || activeThread.title })}><Icon name="trash" /></button>}
      <button className="agent-icon-btn" title="Chats" aria-label="Show chats" aria-expanded={rail} aria-controls="agent-threads" onClick={() => toggleThreads()}><Icon name="sidebar" /></button>
      <button className="agent-icon-btn" title="New chat (/new)" aria-label="New chat" onClick={() => { newChat(); closeOverlay(); inputRef.current?.focus(); }}><Icon name="plus" /></button>
      <button className="agent-icon-btn" title="Panel width: small · medium · large · wide" aria-label="Change panel width" hidden={mode !== 'side' || full}
        onClick={() => setWidth(nextWidth(cssWidth(), Math.max(320, Math.round(window.innerWidth * 0.6))), true)}><Icon name="width" /></button>
      <button className="agent-icon-btn" title={full ? 'Back to the side panel (⌘⇧/)' : 'Full page (⌘⇧/)'} aria-label={full ? 'Exit full page' : 'Open full page'} aria-pressed={full}
        onClick={() => setFull(!full)}><Icon name={full ? 'minimize' : 'maximize'} /></button>
      <button className="agent-icon-btn" title={dockTitle} hidden={full} aria-label={dockTitle} onClick={() => setMode(mode === 'dock' ? 'side' : 'dock')}><Icon name={mode === 'dock' ? 'popout' : 'dock'} /></button>
      <button className="agent-icon-btn" title={collapsed ? 'Expand' : 'Collapse'} aria-label="Collapse chat" aria-expanded={!collapsed} hidden={mode !== 'dock'}
        onClick={() => setCollapsed(!collapsed)}><Icon name={collapsed ? 'expand' : 'collapse'} /></button>
      <button className="agent-icon-btn" title="Close (Esc)" aria-label="Close chat" onClick={() => toggle(false)}><Icon name="close" /></button>
    </span>
  );
  const body = <Chat inputRef={inputRef} docked={mode === 'dock'} full={full && mode === 'side' && open} onRetry={() => { booted.current = true; void boot(); }} />;
  return (
    <>
      {slot && createPortal(
        <button id="agent-toggle" className={'topbar-btn agent-toggle' + (open ? ' active' : '') + (running ? ' busy' : '')} title="Open Kestrel (⌘/)"
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
      {!open && running && createPortal(<Capsule onOpen={() => toggle(true)} onFull={() => setFull(true)} />, document.body)}
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
