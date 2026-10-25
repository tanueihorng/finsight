// Add form helpers (D2), ported from public/app.js S18.
export const buyQS = ({ base, account }: { base: string; account: string }) =>
  `?base=${encodeURIComponent(base)}&account=${encodeURIComponent(account || '')}`;
export const buyStatus = (symbol: string, qty: string, price: string, date: string | null) =>
  `BOUGHT ${qty} ${symbol} @ ${price}${date ? ' on ' + date : ''}`;
// Arrow keys in the suggestion list: clamp to the list (legacy never wraps).
export function moveIndex(i: number, step: 1 | -1, length: number): number {
  return step > 0 ? Math.min(i + 1, length - 1) : Math.max(i - 1, 0);
}
