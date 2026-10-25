import { useLayoutEffect, useRef, type RefObject } from 'react';

const SELECTOR = 'a[href], button, input:not([type="hidden"]), select, textarea, [tabindex], summary';
const dialogs: HTMLElement[] = [];
export function useModalFocus(open: boolean, onClose: () => void, ref: RefObject<HTMLElement | null>, opts: { initialFocus?: () => HTMLElement | null } = {}) {
  const close = useRef(onClose), initial = useRef(opts.initialFocus);
  close.current = onClose; initial.current = opts.initialFocus;
  useLayoutEffect(() => {
    const box = ref.current;
    if (!open || !box) return;
    // Capture before existing passive effects put focus in an input.
    const opener = document.activeElement;
    dialogs.push(box);
    const active = () => dialogs.at(-1) === box && !document.body.classList.contains('locked') && box.getClientRects().length > 0;
    const items = () => [...box.querySelectorAll<HTMLElement>(SELECTOR)].filter((el) => el.tabIndex >= 0 && !el.matches(':disabled, [inert], [hidden]') && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden');
    const focus = () => { if (active()) (initial.current?.() ?? items()[0] ?? box).focus({ preventScroll: true }); };
    const timer = setTimeout(focus, 0);
    const onKey = (e: KeyboardEvent) => {
      if (!active()) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close.current(); return; }
      if (e.key !== 'Tab') return;
      const controls = items(), first = controls[0], last = controls.at(-1);
      if (!first) { e.preventDefault(); box.focus(); }
      else if (!box.contains(document.activeElement) || document.activeElement === box || e.shiftKey && document.activeElement === first || !e.shiftKey && document.activeElement === last) {
        e.preventDefault(); (e.shiftKey ? last! : first).focus();
      }
    };
    const onFocus = (e: FocusEvent) => { if (active() && !box.contains(e.target as Node)) focus(); };
    const onUnlock = () => { setTimeout(focus, 0); };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('focusin', onFocus);
    window.addEventListener('finsight:unlocked', onUnlock);
    return () => {
      clearTimeout(timer); dialogs.splice(dialogs.indexOf(box), 1);
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('focusin', onFocus);
      window.removeEventListener('finsight:unlocked', onUnlock);
      if (opener instanceof HTMLElement && opener.isConnected && opener.getClientRects().length && !document.body.classList.contains('locked')) opener.focus({ preventScroll: true });
    };
  }, [open, ref]);
}
