import { useLayoutEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
// Renders a panel's head controls into its [data-island-slot="<island>:head"].
// Since X1 the slot can be committed in the same render as the body, so it is
// looked up again after mount.
const find = (island: string) => Array.from(document.querySelectorAll('[data-island-slot]')).find((node) => node.getAttribute('data-island-slot') === `${island}:head`) ?? null;
export function PanelHeadSlot({ island, children }: { island: string; children: ReactNode }) {
  const [slot, setSlot] = useState<Element | null>(() => find(island));
  useLayoutEffect(() => { if (!slot || !slot.isConnected) setSlot(find(island)); });
  return slot ? createPortal(children, slot) : null;
}
