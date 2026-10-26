// The start screen's briefing (KESTRELUI-002): today's portfolio move, the top
// mover and the next event, read from FinSight's own data (no model call), and
// the colour-coded questions built from them.
import type { CalendarResponse, EventItem, History, Portfolio } from '../../../../shared/types.ts';
import type { PageContext } from './labels.ts';

export type Kind = 'portfolio' | 'event' | 'macro' | 'table' | 'strategy';
export interface Ask { kind: Kind; text: string }
export interface Mover { symbol: string; pct: number }
export interface NextEvent { label: string; t: number; timed: boolean; ask: string }
export interface Brief { dayPct: number | null; dayPnl: number | null; base: string; mover: Mover | null; next: NextEvent | null; holdings: number }

const MIN = 6e4, DAY = 864e5;

// NYSE regular hours (9:30–16:00 New York, Mon–Fri). Exchange holidays are not known here.
export function usMarket(now: number): { open: boolean; label: string } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' })
    .formatToParts(new Date(now)).map((p) => [p.type, p.value]));
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday!);
  const mins = Number(parts.hour) * 60 + Number(parts.minute);
  const weekday = (d: number) => d >= 1 && d <= 5;
  if (weekday(day) && mins >= 570 && mins < 960) return { open: true, label: `US open · closes in ${span(960 - mins)}` };
  let wait = weekday(day) && mins < 570 ? 570 - mins : 1440 - mins + 570, d = (day + 1) % 7;
  if (!(weekday(day) && mins < 570)) while (!weekday(d)) { wait += 1440; d = (d + 1) % 7; }
  return { open: false, label: `US closed · opens in ${span(wait)}` };
}
const span = (mins: number) => (mins < 60 ? `${mins}m` : mins < 48 * 60 ? `${Math.round(mins / 60)}h` : `${Math.round(mins / 1440)}d`);

export function greeting(now: number): string {
  const h = new Date(now).getHours();
  return h < 5 ? 'Good evening' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

// Company events carry a date only; the FOMC decision has a time.
export function eventTime(t: number, now: number, timed = true): string {
  const d = new Date(t), today = new Date(now); today.setHours(0, 0, 0, 0);
  const days = Math.floor((t - today.getTime()) / DAY);
  const hm = timed ? ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false }) : '';
  if (days <= 0) return `today${hm}`;
  if (days === 1) return `tomorrow${hm}`;
  return days < 7 ? d.toLocaleDateString(undefined, { weekday: 'short' }) + hm : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function brief(p: Portfolio | undefined, events: EventItem[] | undefined, cal: CalendarResponse | undefined, now: number): Brief {
  const quoted = (p?.positions || []).filter((x) => x.quoted && x.changePct != null && Number.isFinite(x.changePct));
  const top = quoted.reduce<typeof quoted[number] | null>((a, x) => (!a || Math.abs(x.changePct!) > Math.abs(a.changePct!) ? x : a), null);
  const nexts: NextEvent[] = [];
  const fomc = cal?.nextFomc;
  if (fomc && fomc.decisionMs > now - 30 * MIN) nexts.push({ label: 'FOMC decision', t: fomc.decisionMs, timed: true, ask: 'What does the FOMC decision mean for my holdings?' });
  for (const e of events || []) {
    if (!e.held || e.t < now - DAY) continue;
    nexts.push(e.kind === 'EARNINGS'
      ? { label: `${e.symbol} earnings`, t: e.t, timed: false, ask: `What should I watch in ${e.symbol} earnings?` }
      : { label: `${e.symbol} ex-dividend`, t: e.t, timed: false, ask: `What will the ${e.symbol} dividend pay me?` });
  }
  nexts.sort((a, b) => a.t - b.t);
  const hasDay = !!p && quoted.length > 0;
  return {
    dayPct: hasDay ? p!.summary.dayPct : null, dayPnl: hasDay ? p!.summary.dayPnl : null, base: p?.base || '',
    mover: top ? { symbol: top.symbol, pct: top.changePct! } : null, next: nexts[0] || null, holdings: p?.positions.length || 0,
  };
}

export const pctText = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(Math.abs(n) >= 10 ? 1 : 2)}%`;

// Four questions, one per colour: portfolio (green), event (red), macro or table (blue), strategy (violet).
export function asks(b: Brief, c: PageContext, views: boolean): Ask[] {
  return [
    { kind: 'portfolio', text: b.mover && Math.abs(b.mover.pct) >= 0.5 ? `Why did ${b.mover.symbol} move ${pctText(b.mover.pct)} today?`
      : 'How is my portfolio doing today, and what moved it?' },
    { kind: 'event', text: b.next?.ask || 'What earnings or dividends are coming up for my holdings?' },
    // A model that can draw views offers the table starter in place of the exposure question.
    views ? { kind: 'table', text: 'Show my holdings as a table' } : { kind: 'macro', text: 'What is my currency and sector exposure?' },
    { kind: 'strategy', text: c.symbol ? `What do my strategies say about ${c.symbol} right now?` : '/strategy-scan any live setups in my holdings?' },
  ];
}

// ---- intraday lines for the briefing charts ----
export type Bars = Record<string, History | { error: string }>;
const pointsOf = (h: Bars[string] | undefined) => (h && 'points' in h ? h.points.filter((x) => Number.isFinite(x.c)) : []);
export const symbolLine = (bars: Bars | undefined, symbol: string) => pointsOf(bars?.[symbol.toUpperCase()]).map((x) => x.c);
export const prevClose = (bars: Bars | undefined, symbol: string) => { const h = bars?.[symbol.toUpperCase()]; return h && 'meta' in h ? h.meta?.prevClose ?? null : null; };

// Holdings value in the base currency over today's bars: every symbol's last
// known price is carried forward (markets open at different times) and a symbol
// counts at its first bar before it has traded.
export function portfolioLine(positions: Portfolio['positions'], bars: Bars | undefined): number[] {
  const series = positions.filter((p) => p.quoted).map((p) => ({ k: p.quantity * p.fxRate, pts: pointsOf(bars?.[p.symbol.toUpperCase()]) })).filter((x) => x.pts.length);
  const times = [...new Set(series.flatMap((x) => x.pts.map((p) => p.t)))].sort((a, b) => a - b);
  const at = series.map(() => 0);
  return times.map((t) => series.reduce((sum, x, i) => {
    while (at[i]! + 1 < x.pts.length && x.pts[at[i]! + 1]!.t <= t) at[i]!++;
    return sum + x.k * x.pts[at[i]!]!.c;
  }, 0));
}
