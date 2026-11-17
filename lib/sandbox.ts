import { activeBook } from './book.ts';
import { getQuotes } from './market.ts';
import { loadPortfolio, resolveAccount } from './store.ts';
import type { Quote } from '../shared/types.ts';
import { amount, QUOTE_AGE_LIMIT, SANDBOX_SYMBOL, type SandboxInstrument, type SandboxSnapshot } from '../shared/sandbox.ts';

/** Pin the recorded positions and cash before awaiting any market quotes. */
export async function sandboxSnapshot(accountId: string, currency: string, draftSymbols: string[]): Promise<SandboxSnapshot | null> {
  const book = activeBook();
  const portfolio = loadPortfolio({ backupCorrupt: false });
  if (!portfolio.accounts.some((p) => p.id === accountId)) return null;
  const account = resolveAccount(portfolio, accountId);
  const capturedAt = Date.now();
  const held = new Map<string, { quantity: number; currency: string | null; currencyConflict: boolean }>();
  for (const position of account.positions) {
    const symbol = position.symbol.toUpperCase();
    const existing = held.get(symbol);
    const native = position.currency ?? null;
    held.set(symbol, {
      quantity: (existing?.quantity ?? 0) + position.quantity,
      currency: existing?.currency ?? native,
      currencyConflict: Boolean(existing?.currencyConflict || (existing?.currency && native && existing.currency !== native)),
    });
  }
  const symbols = [...new Set([...draftSymbols, ...held.keys()])];
  // Prefer draft symbols when an account exceeds the snapshot's quote limit.
  const toQuote = symbols.filter((s) => SANDBOX_SYMBOL.test(s)).slice(0, 200);
  const quotes = new Map<string, Quote>();
  for (let i = 0; i < toQuote.length; i += 6) {
    const batch = toQuote.slice(i, i + 6);
    const values = await getQuotes(batch);
    batch.forEach((symbol, index) => { quotes.set(symbol, values[index]!); });
  }
  const observedAt = Date.now();
  const instruments: SandboxInstrument[] = symbols.map((symbol) => {
    const position = held.get(symbol);
    const raw = quotes.get(symbol);
    const quote = raw && 'currency' in raw && raw.symbol.toUpperCase() === symbol ? raw : null;
    const quotedCurrency = quote?.currencyReported ? quote.currency : null;
    const quotedPrice = quote?.price ?? null;
    const price = amount(quotedPrice) && quotedPrice > 0 ? quotedPrice : null;
    const marketTime = quote?.marketTime && Number.isFinite(quote.marketTime) ? quote.marketTime : null;
    const quantity = position?.quantity ?? 0;
    let exclusion = null;
    if (!amount(quantity)) exclusion = 'Unsupported holding quantity.';
    else if (!quote || !quotedCurrency) exclusion = 'Quote or currency unavailable.';
    else if (quotedCurrency !== currency) exclusion = `Trades in ${quotedCurrency} are outside this ${currency} preview.`;
    else if (position?.currencyConflict || (position?.currency && position.currency !== quotedCurrency)) exclusion = 'The recorded currency conflicts with the quote or another holding.';
    else if (quote.type !== 'EQUITY' && quote.type !== 'ETF') exclusion = 'Only confirmed stocks and ETFs are supported.';
    return {
      symbol, quantity, currency: quotedCurrency ?? position?.currency ?? null, price, marketTime,
      stale: marketTime === null || observedAt - marketTime > QUOTE_AGE_LIMIT || quote?.cache?.status.startsWith('stale') === true,
      exclusion,
    };
  });
  const cash = account.cash[currency] ?? null;
  return {
    account: account.id, name: account.name, book, currency, capturedAt, instruments,
    cash: amount(cash) ? cash : null,
    otherCash: Object.entries(account.cash).filter(([ccy, balance]) => ccy !== currency && Number.isFinite(balance) && balance !== 0)
      .map(([ccy, amount]) => ({ currency: ccy, amount })),
  };
}
