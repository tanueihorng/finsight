import type { KeyboardEvent } from 'react';
// Give existing non-native click targets the same Enter/Space activation as a
// button, without reactivating a parent when its child control is used.
export function keyboardClick(e: KeyboardEvent<Element>) {
  if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
  e.preventDefault();
  e.currentTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}
