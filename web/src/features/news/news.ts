// Legacy timeAgo(), evaluated at the last completed news request like app.js.
export function timeAgo(ms: number, now = Date.now()): string {
  const s = (now - ms) / 1000;
  if (s < 3600) return Math.max(1, Math.floor(s / 60)) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}
