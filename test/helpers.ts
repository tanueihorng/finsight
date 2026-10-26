// Test harness, part 2: fake market fixtures and reset. Import this BEFORE any
// lib/ module (its first import, ./setup.ts, prepares the environment).
import { dataDir, market } from './setup.ts';
import fs from 'node:fs';
import path from 'node:path';
import { cache } from '../lib/cache.ts';

export { dataDir, market };
export const DAY = 24 * 60 * 60 * 1000;

// Daily bars ending today: closes[i] is (closes.length - 1 - i) days ago.
export function dailyBars(closes: number[]) {
  const today = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());
  return closes.map((c, i) => ({ t: today - (closes.length - 1 - i) * DAY + 14 * 3600e3, c, h: c, l: c }));
}
export function setSymbol(symbol: string, { currency = 'USD', price, prevClose, bars = [] }: { currency?: string; price?: number; prevClose?: number; bars?: { t: number; c: number; h: number; l: number }[] } = {}) {
  const last = bars.length ? bars[bars.length - 1]!.c : price!;
  market.set(symbol, { currency, price: price ?? last, prevClose: prevClose ?? price ?? last, bars });
}
export function reset() {
  market.clear();
  cache.clear();
  for (const f of fs.readdirSync(dataDir)) fs.rmSync(path.join(dataDir, f), { force: true, recursive: true });
}
