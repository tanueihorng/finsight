'use strict';
const { getFxRate, getHistory } = require('./market');
const { loadPortfolio, viewPositions } = require('./store');

// Portfolio value over time = CURRENT holdings priced with historical prices,
// converted to base at today's FX. (A "what are my current holdings worth over
// time" view — it does not replay past buys/sells.)
async function portfolioPerformance(range, base, accountId) {
  base = (base || 'SGD').toUpperCase();
  range = range || '1y';
  const interval = ({ '1mo': '1d', '3mo': '1d', '6mo': '1d', '1y': '1d', '2y': '1wk', '5y': '1wk', max: '1mo' })[range] || '1d';
  const p = loadPortfolio();
  const srcPositions = viewPositions(p, accountId);
  if (!srcPositions.length) return { range, base, points: [], changePct: null };
  const fx = {};
  for (const pos of srcPositions) {
    const c = (pos.currency || 'USD').toUpperCase();
    if (fx[c] == null) { try { fx[c] = await getFxRate(c, base); } catch { fx[c] = 1; } }
  }
  const hist = await Promise.allSettled(srcPositions.map((pos) => getHistory(pos.symbol, range, interval)));
  // Bucket each symbol's closes by calendar day (markets close at different epoch
  // seconds, so align on the day, not the raw timestamp).
  const perSym = [];
  hist.forEach((r, i) => {
    if (r.status !== 'fulfilled') return;
    const pos = srcPositions[i];
    const mult = pos.quantity * (fx[(pos.currency || 'USD').toUpperCase()] ?? 1);
    const byDay = new Map();
    for (const pt of (r.value.points || [])) {
      if (pt.c == null) continue;
      byDay.set(new Date(pt.t).toISOString().slice(0, 10), pt.c); // last close of the day wins
    }
    if (byDay.size) perSym.push({ mult, byDay, firstDay: byDay.keys().next().value });
  });
  if (!perSym.length) return { range, base, points: [], changePct: null };
  // Start only once every position has data, so the total isn't undercounted early.
  const startDay = perSym.reduce((m, s) => (s.firstDay > m ? s.firstDay : m), perSym[0].firstDay);
  const daySet = new Set();
  perSym.forEach((s) => s.byDay.forEach((_, day) => { if (day >= startDay) daySet.add(day); }));
  const days = [...daySet].sort();
  const last = perSym.map(() => null), out = [];
  for (const day of days) {
    let sum = 0, ok = true;
    perSym.forEach((s, si) => {
      if (s.byDay.has(day)) last[si] = s.byDay.get(day);
      if (last[si] == null) ok = false; else sum += last[si] * s.mult;
    });
    if (ok) out.push({ t: Date.parse(day + 'T00:00:00Z'), value: sum });
  }
  const first = out[0]?.value, end = out[out.length - 1]?.value;
  return { range, base, points: out, start: first, end, changePct: (first && end) ? ((end - first) / first) * 100 : null };
}

module.exports = { portfolioPerformance };
