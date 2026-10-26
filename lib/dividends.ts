// Dividends: income received (gross, withholding tax, net), forward income from
// current holdings, and upcoming ex-dividend / earnings dates.
//
// Withholding: IBKR statements record the tax actually withheld (used as-is).
// Otherwise a per-market rate is assumed. Defaults are for a Singapore tax
// resident (no US treaty, so US dividends lose 30%); change them with the
// WHT command, e.g. `WHT US 15` if you hold a W-8BEN treaty rate.
import { getFxRate, getQuotes, getQuoteDetails, getDividendHistory, type QuoteDetails, type DividendPayment } from './market.ts';
import { loadPortfolio, savePortfolio, viewPositions, viewDividends, withLock } from './store.ts';
import type { StoredPortfolio } from './model.ts';
import type { DividendsReport, DividendTotals, ForwardDividend, ReceivedDividend, EventItem, EventsResponse } from '../shared/types.ts';

/** A dividend as dividendNet reads it (stored, or a forward estimate). */
export interface DividendLike { symbol: string; amount: unknown; tax?: unknown }
export interface DividendNet { gross: number; tax: number; net: number; rate: number; actual: boolean }

const DAY_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_WHT: Record<string, number> = { US: 30, SG: 0, HK: 0, UK: 0, EU: 15, JP: 15.315, AU: 0, CA: 25, OTHER: 0 };
const SUFFIX_MARKET: Record<string, string> = {
  SI: 'SG', HK: 'HK', L: 'UK', DE: 'EU', PA: 'EU', AS: 'EU', MI: 'EU', MC: 'EU', SW: 'EU', BR: 'EU',
  T: 'JP', AX: 'AU', TO: 'CA', V: 'CA',
};
export function marketOf(symbol: unknown): string {
  const m = String(symbol || '').toUpperCase().match(/\.([A-Z]+)$/);
  if (!m) return 'US';
  return SUFFIX_MARKET[m[1]!] || 'OTHER';
}
export function whtRates(settings: StoredPortfolio['settings'] | null | undefined): Record<string, number> {
  return { ...DEFAULT_WHT, ...((settings && settings.withholding) || {}) };
}
// { gross, tax, net, rate, actual } in the dividend's own currency.
export function dividendNet(d: DividendLike, settings?: StoredPortfolio['settings'] | null): DividendNet {
  const gross = Number(d.amount) || 0;
  if (d.tax != null && Number.isFinite(Number(d.tax))) {
    const tax = Math.abs(Number(d.tax));
    return { gross, tax, net: gross - tax, rate: gross ? (tax / gross) * 100 : 0, actual: true };
  }
  const rate = whtRates(settings)[marketOf(d.symbol)] ?? 0;
  const tax = gross * rate / 100;
  return { gross, tax, net: gross - tax, rate, actual: false };
}

export function setWithholding(market: unknown, pct: unknown): Promise<Record<string, number>> {
  const mkt = String(market || '').toUpperCase();
  if (!(mkt in DEFAULT_WHT)) throw new Error(`Market must be one of ${Object.keys(DEFAULT_WHT).join(', ')}`);
  const v = Number(pct);
  if (!(v >= 0 && v <= 100)) throw new Error('Rate must be 0–100 (%)');
  return withLock(() => {
    const p = loadPortfolio();
    p.settings.withholding = { ...(p.settings.withholding || {}), [mkt]: v };
    savePortfolio(p);
    return whtRates(p.settings);
  });
}

// Estimated next ex-date from the payment cadence (median gap of recent ex-dates).
export function estimateNextEx(history: DividendPayment[] | null | undefined, now = Date.now()): { t: number; amount: number; gapDays: number } | null {
  if (!history || history.length < 2) return null;
  const recent = history.slice(-6);
  const gaps = recent.slice(1).map((d, i) => d.t - recent[i]!.t).sort((a, b) => a - b);
  const gap = gaps[Math.floor(gaps.length / 2)]!;
  if (!(gap > 20 * DAY_MS)) return null;
  const last = recent[recent.length - 1]!;
  if (now - last.t > 2 * gap + 30 * DAY_MS) return null; // looks like it stopped paying
  let next = last.t + gap;
  while (next < now - DAY_MS) next += gap;
  return { t: next, amount: last.amount, gapDays: Math.round(gap / DAY_MS) };
}
export function trailingPerShare(history: DividendPayment[] | null | undefined, now = Date.now()): number {
  return (history || []).filter((d) => d.t > now - 365 * DAY_MS).reduce((s, d) => s + d.amount, 0);
}

export async function dividendsReport(baseIn: string | null | undefined, accountId?: string): Promise<DividendsReport> {
  const base = (baseIn || 'SGD').toUpperCase();
  const p = loadPortfolio();
  const settings = p.settings;
  const divs = viewDividends(p, accountId);
  const positions = viewPositions(p, accountId);
  const fx: Record<string, number> = {};
  const rate = async (cIn: string | null | undefined): Promise<number> => {
    const c = (cIn || 'USD').toUpperCase();
    if (fx[c] == null) { try { fx[c] = await getFxRate(c, base); } catch { fx[c] = 1; } }
    return fx[c]!;
  };

  // ---- received ----
  const yearAgo = Date.now() - 365 * DAY_MS;
  const sum = (): DividendTotals => ({ gross: 0, tax: 0, net: 0 });
  const total = sum(), ttm = sum(), bySym: Record<string, DividendTotals & { symbol: string }> = {};
  const recent: ReceivedDividend[] = [];
  for (const d of divs) {
    const k = await rate(d.currency);
    const n = dividendNet(d, settings);
    const g = n.gross * k, t = n.tax * k, net = n.net * k;
    total.gross += g; total.tax += t; total.net += net;
    const ms = Date.parse(d.date);
    if (Number.isFinite(ms) && ms >= yearAgo) { ttm.gross += g; ttm.tax += t; ttm.net += net; }
    const s = bySym[d.symbol] || (bySym[d.symbol] = { symbol: d.symbol, ...sum() });
    s.gross += g; s.tax += t; s.net += net;
    recent.push({ ...d, baseAmount: g, baseTax: t, baseNet: net, whtRate: n.rate, whtActual: n.actual });
  }
  recent.sort((a, b) => (a.date < b.date ? 1 : -1));

  // ---- forward income from current holdings ----
  const syms = positions.map((x) => x.symbol);
  let details: Record<string, QuoteDetails> = {};
  try { details = await getQuoteDetails(syms); } catch {}
  const quotes = syms.length ? await getQuotes(syms) : [];
  const qmap = Object.fromEntries(quotes.map((q) => [q.symbol.toUpperCase(), q]));
  const hist = await Promise.all(syms.map((s) => getDividendHistory(s).catch((): DividendPayment[] => [])));
  const fwdTotal = sum();
  const forward: ForwardDividend[] = [];
  for (let i = 0; i < positions.length; i++) {
    const pos = positions[i]!;
    const S = pos.symbol.toUpperCase();
    const det: Partial<QuoteDetails> = details[S] || {};
    const trailing = trailingPerShare(hist[i]);
    const perShare = det.dividendRate ?? (trailing || null); // forward rate if Yahoo has it, else last 12 months
    if (!perShare) continue;
    const ccy = ((qmap[S] as { currency?: string } | undefined)?.currency || pos.currency || 'USD').toUpperCase();
    const k = await rate(ccy);
    const n = dividendNet({ symbol: S, amount: perShare * pos.quantity }, settings);
    const price = (qmap[S] as { price?: number | null } | undefined)?.price; // absent on a failed quote
    const est = estimateNextEx(hist[i]);
    const exKnown = det.exDividendDate && det.exDividendDate > Date.now() - DAY_MS ? det.exDividendDate : null;
    forward.push({
      symbol: pos.symbol, currency: ccy, perShare, source: det.dividendRate != null ? 'forward' : 'trailing',
      annualGross: n.gross * k, annualTax: n.tax * k, annualNet: n.net * k, whtRate: n.rate,
      yieldOnCost: pos.avgCost ? (perShare / pos.avgCost) * 100 : null,
      currentYield: price ? (perShare / price) * 100 : null,
      nextEx: exKnown || est?.t || null, nextExEstimated: !exKnown && !!est,
      nextPay: det.dividendDate && det.dividendDate > Date.now() - DAY_MS ? det.dividendDate : null,
    });
    fwdTotal.gross += n.gross * k; fwdTotal.tax += n.tax * k; fwdTotal.net += n.net * k;
  }
  forward.sort((a, b) => b.annualNet - a.annualNet);

  return {
    base, account: accountId || p.activeId, count: divs.length,
    total: total.gross, ttm: ttm.gross, // kept for older clients
    received: { total, ttm }, bySymbol: Object.values(bySym).sort((a, b) => b.gross - a.gross), recent: recent.slice(0, 15),
    forward, forwardTotal: fwdTotal, withholding: whtRates(settings),
  };
}

// Upcoming earnings and ex-dividend dates for holdings + watchlist (next 60 days).
export async function upcomingEvents(accountId?: string): Promise<EventsResponse> {
  const p = loadPortfolio();
  const held = new Set(viewPositions(p, accountId).map((x) => x.symbol.toUpperCase()));
  const syms = [...new Set([...held, ...p.watchlist.map((s) => s.toUpperCase())])]
    .filter((s) => !/[=^]/.test(s) && !/-USD$/.test(s)); // skip FX, indices, crypto
  if (!syms.length) return { events: [], ok: true };
  let details: Record<string, QuoteDetails> = {}, ok = true;
  try { details = await getQuoteDetails(syms); } catch { ok = false; }
  const now = Date.now(), horizon = now + 60 * DAY_MS;
  const events: EventItem[] = [];
  const hist = await Promise.all(syms.map((s) => getDividendHistory(s).catch((): DividendPayment[] => [])));
  syms.forEach((s, i) => {
    const d: Partial<QuoteDetails> = details[s] || {};
    if (d.earningsStart && d.earningsStart > now - DAY_MS && d.earningsStart < horizon) {
      events.push({ symbol: s, kind: 'EARNINGS', t: d.earningsStart, estimated: !!d.earningsEstimated, held: held.has(s) });
    }
    const exKnown = d.exDividendDate && d.exDividendDate > now - DAY_MS ? d.exDividendDate : null;
    const est = exKnown ? null : estimateNextEx(hist[i], now);
    const ex = exKnown || est?.t;
    if (ex && ex < horizon) {
      events.push({ symbol: s, kind: 'EX-DIV', t: ex, estimated: !exKnown, amount: est?.amount ?? null, held: held.has(s) });
    }
  });
  events.sort((a, b) => a.t - b.t);
  return { events, ok };
}
