import { useId } from 'react';
import { Empty } from './Empty.tsx';
// Geometry ported from app.js sparkline(); per-instance gradient ids avoid collisions.
export function Spark({ points, up }: { points: readonly { c: number }[]; up: boolean }) {
  const gradient = `spark-${useId()}`;
  if (points.length < 2) return <Empty>No chart data.</Empty>;
  const W = 520, H = 150, pad = 4;
  const vals = points.map((p) => p.c);
  const min = Math.min(...vals), max = Math.max(...vals), span = (max - min) || 1;
  const stepX = (W - pad * 2) / (points.length - 1);
  const x = (i: number) => pad + i * stepX;
  const y = (v: number) => pad + (H - pad * 2) * (1 - (v - min) / span);
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.c).toFixed(1)}`).join(' ');
  const area = `${line} L${x(points.length - 1).toFixed(1)},${H - pad} L${x(0).toFixed(1)},${H - pad} Z`;
  const color = up ? 'var(--up)' : 'var(--down)';
  return <svg className="chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Price history">
    <defs><linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity="0.28" /><stop offset="100%" stopColor={color} stopOpacity="0" /></linearGradient></defs>
    <path d={area} fill={`url(#${gradient})`} /><path d={line} fill="none" stroke={color} strokeWidth="1.5" />
  </svg>;
}
