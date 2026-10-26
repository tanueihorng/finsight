// CSV parsing for holdings imports: plain CSV, IBKR Activity Statements, and
// loosely-matched broker exports (moomoo, Tiger, ...). Pure functions.

/** One holding parsed from a CSV row; dateMs is the purchase date when given. */
export interface CsvRow { symbol: string; quantity: number; price: number; dateMs: number | null }
/** One IBKR dividend line; tax is the matching withholding, when present. */
export interface IbkrDividend { symbol: string; date: string; amount: number; currency: string; tax?: number }

// Split one CSV line into fields, honoring double-quoted fields (which may
// contain commas) and escaped "" quotes.
export function splitCsvLine(line: string): string[] {
  const out: string[] = []; let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (inQ) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

// Map a broker's listing-exchange or market label to the Yahoo ticker suffix.
const EXCHANGE_SUFFIX: Record<string, string> = {
  // US (no suffix)
  US: '', USA: '', NASDAQ: '', NMS: '', NYSE: '', NYS: '', ARCA: '', BATS: '', AMEX: '', PINK: '', OTC: '',
  // Singapore / HK / Asia
  SG: '.SI', SGX: '.SI', SES: '.SI',
  HK: '.HK', SEHK: '.HK', HKEX: '.HK', HKG: '.HK',
  JP: '.T', TSE: '.T', TYO: '.T', JPX: '.T',
  KR: '.KS', KRX: '.KS', KSC: '.KS',
  CN: '.SS', SSE: '.SS', SHH: '.SS', SHA: '.SS', SZSE: '.SZ', SHE: '.SZ', SZ: '.SZ',
  IN: '.NS', NSE: '.NS', BSE: '.BO',
  TW: '.TW', TWSE: '.TW',
  // Europe
  UK: '.L', LSE: '.L', LON: '.L',
  DE: '.DE', IBIS: '.DE', FWB: '.DE', XETRA: '.DE', GETTEX: '.DE',
  FR: '.PA', SBF: '.PA', ENEXT: '.PA', PAR: '.PA',
  NL: '.AS', AEB: '.AS',
  IT: '.MI', BVME: '.MI', MIL: '.MI',
  ES: '.MC', BM: '.MC', MCE: '.MC',
  CH: '.SW', SWX: '.SW', EBS: '.SW',
  // Oceania / Canada
  AU: '.AX', ASX: '.AX',
  CA: '.TO', TSX: '.TO', VENTURE: '.V',
};
export function applyExchangeSuffix(symbol: string, exch: string | null | undefined): string {
  symbol = symbol.toUpperCase();
  if (/[.\-=^]/.test(symbol)) return symbol;            // already has a suffix/format
  const suf = EXCHANGE_SUFFIX[(exch || '').toUpperCase().trim()];
  return suf ? symbol + suf : symbol;                   // unknown/US exchange -> leave as-is
}

// Interactive Brokers "Activity Statement": multi-section CSV. Holdings live in the
// "Open Positions" section; listing exchanges in "Financial Instrument Information"
// (used to add the right Yahoo suffix for SG/HK/etc. tickers).
export function parseIbkrPositions(rows: string[][]): CsvRow[] {
  const exch: Record<string, string> = {};
  for (const r of rows) {
    if (r[0] === 'Financial Instrument Information' && r[1] === 'Data') {
      const sym = (r[3] || '').toUpperCase();
      if (sym) exch[sym] = r[8] || ''; // Listing Exch column
    }
  }
  const out: CsvRow[] = [];
  for (const r of rows) {
    if (r[0] === 'Open Positions' && r[1] === 'Data' && r[2] === 'Summary') {
      const cat = (r[3] || '').toLowerCase();
      if (!/stock|etf|equity|fund|adr/.test(cat)) continue; // skip forex/cash rows
      let symbol = (r[5] || '').toUpperCase().replace(/[^A-Z0-9.\-=^]/g, '');
      const quantity = parseFloat(r[6]!);
      const price = parseFloat(r[8]!); // Cost Price = average cost per share
      if (symbol && quantity > 0 && price >= 0) {
        out.push({ symbol: applyExchangeSuffix(symbol, exch[symbol]), quantity, price, dateMs: null });
      }
    }
  }
  return out;
}

// IBKR "Dividends" section: `Dividends,Data,<ccy>,<YYYY-MM-DD>,<DESC with SYMBOL(...)>,<amount>`.
// Returns dividend cash received per line (gross), symbol parsed from the description.
// Tax withheld at source comes from the "Withholding Tax" section (same layout,
// negative amounts) and is attached to the matching dividend as `tax`.
export function parseIbkrDividends(text: unknown): IbkrDividend[] {
  const rows = String(text || '').split(/\r?\n/).filter((l) => l.trim()).map(splitCsvLine);
  const symOf = (desc: string | undefined) => (desc || '').split('(')[0]!.trim().toUpperCase().replace(/[^A-Z0-9.\-=^]/g, '');
  const out: IbkrDividend[] = [], tax: Record<string, number> = {};
  for (const r of rows) {
    if (r[1] !== 'Data' || !/^\d{4}-\d{2}-\d{2}$/.test(r[3] || '')) continue; // skip Total / header rows
    const symbol = symOf(r[4]);
    const amount = parseFloat(r[5]!);
    if (!symbol || !Number.isFinite(amount) || amount === 0) continue;
    if (r[0] === 'Dividends') out.push({ symbol, date: r[3]!, amount, currency: (r[2] || 'USD').toUpperCase() });
    else if (r[0] === 'Withholding Tax') { const k = symbol + '|' + r[3]; tax[k] = (tax[k] || 0) - amount; }
  }
  for (const d of out) {
    const k = d.symbol + '|' + d.date;
    const t = tax[k];
    if (t != null) { d.tax = Math.round(t * 1e6) / 1e6; delete tax[k]; }
  }
  return out;
}

// Generic broker/flat CSV: find a header row anywhere, match columns loosely
// (works for moomoo, Tiger, and most "positions" exports, plus the simple format).
export function parseCsv(text: unknown): CsvRow[] {
  const rawLines = String(text || '').split(/\r?\n/).filter((l) => l.trim());
  if (!rawLines.length) return [];
  if (rawLines.some((l) => l.startsWith('Open Positions,') || l.startsWith('"Open Positions",'))) {
    const ibkr = parseIbkrPositions(rawLines.map(splitCsvLine));
    if (ibkr.length) return ibkr;
  }
  const grid = rawLines.map(splitCsvLine);
  const M = {
    sym: (h: string) => /(symbol|ticker|^sym$|\bsym\b|^code$|stock\s*code|instrument)/.test(h) && !/name|desc/.test(h),
    qty: (h: string) => /(quantity|qty|shares|units|position|holding|volume)/.test(h) && !/value/.test(h),
    priceStrong: (h: string) => /(avg.*cost|average.*cost|cost.*price|unit.*cost|avg.*price|average.*price)/.test(h),
    priceWeak: (h: string) => /(avg|average|cost|price)/.test(h) && !/(basis|value|market|total|proceeds|current|last|close|change|p\/?l|pnl|gain|fee)/.test(h),
    date: (h: string) => /(date|bought|purchase|acquired|trade|open)/.test(h),
    exch: (h: string) => /(exchange|market|listing|venue)/.test(h) && !/value/.test(h),
  };
  const headerCols = (cells: string[]) => {
    const low = cells.map((c) => c.toLowerCase());
    const f = (fn: (h: string) => boolean) => low.findIndex(fn);
    const iSym = f(M.sym), iQty = f(M.qty);
    let iPrice = f(M.priceStrong); if (iPrice < 0) iPrice = f(M.priceWeak);
    if (iSym < 0 || iQty < 0 || iPrice < 0) return null;
    return { iSym, iQty, iPrice, iDate: f(M.date), iExch: f(M.exch) };
  };
  let cols: ReturnType<typeof headerCols> = null, start = 0;
  for (let i = 0; i < grid.length; i++) { const c = headerCols(grid[i]!); if (c) { cols = c; start = i + 1; break; } }
  const { iSym = 0, iQty = 1, iPrice = 2, iDate = 3, iExch = -1 } = cols || ({} as Partial<NonNullable<typeof cols>>); // no header -> bare positional
  const rows: CsvRow[] = [];
  for (let i = start; i < grid.length; i++) {
    const c = grid[i]!;
    let symbol = (c[iSym] || '').toUpperCase().replace(/[^A-Z0-9.\-=^]/g, '');
    const quantity = parseFloat((c[iQty] || '').replace(/[^0-9.\-]/g, ''));
    const price = parseFloat((c[iPrice] || '').replace(/[^0-9.\-]/g, ''));
    const dm = iDate >= 0 && c[iDate] ? Date.parse(c[iDate]) : NaN;
    if (iExch >= 0) symbol = applyExchangeSuffix(symbol, c[iExch]);
    if (symbol && quantity > 0 && price >= 0) rows.push({ symbol, quantity, price, dateMs: Number.isFinite(dm) ? dm : null });
  }
  return rows;
}

export interface IbkrTrade { symbol: string; type: 'BUY' | 'SELL'; quantity: number; price: number; time: number; currency: string }
// Explicit IBKR Trades sections only; never mistake a positions snapshot for fills.
// Fail on unsupported instruments or malformed rows rather than silently losing trades.
export function parseIbkrTrades(text: unknown): IbkrTrade[] | null {
  const rows = String(text || '').split(/\r?\n/).filter((l) => l.trim()).map(splitCsvLine);
  if (!rows.some((r) => r[0] === 'Trades')) return null;
  const exchanges: Record<string, string> = {};
  for (const r of rows) if (r[0] === 'Financial Instrument Information' && r[1] === 'Data') exchanges[r[3] || ''] = r[8] || '';
  let header: string[] = [];
  const out: IbkrTrade[] = [];
  const num = (v: string) => v.trim() ? Number(v.replaceAll(',', '')) : NaN;
  for (const r of rows) {
    if (r[0] !== 'Trades') continue;
    if (r[1] === 'Header') { header = r; continue; }
    if (r[1] !== 'Data' || /total/i.test(r[2] || '') || r.slice(2, 5).some((c) => /^(Total|SubTotal)(\b|$)/i.test(c))) continue;
    const get = (...names: string[]) => r[header.findIndex((h) => names.includes(h))] || '';
    const category = get('Asset Category');
    if (!/^(Stocks|ETFs|Equities|ADRs)$/i.test(category)) throw new Error(`Unsupported IBKR trade category: ${category || 'missing header'}`);
    const discriminator = get('DataDiscriminator');
    if (discriminator && !/^(Order|Trade|Execution)$/i.test(discriminator)) throw new Error(`Unsupported IBKR trade row: ${discriminator}`);
    const symbol = applyExchangeSuffix(get('Symbol'), exchanges[get('Symbol')]);
    const signed = num(get('Quantity')), price = num(get('T. Price', 'Trade Price', 'Price'));
    const date = get('Date/Time', 'Date', 'Trade Date');
    // Statements have no timezone column. Use the displayed trade day at UTC
    // midnight for deterministic matching with manually dated ledger entries.
    const day = date.match(/^(\d{4}-\d{2}-\d{2})(?:$|[, T])/ )?.[1];
    const time = day ? Date.parse(day + 'T00:00:00Z') : NaN;
    const currency = get('Currency').toUpperCase();
    if (!/^[A-Z0-9.^=\-_:]{1,24}$/.test(symbol) || !Number.isFinite(signed) || signed === 0 || !Number.isFinite(price) || price < 0 || !Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== day || time > Date.now() || !/^[A-Z]{3}$/.test(currency)) throw new Error('Invalid IBKR trade: check symbol, quantity, price, currency and date');
    out.push({ symbol, type: signed > 0 ? 'BUY' : 'SELL', quantity: Math.abs(signed), price, time, currency });
  }
  return out;
}
