'use strict';
// Test harness: isolates the data dir and replaces global fetch with an
// in-memory fake Yahoo so the portfolio math runs offline and deterministically.
// Require this BEFORE any lib/ module.
const fs = require('fs');
const os = require('os');
const path = require('path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'finsight-test-'));
process.env.FINSIGHT_DATA_DIR = dataDir;
process.env.NOTIFY = '0';
process.env.FINSIGHT_CACHE_PERSIST = '0';

const DAY = 24 * 60 * 60 * 1000;
const market = new Map(); // symbol -> { currency, price, prevClose, bars: [{ t, c, h, l }] }

// Daily bars ending today: closes[i] is (closes.length - 1 - i) days ago.
function dailyBars(closes) {
  const today = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());
  return closes.map((c, i) => ({ t: today - (closes.length - 1 - i) * DAY + 14 * 3600e3, c, h: c, l: c }));
}
function setSymbol(symbol, { currency = 'USD', price, prevClose, bars = [] } = {}) {
  const last = bars.length ? bars[bars.length - 1].c : price;
  market.set(symbol, { currency, price: price ?? last, prevClose: prevClose ?? price ?? last, bars });
}
function reset() {
  market.clear();
  try { require('../lib/cache').cache.clear(); } catch {}
  for (const f of fs.readdirSync(dataDir)) fs.rmSync(path.join(dataDir, f), { force: true, recursive: true });
}

const json = (obj, status = 200) => ({ ok: status < 400, status, json: async () => obj, text: async () => JSON.stringify(obj), headers: new Map() });
global.fetch = async (url) => {
  const u = new URL(String(url));
  const chart = u.pathname.match(/\/v8\/finance\/chart\/(.+)$/);
  if (chart) {
    const sym = decodeURIComponent(chart[1]);
    const m = market.get(sym);
    if (!m) return json({ chart: { result: null, error: { code: 'Not Found' } } }, 404);
    return json({ chart: { result: [{
      meta: { symbol: sym, currency: m.currency, regularMarketPrice: m.price, chartPreviousClose: m.prevClose, longName: sym + ' Inc' },
      timestamp: m.bars.map((b) => Math.floor(b.t / 1000)),
      indicators: { quote: [{ close: m.bars.map((b) => b.c), open: m.bars.map((b) => b.c), high: m.bars.map((b) => b.h), low: m.bars.map((b) => b.l), volume: m.bars.map(() => 0) }] },
    }] } });
  }
  if (u.pathname.includes('/v1/finance/search')) return json({ quotes: [], news: [] });
  return json({}, 404);
};

module.exports = { dataDir, market, setSymbol, dailyBars, reset, DAY };
