// Instrument-aware evidence plan for the council (COUNCILQUALITY-001 items 2/3).
// Code decides, before any specialist call, which read-only evidence each
// subject needs and records what happened to every item: retrieved, failed,
// not applicable or unavailable. Specialists then reason from a known packet
// instead of a lone quote, and gaps keep their real cause.
import type { CouncilEvidence } from './council.ts';

export type SubjectKind = 'equity' | 'fund' | 'other';
export type Subject = { symbol: string; type?: string | null };
export type PlanItem = { key: string; purpose: string; tool: string; args: Record<string, unknown>; roles: string[]; subject?: string };
// detail: what a retrieved item actually used, e.g. the filing form (8-K or 6-K).
export type Coverage = Omit<PlanItem, 'args'> & { status: 'retrieved' | 'failed' | 'not_applicable' | 'unavailable' | 'skipped_limit'; evidenceId?: string; reason?: string; detail?: string };

// Three equities need 5 items each plus 6 shared ones.
export const PLAN_LIMITS = { subjects: 3, items: 22, concurrency: 3 } as const;

export function subjectKind(type: string | null | undefined): SubjectKind {
  const t = String(type || '').toUpperCase();
  if (/ETF|MUTUAL|FUND/.test(t)) return 'fund';
  if (/EQUITY|STOCK|SHARE/.test(t)) return 'equity';
  return 'other';
}
// SEC EDGAR covers US registrants. A ticker with an exchange suffix such as
// D05.SI or 7203.T is not one; class shares such as BRK.B still are.
export const secTicker = (symbol: string) => /^[A-Za-z]{1,6}(?:[.-][A-Ba-b])?$/.test(symbol);

const yearAgo = (now: number) => new Date(now - 366 * 864e5).toISOString().slice(0, 10);

/** Planned retrievals plus items known in advance to be inapplicable or unavailable. */
export function planEvidence(subjects: Subject[], now = Date.now(), scope: { account?: string } = {}): { items: PlanItem[]; coverage: Coverage[] } {
  const items: PlanItem[] = [], coverage: Coverage[] = [];
  const add = (item: PlanItem) => { if (items.length < PLAN_LIMITS.items) items.push(item); else coverage.push({ ...strip(item), status: 'skipped_limit', reason: `Evidence plan limit of ${PLAN_LIMITS.items} items` }); };
  const kept = subjects.slice(0, PLAN_LIMITS.subjects);
  for (const s of subjects.slice(PLAN_LIMITS.subjects)) coverage.push({ key: `subject:${s.symbol}`, purpose: 'Subject research', tool: 'none', roles: [], subject: s.symbol, status: 'skipped_limit', reason: `Only the first ${PLAN_LIMITS.subjects} subjects are researched in one review` });
  for (const s of kept) {
    const kind = subjectKind(s.type), sym = s.symbol;
    add({ key: `history:${sym}`, purpose: 'One-year daily price path, price return, drawdown and distance from range (price only, not total return)', tool: 'get_history', args: { symbol: sym, range: '1y', interval: '1d' }, roles: ['growth', 'macro', 'risk'], subject: sym });
    if (kind === 'fund') {
      add({ key: `fund:${sym}`, purpose: 'Fund family, category, expense ratio, asset mix, top holdings and sector weights', tool: 'get_fund_profile', args: { symbol: sym }, roles: ['growth', 'macro', 'risk'], subject: sym });
      coverage.push({ key: `issuer:${sym}`, purpose: 'Issuer prospectus or factsheet (dated holdings, replication, domicile, benchmark, tracking)', tool: 'none', roles: ['growth', 'macro', 'risk'], subject: sym, status: 'unavailable', reason: 'No approved issuer-document source is configured; the fund profile above is an aggregator view' });
    } else if (kind === 'equity' || kind === 'other') {
      if (secTicker(sym)) {
        add({ key: `financials:${sym}`, purpose: 'Reported revenue, operating income, net income and diluted EPS (SEC XBRL: 10-K/10-Q, or 20-F for a foreign private issuer)', tool: 'edgar_financials', args: { ticker: sym }, roles: ['growth', 'macro'], subject: sym });
        add({ key: `valuation:${sym}`, purpose: 'Trailing P/E, earnings yield, price-to-sales and market cap computed from SEC data and the live price (ADR ratio applied, or refused when unknown)', tool: 'valuation_metrics', args: { ticker: sym }, roles: ['growth', 'macro', 'risk'], subject: sym });
        // The latest results release is not necessarily among the latest
        // current reports. The tool picks 8-K item 2.02, or for a foreign
        // private issuer the latest 6-K results release, and names the form.
        add({ key: `earnings8k:${sym}`, purpose: 'Latest earnings release (8-K item 2.02, or 6-K for a foreign private issuer): results, segments, margins and outlook', tool: 'edgar_recent_8k', args: { ticker: sym, limit: 1, items: ['2.02'], maxChars: 8000 }, roles: ['growth', 'macro'], subject: sym });
        add({ key: `8k:${sym}`, purpose: 'Text of the two most recent current reports (8-K, or 6-K for a foreign private issuer), with the latest 20-F named', tool: 'edgar_recent_8k', args: { ticker: sym, limit: 2 }, roles: ['growth', 'macro'], subject: sym });
      } else {
        coverage.push({ key: `financials:${sym}`, purpose: 'Reported financials', tool: 'edgar_financials', roles: ['growth', 'macro'], subject: sym, status: 'not_applicable', reason: 'Not a US SEC registrant ticker; no approved primary filings source for this listing' });
        coverage.push({ key: `valuation:${sym}`, purpose: 'Trailing valuation multiples', tool: 'valuation_metrics', roles: ['growth', 'macro', 'risk'], subject: sym, status: 'unavailable', reason: 'Valuation is computed from SEC filings; no approved source for this listing' });
      }
    }
  }
  if (kept.length) {
    const equities = kept.filter((s) => subjectKind(s.type) !== 'fund').map((s) => s.symbol);
    if (equities.length) add({ key: 'events:earnings', purpose: 'Scheduled earnings dates and whether each is past or upcoming', tool: 'get_earnings_dates', args: { symbols: equities }, roles: ['growth', 'macro'] });
    add({ key: 'portfolio:weights', purpose: 'Whether the subjects are held and their weights on both bases, all accounts combined', tool: 'portfolio_weights', args: { symbols: kept.map((s) => s.symbol) }, roles: ['risk'] });
    // The account on screen is reported separately, never instead of the total.
    const account = scope.account && scope.account.toUpperCase() !== 'ALL' ? scope.account : null;
    if (account) add({ key: 'portfolio:weights:selected', purpose: 'The same weights for the account selected on screen', tool: 'portfolio_weights', args: { symbols: kept.map((s) => s.symbol), account }, roles: ['risk'] });
    add({ key: 'portfolio:sectors', purpose: 'Sector and instrument-type exposure with members and coverage, all accounts combined', tool: 'get_exposures', args: { by: 'sector' }, roles: ['risk'] });
    add({ key: 'portfolio:policy', purpose: 'Accepted investment policy, if any', tool: 'get_policy', args: {}, roles: ['risk'] });
    add({ key: 'macro:DGS10', purpose: 'US 10-year Treasury yield over the past year (discount-rate context)', tool: 'get_macro_series', args: { series: 'DGS10', start: yearAgo(now) }, roles: ['macro'] });
  }
  return { items, coverage };
}
const strip = ({ args: _args, ...rest }: PlanItem): Omit<PlanItem, 'args'> => rest;
// The filing form a tool actually used, and any metric it refused, so the plan
// says "6-K earnings release filed …" or "ADR ratio unknown" rather than just "retrieved".
function detailOf(content: string): { detail?: string } {
  try {
    const j = JSON.parse(content);
    const parts = [typeof j.formUsed === 'string' ? j.formUsed : '', j.annualReport?.form && j.annualReport?.filed ? `latest ${j.annualReport.form} filed ${j.annualReport.filed}` : '', Array.isArray(j.gaps) && j.gaps.length ? `${j.gaps.length} metric gap${j.gaps.length === 1 ? '' : 's'} (see gaps)` : ''].filter(Boolean);
    return parts.length ? { detail: parts.join('; ').slice(0, 200) } : {};
  } catch { return {}; }
}

/** Run planned items with bounded concurrency. A failure is recorded, never filled in. */
export async function collectEvidence(plan: { items: PlanItem[]; coverage: Coverage[] }, execute: (tool: string, args: unknown) => Promise<CouncilEvidence>, signal: AbortSignal): Promise<{ evidence: CouncilEvidence[]; coverage: Coverage[] }> {
  const evidence: (CouncilEvidence | null)[] = plan.items.map(() => null);
  const done: Coverage[] = plan.items.map((item) => ({ ...strip(item), status: 'failed', reason: 'Not run' }));
  let next = 0;
  const worker = async () => {
    while (next < plan.items.length) {
      const i = next++, item = plan.items[i]!;
      signal.throwIfAborted();
      try { const e = await execute(item.tool, item.args); evidence[i] = { ...e, roles: item.roles }; done[i] = { ...strip(item), status: 'retrieved', evidenceId: e.id, ...detailOf(e.content) }; }
      catch (err) { if (signal.aborted) throw err; done[i] = { ...strip(item), status: 'failed', reason: String((err as Error).message || err).slice(0, 200) }; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PLAN_LIMITS.concurrency, plan.items.length) }, worker));
  return { evidence: evidence.filter((e): e is CouncilEvidence => !!e), coverage: [...done, ...plan.coverage] };
}
