import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
export function PanelHeadSlot({ island, children }: { island: string; children: ReactNode }) {
  const slot = Array.from(document.querySelectorAll('[data-island-slot]')).find((node) => node.getAttribute('data-island-slot') === `${island}:head`);
  return slot ? createPortal(children, slot) : null;
}
