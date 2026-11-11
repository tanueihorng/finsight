export const MAX_DRAFT_TRADES = 20;
export const SANDBOX_SYMBOL = /^[A-Z0-9.^=\-_:]{1,24}$/;
export const SANDBOX_CURRENCY = /^[A-Z]{3}$/;
export const QUOTE_AGE_LIMIT = 96 * 60 * 60 * 1000;

export interface SandboxInstrument {
  symbol: string;
  quantity: number;
  currency: string | null;
  price: number | null;
  marketTime: number | null;
  stale: boolean;
  exclusion: string | null;
}

export interface SandboxSnapshot {
  account: string;
  name: string;
  book: 'real' | 'paper';
  currency: string;
  capturedAt: number;
  cash: number | null;
  otherCash: { currency: string; amount: number }[];
  instruments: SandboxInstrument[];
}

export interface DraftTrade {
  side: 'buy' | 'sell';
  symbol: string;
  quantity: number;
  price: number | null;
  fee: number;
}

export function amount(value: number | null): value is number {
  return value != null && Number.isFinite(value) && value >= 0;
}

function balance(available: number, spent: number): number {
  const remaining = available - spent;
  if (!Number.isFinite(remaining)) return remaining;
  // Allow for binary rounding on exact exhaustion of cash or shares.
  return Math.abs(remaining) <= Math.max(Math.abs(available), Math.abs(spent)) * Number.EPSILON * 4 ? 0 : remaining;
}

function valuePositions(instruments: SandboxInstrument[], quantities: Map<string, number>) {
  const rows = instruments.filter((p) => !p.exclusion && (quantities.get(p.symbol) ?? 0) > 0).map((p) => {
    const quantity = quantities.get(p.symbol)!;
    const value = p.price !== null && Number.isFinite(quantity * p.price) ? quantity * p.price : null;
    return { symbol: p.symbol, quantity, value };
  });
  const total = rows.reduce((sum, row) => sum + (row.value ?? 0), 0);
  const pricedValue = Number.isFinite(total) ? total : null;
  const weights = rows.map((row) => ({
    ...row, weight: pricedValue && row.value !== null ? row.value / pricedValue : null,
  })).sort((a, b) => (b.value ?? 0) - (a.value ?? 0) || a.symbol.localeCompare(b.symbol));
  return { rows: weights, pricedValue, unpriced: rows.filter((p) => p.value === null).length, largest: weights.find((p) => p.weight !== null) ?? null };
}

export function previewSandbox(snapshot: SandboxSnapshot, trades: DraftTrade[], openingCash: number | null) {
  const instruments = new Map(snapshot.instruments.map((p) => [p.symbol, p]));
  const quantities = new Map(snapshot.instruments.map((p) => [p.symbol, p.quantity]));
  const before = valuePositions(snapshot.instruments, quantities);
  const fail = (error: string, row: number | null = null) => ({ before, result: null, error, row } as const);
  if (!amount(openingCash)) return fail('Enter an opening cash amount for this preview.');
  let cash = openingCash, fees = 0;
  for (const [index, trade] of trades.entries()) {
    const p = instruments.get(trade.symbol);
    if (!p) return fail('Pin a snapshot that includes this symbol.', index);
    if (p.exclusion) return fail(p.exclusion, index);
    if (!amount(trade.quantity) || trade.quantity === 0) return fail('Enter a share count above zero.', index);
    const price = trade.price ?? p.price;
    if (!amount(price) || price === 0) return fail('Enter a price above zero or use an available snapshot quote.', index);
    if (!amount(trade.fee)) return fail('Enter a fee of zero or more.', index);
    const held = quantities.get(p.symbol)!;
    const gross = trade.quantity * price;
    const nextCash = trade.side === 'buy' ? balance(cash, gross + trade.fee) : balance(cash, trade.fee - gross);
    const nextShares = trade.side === 'buy' ? held + trade.quantity : balance(held, trade.quantity);
    if (![nextCash, nextShares, fees + trade.fee].every(Number.isFinite)) return fail('Trade amounts are too large.', index);
    if (nextShares < 0) return fail(`Oversell. Shares available at this step: ${held}.`, index);
    if (nextCash < 0) return fail(`Insufficient cash at this step. Available: ${snapshot.currency} ${cash.toLocaleString(undefined, { maximumFractionDigits: 4 })}.`, index);
    quantities.set(p.symbol, nextShares);
    cash = nextCash;
    fees += trade.fee;
  }
  const after = valuePositions(snapshot.instruments, quantities);
  return { before, result: { after, cash, fees }, error: null, row: null } as const;
}
