// Portfolio analytics logic (C3), ported 1:1 from public/app.js S30/S31:
// squarified treemap + heat colours (sector heatmap), donut slices
// (allocation), the net-worth breakdown model, and the performance chart paths.
import type { Position } from '../../../../shared/types.ts';
import { ASSET_CLASSES, assetClass, splitByAccount, type Categories } from '../positions/table.ts';

export interface Rect { x: number; y: number; w: number; h: number }
// Squarified treemap: data [{value,...}] in rect -> [{...,x,y,w,h}] (fills, no overlap).
export function treemap<T extends { value: number }>(data: T[], x: number, y: number, w: number, h: number): (T & Rect)[] {
  const nodes = data.filter((d) => d.value > 0).map((d) => ({ d, value: d.value, area: 0 }));
  const out: (T & Rect)[] = [];
  const total = nodes.reduce((s, n) => s + n.value, 0);
  if (!total || w <= 0 || h <= 0) return out;
  const scale = (w * h) / total;
  nodes.forEach((n) => (n.area = n.value * scale));
  const rect = { x, y, w, h };
  let row: typeof nodes = [], i = 0;
  const shortest = () => Math.min(rect.w, rect.h);
  const worst = (r: typeof nodes, side: number) => {
    const s = r.reduce((a, q) => a + q.area, 0); let mx = 0, mn = Infinity;
    for (const q of r) { mx = Math.max(mx, q.area); mn = Math.min(mn, q.area); }
    return Math.max((side * side * mx) / (s * s), (s * s) / (side * side * mn));
  };
  const layout = (r: typeof nodes) => {
    const s = r.reduce((a, q) => a + q.area, 0);
    if (rect.w >= rect.h) {
      const rw = s / rect.h; let cy = rect.y;
      for (const q of r) { const rh = q.area / rw; out.push({ ...q.d, x: rect.x, y: cy, w: rw, h: rh }); cy += rh; }
      rect.x += rw; rect.w -= rw;
    } else {
      const rh = s / rect.w; let cx = rect.x;
      for (const q of r) { const rw = q.area / rh; out.push({ ...q.d, x: cx, y: rect.y, w: rw, h: rh }); cx += rw; }
      rect.y += rh; rect.h -= rh;
    }
  };
  while (i < nodes.length) {
    const n = nodes[i]!, side = shortest();
    if (row.length === 0 || worst(row, side) >= worst([...row, n], side)) { row.push(n); i++; }
    else { layout(row); row = []; }
  }
  if (row.length) layout(row);
  return out;
}
export function heatColor(pct: number | null | undefined): string {
  const t = Math.max(-1, Math.min(1, (pct || 0) / 3)); // clamp at ±3%
  const neutral = [26, 31, 38], tgt = t >= 0 ? [38, 175, 110] : [205, 55, 55], a = Math.abs(t);
  const c = neutral.map((n, i) => Math.round(n + (tgt[i]! - n) * a));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
export interface Sector { category: string; value: number; items: Position[] }
export function sectors(positions: Position[], cats: Categories): Sector[] {
  const groups: Record<string, Sector> = {};
  positions.forEach((p) => {
    const cat = cats[p.symbol]?.category || 'Other';
    (groups[cat] || (groups[cat] = { category: cat, value: 0, items: [] }));
    groups[cat].value += p.marketValue; groups[cat].items.push(p);
  });
  return Object.values(groups).filter((g) => g.value > 0);
}

export type AllocMode = 'holding' | 'sector' | 'class' | 'account';
export const PALETTE = ['#a78bfa', '#38bdf8', '#2ec27e', '#fb7185', '#f472b6', '#facc15', '#34d399', '#60a5fa', '#2dd4bf', '#c084fc', '#94a3b8'];
export interface Slice { label: string; value: number; color: string; frac: number; path: string | null }
export function allocationSlices(positions: Position[], mode: AllocMode, cats: Categories, accountName: string): Slice[] {
  let items: { label: string; value: number }[];
  if (mode === 'holding') items = positions.map((p) => ({ label: p.symbol, value: p.marketValue }));
  else {
    const g: Record<string, number> = {};
    const rows = mode === 'account' ? positions.flatMap((p) => splitByAccount(p, accountName)) : positions;
    rows.forEach((p) => {
      const c = mode === 'sector' ? (cats[p.symbol]?.category || 'Other') : mode === 'class' ? assetClass(cats, p.symbol) : (p as { account?: string }).account ?? '';
      g[c] = (g[c] || 0) + p.marketValue;
    });
    items = Object.entries(g).map(([label, value]) => ({ label, value }));
  }
  items.sort((a, b) => b.value - a.value);
  const total = items.reduce((s, i) => s + i.value, 0) || 1;
  const cx = 70, cy = 70, r = 60, rin = 36; let ang = -Math.PI / 2;
  return items.map((it, i) => {
    const frac = it.value / total, a2 = ang + Math.max(frac, 0.0001) * 2 * Math.PI, color = PALETTE[i % PALETTE.length]!;
    // A single 100% slice is a degenerate arc: the island draws a full ring instead (path null).
    let path: string | null = null;
    if (frac < 0.9999) {
      const x1 = cx + r * Math.cos(ang), y1 = cy + r * Math.sin(ang), x2 = cx + r * Math.cos(a2), y2 = cy + r * Math.sin(a2);
      const xi1 = cx + rin * Math.cos(a2), yi1 = cy + rin * Math.sin(a2), xi2 = cx + rin * Math.cos(ang), yi2 = cy + rin * Math.sin(ang);
      const large = frac > 0.5 ? 1 : 0;
      path = `M${x1} ${y1} A${r} ${r} 0 ${large} 1 ${x2} ${y2} L${xi1} ${yi1} A${rin} ${rin} 0 ${large} 0 ${xi2} ${yi2} Z`;
    }
    ang = a2;
    return { ...it, color, frac, path };
  });
}

// ---- net worth breakdown ----
export const CLASS_COLORS: Record<string, string> = { Stocks: '#a78bfa', ETFs: '#38bdf8', Crypto: '#facc15', 'Funds & Other': '#f472b6', Cash: '#2ec27e' };
export const WEALTH_ORDER = [...ASSET_CLASSES, 'Cash'];
export interface WealthAccount { id: string; name: string; parts: Record<string, number>; cash: number; cashList: { ccy: string; amount: number; base: number }[]; net: number }
export function wealthAccount(id: string, name: string, positions: Position[], cash: { ccy: string; amount: number; base: number }[], cats: Categories): WealthAccount {
  const parts: Record<string, number> = {};
  positions.forEach((p) => { const c = assetClass(cats, p.symbol); parts[c] = (parts[c] || 0) + p.marketValue; });
  const cashBase = cash.reduce((s, c) => s + (c.base || 0), 0);
  if (cashBase) parts.Cash = cashBase;
  return { id, name, parts, cash: cashBase, cashList: cash, net: Object.values(parts).reduce((s, v) => s + v, 0) };
}
export function wealthTotals(accts: WealthAccount[]) {
  const tot: Record<string, number> = {};
  accts.forEach((a) => Object.entries(a.parts).forEach(([k, v]) => { tot[k] = (tot[k] || 0) + v; }));
  const net = Object.values(tot).reduce((s, v) => s + v, 0);
  const cashCcy: Record<string, number> = {};
  accts.forEach((a) => a.cashList.forEach((c) => { cashCcy[c.ccy] = (cashCcy[c.ccy] || 0) + c.amount; }));
  return { tot, net, cashCcy, maxNet: Math.max(...accts.map((a) => a.net)) || 1 };
}

// ---- performance chart ----
export interface PerfPoint { t: number; value: number; invested: number; bench?: number | null }
export const PERF_W = 600, PERF_H = 160, PERF_PAD = 4;
export function perfPaths(points: PerfPoint[], bench: boolean) {
  const W = PERF_W, H = PERF_H, pad = PERF_PAD;
  const keys: (keyof PerfPoint)[] = ['value', 'invested', ...(bench ? ['bench' as const] : [])];
  const vals = points.flatMap((p) => keys.map((k) => p[k]).filter((v): v is number => v != null));
  const min = Math.min(...vals), max = Math.max(...vals), span = (max - min) || 1;
  const x = (i: number) => pad + i * (W - pad * 2) / (points.length - 1);
  const y = (v: number) => pad + (H - pad * 2) * (1 - (v - min) / span);
  const path = (k: keyof PerfPoint) => points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[k] as number).toFixed(1)}`).join(' ');
  const last = points[points.length - 1]!;
  return {
    value: path('value'), invested: path('invested'), bench: bench ? path('bench') : null, up: last.value >= last.invested,
    area: `${path('value')} L${x(points.length - 1).toFixed(1)},${H - pad} L${x(0).toFixed(1)},${H - pad} Z`,
  };
}
export const perfCrossX = (i: number, n: number) => PERF_PAD + i * (PERF_W - PERF_PAD * 2) / (n - 1);
// Holdings signature: performance refetches when symbols/quantities or the base change.
export const holdingsSig = (positions: Position[]) => positions.map((p) => p.symbol + ':' + p.quantity).join(',');
