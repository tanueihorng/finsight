// One validated dataset for a backtest. The JavaScript engines and the Python
// replay both consume these exact bars, so they cannot disagree about the data.
import crypto from 'node:crypto';

export type RawPoint = { t: number; c?: number | null; o?: number | null; h?: number | null; l?: number | null; v?: number | null; adj?: number | null };
export type Bar = { t: number; date: string; o: number; h: number; l: number; c: number; v: number; adj: number | null };

const SESSION_DONE_MINUTES = 16 * 60 + 15; // 15 minutes after the 16:00 New York close
const JUMP_LIMIT = 0.5;
const GAP_DAYS = 7;
const WARMUP_DAYS = 400;

const newYork = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
function nyParts(ms: number) {
  const p = Object.fromEntries(newYork.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

const positive = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x > 0;
const daysBetween = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 864e5;

/** Drops unusable and in-progress bars, and reports anything that looks wrong. */
export function cleanSeries(symbol: string, points: RawPoint[], now: number): { bars: Bar[]; warnings: string[] } {
  const warnings: string[] = [];
  const clock = nyParts(now);
  const byDate = new Map<string, Bar>();
  let invalid = 0;
  for (const p of points) {
    if (!(positive(p.o) && positive(p.h) && positive(p.l) && positive(p.c))) { invalid++; continue; }
    const session = nyParts(p.t).date;
    if (session > clock.date || (session === clock.date && clock.minutes < SESSION_DONE_MINUTES)) continue;
    byDate.set(session, { t: p.t, date: session, o: p.o, h: p.h, l: p.l, c: p.c, v: typeof p.v === 'number' && p.v > 0 ? p.v : 0, adj: positive(p.adj) ? p.adj : null });
  }
  const bars = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  if (invalid) warnings.push(`${symbol}: dropped ${invalid} bars with missing or non-positive prices.`);
  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1]!, bar = bars[i]!;
    if (Math.abs(bar.c / prev.c - 1) > JUMP_LIMIT) warnings.push(`${symbol}: close moved more than 50% on ${bar.date}; check for a bad tick or an unadjusted split.`);
    if (daysBetween(prev.date, bar.date) > GAP_DAYS) warnings.push(`${symbol}: no bars between ${prev.date} and ${bar.date}.`);
  }
  return { bars, warnings };
}

/** Trading days in the window: every date any series has, from the first benchmark day on or after the start. */
export function buildCalendar(years: number, benchmark: Bar[], series: Bar[][]): string[] {
  const end = benchmark[benchmark.length - 1]!.date;
  const target = new Date(`${end}T00:00:00Z`);
  target.setUTCFullYear(target.getUTCFullYear() - years);
  const start = benchmark.find((b) => b.date >= target.toISOString().slice(0, 10))!.date;
  const dates = new Set<string>();
  for (const rows of [benchmark, ...series]) for (const b of rows) if (b.date >= start && b.date <= end) dates.add(b.date);
  return [...dates].sort();
}

/** Report a materially shortened benchmark window, allowing for weekends and holidays. */
export function benchmarkWindowWarning(years: number, benchmark: Bar[]): string | null {
  const end = benchmark[benchmark.length - 1]!.date;
  const target = new Date(`${end}T00:00:00Z`);
  target.setUTCFullYear(target.getUTCFullYear() - years);
  const requestedStart = target.toISOString().slice(0, 10);
  const actualStart = benchmark[0]!.date;
  return daysBetween(requestedStart, actualStart) > GAP_DAYS
    ? `Benchmark history starts ${actualStart}, after requested ${requestedStart}; the ${years}-year window is shortened.`
    : null;
}

export function warmupWarning(symbol: string, bars: Bar[], windowStart: string): string | null {
  const first = bars[0]!.date;
  return daysBetween(first, windowStart) < WARMUP_DAYS ? `${symbol}: history starts ${first}, so the strategy has no signals for part of the test window.` : null;
}

export function fingerprint(series: Record<string, Bar[]>): string {
  const ordered = Object.keys(series).sort().map((s) => [s, series[s]]);
  return crypto.createHash('sha256').update(JSON.stringify(ordered)).digest('hex');
}
