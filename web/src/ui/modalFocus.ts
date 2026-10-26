import { useLayoutEffect, useRef, type RefObject } from 'react';

const SELECTOR = 'a[href], button, input:not([type="hidden"]), select, textarea, [tabindex], summary';
const dialogs: HTMLElement[] = [];
// Native inertness prevents pointer/programmatic focus on the modal background;
// aria-disabled exposes that temporary state to accessibility clients as well.
// Preserve existing attributes and recompute from the top dialog for nesting.
const background = new Map<HTMLElement, { inert: boolean; disabled: string | null }>();
function syncBackground() {
  for (const [el, saved] of background) {
    el.inert = saved.inert;
    if (saved.disabled === null) el.removeAttribute('aria-disabled'); else el.setAttribute('aria-disabled', saved.disabled);
  }
  background.clear();
  if (document.body.classList.contains('locked')) return;
  let branch = dialogs.at(-1);
  while (branch && branch !== document.body) {
    const parent = branch.parentElement;
    if (!parent) break;
    for (const sibling of parent.children) {
      if (!(sibling instanceof HTMLElement) || sibling === branch || /^(SCRIPT|STYLE|LINK|NOSCRIPT)$/.test(sibling.tagName)) continue;
      background.set(sibling, { inert: sibling.inert, disabled: sibling.getAttribute('aria-disabled') });
      sibling.inert = true; sibling.setAttribute('aria-disabled', 'true');
    }
    branch = parent;
  }
}

export function useModalFocus(open: boolean, onClose: () => void, ref: RefObject<HTMLElement | null>, opts: { initialFocus?: () => HTMLElement | null } = {}) {
  const close = useRef(onClose), initial = useRef(opts.initialFocus);
  close.current = onClose; initial.current = opts.initialFocus;
  useLayoutEffect(() => {
    const box = ref.current;
    if (!open || !box) return;
    // Capture before existing passive effects put focus in an input.
    const opener = document.activeElement;
    dialogs.push(box); syncBackground();
    const active = () => dialogs.at(-1) === box && !document.body.classList.contains('locked') && box.getClientRects().length > 0;
    const items = () => [...box.querySelectorAll<HTMLElement>(SELECTOR)].filter((el) => el.tabIndex >= 0 && !el.matches(':disabled, [inert], [hidden]') && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden');
    const focus = () => { if (active()) (initial.current?.() ?? items()[0] ?? box).focus({ preventScroll: true }); };
    // Passive effects may already focus an input, or the user may navigate
    // before this deferred callback runs. Respect any focus already inside.
    const focusIfNeeded = () => { if (document.activeElement === box || !box.contains(document.activeElement)) focus(); };
    const timer = setTimeout(focusIfNeeded, 0);
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
    const onLock = () => { syncBackground(); };
    const onUnlock = () => { syncBackground(); setTimeout(focusIfNeeded, 0); };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('focusin', onFocus);
    window.addEventListener('finsight:unlocked', onUnlock);
    window.addEventListener('finsight:locked', onLock);
    return () => {
      clearTimeout(timer); dialogs.splice(dialogs.indexOf(box), 1); syncBackground();
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('focusin', onFocus);
      window.removeEventListener('finsight:unlocked', onUnlock);
      window.removeEventListener('finsight:locked', onLock);
      if (opener instanceof HTMLElement && opener.isConnected && opener.getClientRects().length && !document.body.classList.contains('locked')) opener.focus({ preventScroll: true });
    };
  }, [open, ref]);
}
