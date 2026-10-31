// Discover (FEAT-010, first slice): movers and upcoming earnings among the
// symbols you hold (in the account in view) or watch. This is NOT a
// market-wide ranking; the response says so and lists every symbol it left out.
//
// Basis: Yahoo Finance regular-session price against the previous regular
// close, as normalizeQuote computes it (pre/post-market is not included).
// Each symbol is measured on its own exchange's latest session, so a mixed
// US/SG/HK list can compare different days; asOf is per row.
import { getQuotes } from './market.ts';
import { marketOf, upcomingEvents } from './dividends.ts';
import { loadPortfolio, viewPositions } from './store.ts';
import type { DiscoverEarning, DiscoverExcluded, DiscoverMover, DiscoverResponse, EventItem, Quote } from '../shared/types.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
// Older than this, a quote is flagged stale: covers a weekend plus a holiday.
export const STALE_MS = 4 * DAY_MS;
export const MAX_SYMBOLS = 200;
export const EARNINGS_DAYS = 60;

// Indices, FX, futures and crypto trade on different sessions or have no
// comparable daily close, so they are left out of the ranking (and listed).
export function exclusionReason(symbol: string): DiscoverExcluded['reason'] | null {
  if (symbol.startsWith('^')) return 'index';
  if (/=X$/.test(symbol)) return 'fx';
  if (/=F$/.test(symbol)) return 'futures';
  if (/-(USD|USDT|EUR|SGD)$/.test(symbol)) return 'crypto';
  return null;
}

// IANA zone of the symbol's exchange, from its suffix (dividends.ts marketOf).
const MARKET_TZ: Record<string, string> = {
  US: 'America/New_York', SG: 'Asia/Singapore', HK: 'Asia/Hong_Kong', UK: 'Europe/London', EU: 'Europe/Berlin',
  JP: 'Asia/Tokyo', AU: 'Australia/Sydney', CA: 'America/Toronto', OTHER: 'UTC',
};
export const marketTz = (symbol: string) => MARKET_TZ[marketOf(symbol)] || 'UTC';
// Calendar date (YYYY-MM-DD) of t in a zone.
export function localDay(t: number, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(t);
}
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / DAY_MS);

export interface Member { symbol: string; held: boolean; watched: boolean }

// Holdings first, then watchlist; upper-cased and de-duplicated.
export function universe(held: string[], watched: string[]): Member[] {
  const H = new Set(held.map((s) => s.toUpperCase())), W = new Set(watched.map((s) => s.toUpperCase()));
  return [...new Set([...H, ...W])].map((symbol) => ({ symbol, held: H.has(symbol), watched: W.has(symbol) }));
}

// Deterministic ranking. Gainers: change % descending; losers: ascending;
// ties by symbol. A zero change is counted as unchanged; a quote without a
// price or previous close is excluded with its reason.
export function rankMovers(members: Member[], quotes: Quote[], now: number) {
  const bySym = new Map(quotes.map((q) => [q.symbol.toUpperCase(), q]));
  const rows: DiscoverMover[] = [], excluded: DiscoverExcluded[] = [];
  let unchanged = 0;
  for (const m of members) {
    const q = bySym.get(m.symbol);
    if (!q || 'error' in q && q.error) { excluded.push({ symbol: m.symbol, reason: 'no-quote', detail: q && 'error' in q ? String(q.error).slice(0, 120) : undefined }); continue; }
    if (!('changePct' in q) || q.changePct == null || !Number.isFinite(q.changePct) || q.price == null) { excluded.push({ symbol: m.symbol, reason: 'no-change' }); continue; }
    if (q.changePct === 0) { unchanged++; continue; }
    const fallback = q.cache?.status === 'stale-fallback';
    const old = q.marketTime == null || now - q.marketTime > STALE_MS;
    rows.push({
      symbol: m.symbol, name: q.name, exchange: q.exchange, currency: q.currency,
      price: q.price, prevClose: q.prevClose ?? null, change: q.change, changePct: q.changePct,
      marketTime: q.marketTime, held: m.held, watched: m.watched,
      stale: fallback || old, staleReason: fallback ? 'cached-after-failure' : old ? 'old-session' : null,
    });
  }
  const bySymbol = (a: DiscoverMover, b: DiscoverMover) => (a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0);
  const gainers = rows.filter((r) => r.changePct > 0).sort((a, b) => b.changePct - a.changePct || bySymbol(a, b));
  const losers = rows.filter((r) => r.changePct < 0).sort((a, b) => a.changePct - b.changePct || bySymbol(a, b));
  return { gainers, losers, unchanged, excluded };
}

// Earnings within the horizon, with the exchange-local date and days away.
export function earningsRows(events: EventItem[], members: Member[], now: number): DiscoverEarning[] {
  const watched = new Set(members.filter((m) => m.watched).map((m) => m.symbol));
  return events.filter((e) => e.kind === 'EARNINGS').map((e) => {
    const tz = marketTz(e.symbol), day = localDay(e.t, tz);
    return { symbol: e.symbol, t: e.t, day, tz, inDays: daysBetween(localDay(now, tz), day), estimated: e.estimated, held: e.held, watched: watched.has(e.symbol) };
  }).filter((e) => e.inDays >= 0 && e.inDays <= EARNINGS_DAYS)
    .sort((a, b) => a.t - b.t || (a.symbol < b.symbol ? -1 : 1));
}

export async function discover(accountId?: string, now = Date.now()): Promise<DiscoverResponse> {
  const p = loadPortfolio();
  const all = universe(viewPositions(p, accountId).map((x) => x.symbol), p.watchlist || []);
  const members: Member[] = [], excluded: DiscoverExcluded[] = [];
  for (const m of all) {
    const reason = exclusionReason(m.symbol);
    if (reason) excluded.push({ symbol: m.symbol, reason });
    else if (members.length >= MAX_SYMBOLS) excluded.push({ symbol: m.symbol, reason: 'limit' });
    else members.push(m);
  }
  const [quotes, events] = await Promise.all([
    members.length ? getQuotes(members.map((m) => m.symbol)) : Promise.resolve([] as Quote[]),
    upcomingEvents(accountId).catch(() => ({ events: [] as EventItem[], ok: false })),
  ]);
  const ranked = rankMovers(members, quotes, now);
  const times = [...ranked.gainers, ...ranked.losers].map((r) => r.marketTime).filter((t): t is number => t != null);
  return {
    scope: {
      account: accountId || p.activeId,
      held: all.filter((m) => m.held).length, watched: all.filter((m) => m.watched).length,
      eligible: members.length, ranked: ranked.gainers.length + ranked.losers.length, unchanged: ranked.unchanged,
    },
    basis: { source: 'Yahoo Finance', session: 'regular', baseline: 'previous-close', delayed: true },
    asOf: times.length ? Math.max(...times) : null,
    retrievedAt: now,
    gainers: ranked.gainers, losers: ranked.losers,
    excluded: [...excluded, ...ranked.excluded],
    earnings: { ok: events.ok, horizonDays: EARNINGS_DAYS, items: earningsRows(events.events, members, now) },
  };
}
