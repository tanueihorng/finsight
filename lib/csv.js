'use strict';
// CSV parsing for holdings imports: plain CSV, IBKR Activity Statements, and
// loosely-matched broker exports (moomoo, Tiger, ...). Pure functions.

// Split one CSV line into fields, honoring double-quoted fields (which may
// contain commas) and escaped "" quotes.
function splitCsvLine(line) {
  const out = []; let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
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
const EXCHANGE_SUFFIX = {
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
function applyExchangeSuffix(symbol, exch) {
  symbol = symbol.toUpperCase();
  if (/[.\-=^]/.test(symbol)) return symbol;            // already has a suffix/format
  const suf = EXCHANGE_SUFFIX[(exch || '').toUpperCase().trim()];
  return suf ? symbol + suf : symbol;                   // unknown/US exchange -> leave as-is
}

// Interactive Brokers "Activity Statement": multi-section CSV. Holdings live in the
// "Open Positions" section; listing exchanges in "Financial Instrument Information"
// (used to add the right Yahoo suffix for SG/HK/etc. tickers).
function parseIbkrPositions(rows) {
  const exch = {};
  for (const r of rows) {
    if (r[0] === 'Financial Instrument Information' && r[1] === 'Data') {
      const sym = (r[3] || '').toUpperCase();
      if (sym) exch[sym] = r[8] || ''; // Listing Exch column
    }
  }
  const out = [];
  for (const r of rows) {
    if (r[0] === 'Open Positions' && r[1] === 'Data' && r[2] === 'Summary') {
      const cat = (r[3] || '').toLowerCase();
      if (!/stock|etf|equity|fund|adr/.test(cat)) continue; // skip forex/cash rows
      let symbol = (r[5] || '').toUpperCase().replace(/[^A-Z0-9.\-=^]/g, '');
      const quantity = parseFloat(r[6]);
      const price = parseFloat(r[8]); // Cost Price = average cost per share
      if (symbol && quantity > 0 && price >= 0) {
        out.push({ symbol: applyExchangeSuffix(symbol, exch[symbol]), quantity, price, dateMs: null });
      }
    }
  }
  return out;
}

// IBKR "Dividends" section: `Dividends,Data,<ccy>,<YYYY-MM-DD>,<DESC with SYMBOL(...)>,<amount>`.
// Returns dividend cash received per line (gross), symbol parsed from the description.
function parseIbkrDividends(text) {
  const rows = String(text || '').split(/\r?\n/).filter((l) => l.trim()).map(splitCsvLine);
  const out = [];
  for (const r of rows) {
    if (r[0] !== 'Dividends' || r[1] !== 'Data') continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r[3] || '')) continue; // skip Total / header rows
    const symbol = (r[4] || '').split('(')[0].trim().toUpperCase().replace(/[^A-Z0-9.\-=^]/g, '');
    const amount = parseFloat(r[5]);
    if (symbol && Number.isFinite(amount) && amount !== 0) {
      out.push({ symbol, date: r[3], amount, currency: (r[2] || 'USD').toUpperCase() });
    }
  }
  return out;
}

// Generic broker/flat CSV: find a header row anywhere, match columns loosely
// (works for moomoo, Tiger, and most "positions" exports, plus the simple format).
function parseCsv(text) {
  const rawLines = String(text || '').split(/\r?\n/).filter((l) => l.trim());
  if (!rawLines.length) return [];
  if (rawLines.some((l) => l.startsWith('Open Positions,') || l.startsWith('"Open Positions",'))) {
    const ibkr = parseIbkrPositions(rawLines.map(splitCsvLine));
    if (ibkr.length) return ibkr;
  }
  const grid = rawLines.map(splitCsvLine);
  const M = {
    sym: (h) => /(symbol|ticker|^sym$|\bsym\b|^code$|stock\s*code|instrument)/.test(h) && !/name|desc/.test(h),
    qty: (h) => /(quantity|qty|shares|units|position|holding|volume)/.test(h) && !/value/.test(h),
    priceStrong: (h) => /(avg.*cost|average.*cost|cost.*price|unit.*cost|avg.*price|average.*price)/.test(h),
    priceWeak: (h) => /(avg|average|cost|price)/.test(h) && !/(basis|value|market|total|proceeds|current|last|close|change|p\/?l|pnl|gain|fee)/.test(h),
    date: (h) => /(date|bought|purchase|acquired|trade|open)/.test(h),
    exch: (h) => /(exchange|market|listing|venue)/.test(h) && !/value/.test(h),
  };
  const headerCols = (cells) => {
    const low = cells.map((c) => c.toLowerCase());
    const f = (fn) => low.findIndex(fn);
    const iSym = f(M.sym), iQty = f(M.qty);
    let iPrice = f(M.priceStrong); if (iPrice < 0) iPrice = f(M.priceWeak);
    if (iSym < 0 || iQty < 0 || iPrice < 0) return null;
    return { iSym, iQty, iPrice, iDate: f(M.date), iExch: f(M.exch) };
  };
  let cols = null, start = 0;
  for (let i = 0; i < grid.length; i++) { const c = headerCols(grid[i]); if (c) { cols = c; start = i + 1; break; } }
  const { iSym = 0, iQty = 1, iPrice = 2, iDate = 3, iExch = -1 } = cols || {}; // no header -> bare positional
  const rows = [];
  for (let i = start; i < grid.length; i++) {
    const c = grid[i];
    let symbol = (c[iSym] || '').toUpperCase().replace(/[^A-Z0-9.\-=^]/g, '');
    const quantity = parseFloat((c[iQty] || '').replace(/[^0-9.\-]/g, ''));
    const price = parseFloat((c[iPrice] || '').replace(/[^0-9.\-]/g, ''));
    const dm = iDate >= 0 && c[iDate] ? Date.parse(c[iDate]) : NaN;
    if (iExch >= 0) symbol = applyExchangeSuffix(symbol, c[iExch]);
    if (symbol && quantity > 0 && price >= 0) rows.push({ symbol, quantity, price, dateMs: Number.isFinite(dm) ? dm : null });
  }
  return rows;
}

module.exports = { splitCsvLine, applyExchangeSuffix, parseIbkrPositions, parseIbkrDividends, parseCsv };
