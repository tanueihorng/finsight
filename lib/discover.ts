// Discover (FEAT-010, first slice): movers and upcoming earnings among the
// symbols you hold (in the account in view) or watch. This is NOT a
// market-wide ranking; the response says so and lists every symbol it left out.
//
// Basis: Yahoo Finance regular-session price against the previous regular
// close, as normalizeQuote computes it (pre/post-market is not included).
// Each symbol is measured on its own exchange's latest session, so a mixed
// US/SG/HK list can compare different days; asOf is per row.
//
// Market-wide sections (US only, key-less, unofficial public endpoints):
//   market — Yahoo's predefined Day Gainers / Day Losers screens, Yahoo's criteria.
//   ipos   — Nasdaq's IPO calendar (previous, current and next US Eastern month).
// Each is cached on its own and fails on its own; the response says which.
import { cachedWithStatus } from './cache.ts';
import { fetchJson, getQuotes, getScreen, type ScreenerQuote } from './market.ts';
import { marketOf, upcomingEvents } from './dividends.ts';
import { loadPortfolio, viewPositions } from './store.ts';
import type { DiscoverEarning, DiscoverExcluded, DiscoverIpos, DiscoverMarket, DiscoverMover, DiscoverResponse, EventItem, IpoDeal, MarketMover, Quote } from '../shared/types.ts';

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

// ---- market-wide US movers (Yahoo screener) ---------------------------------
export const MARKET_ROWS = 25;
const fin = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
// Equities only, with a price and a change of the list's sign; sorted like
// rankMovers (the screen's own order is not relied on).
export function screenRows(quotes: ScreenerQuote[], side: 'gainers' | 'losers', members: Member[]): MarketMover[] {
  const H = new Set(members.filter((m) => m.held).map((m) => m.symbol)), W = new Set(members.filter((m) => m.watched).map((m) => m.symbol));
  const seen = new Set<string>(), rows: MarketMover[] = [];
  for (const q of quotes) {
    const symbol = String(q.symbol || '').toUpperCase(), price = fin(q.regularMarketPrice), changePct = fin(q.regularMarketChangePercent);
    if (!symbol || seen.has(symbol) || (q.quoteType && q.quoteType !== 'EQUITY') || price == null || changePct == null) continue;
    if (side === 'gainers' ? !(changePct > 0) : !(changePct < 0)) continue;
    seen.add(symbol);
    const t = fin(q.regularMarketTime);
    rows.push({
      symbol, name: q.longName || q.shortName || symbol, exchange: q.fullExchangeName || q.exchange || '', currency: q.currency || 'USD',
      price, prevClose: fin(q.regularMarketPreviousClose), changePct, marketTime: t == null ? null : t * 1000,
      marketCap: fin(q.marketCap), volume: fin(q.regularMarketVolume), avgVolume3m: fin(q.averageDailyVolume3Month),
      held: H.has(symbol), watched: W.has(symbol),
    });
  }
  const by = (a: MarketMover, b: MarketMover) => (a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0);
  rows.sort(side === 'gainers' ? (a, b) => b.changePct - a.changePct || by(a, b) : (a, b) => a.changePct - b.changePct || by(a, b));
  return rows.slice(0, MARKET_ROWS);
}

export async function marketMovers(members: Member[]): Promise<DiscoverMarket> {
  const [g, l] = await Promise.allSettled([getScreen('day_gainers'), getScreen('day_losers')]);
  const errs = [g, l].filter((r): r is PromiseRejectedResult => r.status === 'rejected').map((r) => String(r.reason?.message || r.reason).slice(0, 160));
  const ok = (r: typeof g) => (r.status === 'fulfilled' ? r.value : null);
  const G = ok(g), L = ok(l);
  const gainers = G ? screenRows(G.value.quotes, 'gainers', members) : [], losers = L ? screenRows(L.value.quotes, 'losers', members) : [];
  const times = [...gainers, ...losers].map((r) => r.marketTime).filter((t): t is number => t != null);
  const cachedAts = [G, L].filter(Boolean).map((x) => x!.cache.cachedAt).sort();
  return {
    ok: !errs.length, source: 'Yahoo Finance screener', region: 'US', session: 'regular', delayed: true,
    criteria: "Yahoo's predefined Day Gainers and Day Losers screens: US-listed equities filtered by Yahoo's own criteria (not every listed stock).",
    asOf: times.length ? Math.max(...times) : null, cachedAt: cachedAts[0] ?? null,
    stale: [G, L].some((x) => x?.cache.status === 'stale-fallback'), error: errs.length ? errs.join('; ') : null,
    gainers, losers, totals: { gainers: G ? G.value.total : null, losers: L ? L.value.total : null },
  };
}

// ---- US IPO calendar (Nasdaq) ------------------------------------------------
export const PRICED_DAYS = 14;
const ET = 'America/New_York';
// 'MM/DD/YYYY' -> 'YYYY-MM-DD' (null if not a real date).
export function usDate(v: unknown): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(v ?? '').trim());
  if (!m) return null;
  const iso = `${m[3]}-${m[1]!.padStart(2, '0')}-${m[2]!.padStart(2, '0')}`;
  const d = new Date(iso + 'T00:00:00Z');
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso ? null : iso;
}
export function amount(v: unknown): number | null {
  const s = String(v ?? '').replace(/[$,\s]/g, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
// '19.00-21.00' -> [19, 21]; '10.00' -> [10, 10].
export function priceRange(v: unknown): [number | null, number | null] {
  const parts = String(v ?? '').split('-').map((x) => amount(x));
  if (parts.length === 1) return [parts[0]!, parts[0]!];
  if (parts.length === 2 && parts[0] != null && parts[1] != null) return [Math.min(parts[0], parts[1]), Math.max(parts[0], parts[1])];
  return [null, null];
}
// Previous, current and next calendar month in US Eastern time, as 'YYYY-MM'
// (the previous month holds deals priced in the last PRICED_DAYS days).
export function ipoMonths(now: number): string[] {
  const [y, m] = localDay(now, ET).split('-').map(Number) as [number, number];
  return [-1, 0, 1].map((k) => {
    const t = new Date(Date.UTC(y, m - 1 + k, 1));
    return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}`;
  });
}

interface NasdaqRow {
  dealID?: string; proposedTickerSymbol?: string | null; companyName?: string; proposedExchange?: string | null;
  proposedSharePrice?: string | null; sharesOffered?: string | null; dollarValueOfSharesOffered?: string | null;
  expectedPriceDate?: string; pricedDate?: string; filedDate?: string; withdrawDate?: string;
}
export interface NasdaqMonth { data?: {
  priced?: { rows?: NasdaqRow[] | null }; upcoming?: { upcomingTable?: { rows?: NasdaqRow[] | null }; lastUpdatedTime?: string };
  filed?: { rows?: NasdaqRow[] | null }; withdrawn?: { rows?: NasdaqRow[] | null };
} | null }

function deal(r: NasdaqRow, status: IpoDeal['status'], date: string | null): IpoDeal | null {
  const company = String(r.companyName || '').trim();
  if (!company) return null;
  const id = String(r.dealID || company);
  const [priceLow, priceHigh] = priceRange(r.proposedSharePrice);
  return {
    id, symbol: r.proposedTickerSymbol ? String(r.proposedTickerSymbol).toUpperCase() : null, company,
    exchange: r.proposedExchange || null, status, date, priceLow, priceHigh,
    shares: amount(r.sharesOffered), offerAmount: amount(r.dollarValueOfSharesOffered),
    url: `https://www.nasdaq.com/market-activity/ipos/overview?dealId=${encodeURIComponent(id)}`,
    secUrl: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=${encodeURIComponent(company)}&type=&dateb=&owner=include&count=40`,
  };
}
// Upcoming: expected on or after today (US Eastern), soonest first; a deal
// without a parseable date sorts last. Priced: within the last PRICED_DAYS
// days, newest first. A deal listed in both months appears once.
export function ipoRows(months: NasdaqMonth[], now: number) {
  const today = localDay(now, ET);
  const up = new Map<string, IpoDeal>(), priced = new Map<string, IpoDeal>(), filed = new Set<string>(), withdrawn = new Set<string>();
  let lastUpdated: string | null = null;
  for (const m of months) {
    const d = m?.data;
    if (!d) continue;
    lastUpdated = lastUpdated || d.upcoming?.lastUpdatedTime?.replace(/\s*-\s*Source:.*$/i, '').replace(/^LAST UPDATED:\s*/i, '').trim() || null;
    for (const r of d.upcoming?.upcomingTable?.rows || []) {
      const date = usDate(r.expectedPriceDate), x = deal(r, 'expected', date);
      if (x && (date == null || date >= today)) up.set(x.id, x);
    }
    for (const r of d.priced?.rows || []) {
      const date = usDate(r.pricedDate), x = deal(r, 'priced', date);
      if (x && date && date <= today && daysBetween(date, today) <= PRICED_DAYS) priced.set(x.id, x);
    }
    for (const r of d.filed?.rows || []) filed.add(String(r.dealID || r.companyName));
    for (const r of d.withdrawn?.rows || []) withdrawn.add(String(r.dealID || r.companyName));
  }
  const name = (a: IpoDeal, b: IpoDeal) => (a.company < b.company ? -1 : a.company > b.company ? 1 : 0);
  const upcoming = [...up.values()].sort((a, b) => (a.date == null ? 1 : 0) - (b.date == null ? 1 : 0) || (a.date! < b.date! ? -1 : a.date! > b.date! ? 1 : 0) || name(a, b));
  const recent = [...priced.values()].sort((a, b) => (a.date! < b.date! ? 1 : a.date! > b.date! ? -1 : 0) || name(a, b));
  return { upcoming, priced: recent, counts: { filed: filed.size, withdrawn: withdrawn.size }, lastUpdated };
}

export async function ipoCalendar(now = Date.now()): Promise<DiscoverIpos> {
  const months = ipoMonths(now);
  const got = await Promise.allSettled(months.map((m) => cachedWithStatus(`ipo:${m}`, 6 * 60 * 60000,
    () => fetchJson<NasdaqMonth>(`https://api.nasdaq.com/api/ipo/calendar?date=${m}`, { timeout: 10000 }), { stale: 3 * 24 * 60 * 60000, persist: true })));
  const errs = got.filter((r): r is PromiseRejectedResult => r.status === 'rejected').map((r) => String(r.reason?.message || r.reason).slice(0, 160));
  const ok = got.filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof cachedWithStatus<NasdaqMonth>>>> => r.status === 'fulfilled').map((r) => r.value);
  const rows = ipoRows(ok.map((x) => x.value), now);
  return {
    ok: !errs.length, source: 'Nasdaq IPO calendar', region: 'US', months, lastUpdated: rows.lastUpdated,
    cachedAt: ok.map((x) => x.cache.cachedAt).sort()[0] ?? null, stale: ok.some((x) => x.cache.status === 'stale-fallback'),
    error: errs.length ? errs.join('; ') : null, upcoming: rows.upcoming, priced: rows.priced, counts: rows.counts,
  };
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
  const [quotes, events, market, ipos] = await Promise.all([
    members.length ? getQuotes(members.map((m) => m.symbol)) : Promise.resolve([] as Quote[]),
    upcomingEvents(accountId).catch(() => ({ events: [] as EventItem[], ok: false })),
    marketMovers(all),
    ipoCalendar(now),
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
    market, ipos,
  };
}
