'use strict';
// Deterministic offline market for E2E tests (FINSIGHT_FAKE_MARKET=1).
// Replaces global fetch: Yahoo, FRED, World Bank and Forex Factory answer from
// test/fixtures/market/; loopback (the local agent) passes through; any other
// host throws, so a run with this switch on makes no network calls at all.
// Prices are a seeded sine walk keyed by bar age, ending at the fixture price
// today, so the same request gives the same numbers across restarts.
const fs = require('fs');
const path = require('path');

const FIX = path.join(__dirname, '..', 'test', 'fixtures', 'market');
const load = (f) => JSON.parse(fs.readFileSync(path.join(FIX, f), 'utf8'));
const DAY = 24 * 60 * 60 * 1000;

let fx, symbols, news, calendar, macro;
function loadFixtures() {
  ({ fx, symbols } = load('quotes.json'));
  news = load('news.json').items;
  calendar = load('calendar.json').events;
  macro = load('macro.json');
}

// --- seeded walk ---------------------------------------------------------------
function hash(s) { // FNV-1a -> [0, 1)
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967296;
}
const VOL = { low: 0.4, normal: 1, high: 2.2 };
// Price multiplier for a bar `age` days before today; walk(sym)(0) === 1.
function walk(key, scale = 1) {
  const r = [1, 2, 3, 4, 5].map((i) => hash(`${key}#${i}`));
  const tau = 2 * Math.PI;
  const waves = [
    [0.05 * scale, 35 + 50 * r[0], tau * r[1]],
    [0.10 * scale, 160 + 200 * r[2], tau * r[3]],
    [0.012 * scale, 3.3, tau * r[4]],
  ];
  const drift = (0.00025 + 0.0005 * r[0]) * Math.min(scale, 1.5);
  return (age) => Math.exp(-drift * age + waves.reduce((s, [a, p, ph]) => s + a * (Math.sin(age / p * tau + ph) - Math.sin(ph)), 0));
}
const round = (v) => (Math.abs(v) >= 100 ? Math.round(v * 100) / 100 : Math.round(v * 10000) / 10000);

// symbol -> { name, currency, price, type, ... } or null (unknown -> 404)
function lookup(sym) {
  if (symbols[sym]) return symbols[sym];
  const m = /^([A-Z]{3})([A-Z]{3})=X$/.exec(sym);
  if (m && fx[m[1]] && fx[m[2]]) {
    return { name: `${m[1]}/${m[2]}`, currency: m[2], price: fx[m[2]] / fx[m[1]], type: 'CURRENCY', vol: 'low' };
  }
  return null;
}

const RANGE_DAYS = { '1d': 1, '5d': 5, '1mo': 31, '3mo': 92, '6mo': 183, '1y': 366, '2y': 731, '5y': 1827, '10y': 3653, max: 3653 };
const STEP_MIN = { '1m': 1, '2m': 2, '5m': 5, '15m': 15, '30m': 30, '60m': 60, '90m': 90, '1h': 60, '1d': 1440, '5d': 7200, '1wk': 10080, '1mo': 43200, '3mo': 129600 };
function rangeDays(range, now) {
  if (range === 'ytd') return Math.max(1, Math.ceil((now - Date.UTC(new Date(now).getUTCFullYear(), 0, 1)) / DAY));
  return RANGE_DAYS[range] || 31;
}

function bars(sym, s, range, interval, now) {
  const step = (STEP_MIN[interval] || 1440) * 60000;
  const g = walk(sym, VOL[s.vol] || 1);
  const anchor = step >= DAY ? Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate()) : Math.floor(now / step) * step;
  const n = Math.min(5000, Math.max(1, Math.floor(rangeDays(range, now) * DAY / step)));
  const out = [];
  for (let k = n - 1; k >= 0; k--) {
    const age = k * step / DAY;
    const c = s.price * g(age), o = s.price * g(age + step / DAY / 2);
    out.push({ t: anchor - k * step, o: round(o), h: round(Math.max(o, c) * 1.004), l: round(Math.min(o, c) * 0.996),
      c: round(c), v: Math.round(1e6 * (1 + hash(`${sym}@${k}`))) });
  }
  return out;
}

function meta(sym, s, now) {
  const g = walk(sym, VOL[s.vol] || 1);
  const year = Array.from({ length: 365 }, (_, d) => s.price * g(d));
  return {
    symbol: sym, longName: s.name, shortName: s.name, currency: s.currency,
    fullExchangeName: s.exchange || '', exchangeName: s.exchange || '', instrumentType: s.type || 'EQUITY',
    regularMarketPrice: s.price, chartPreviousClose: round(s.price * g(1)),
    regularMarketDayHigh: round(s.price * 1.006), regularMarketDayLow: round(s.price * 0.994),
    fiftyTwoWeekHigh: round(Math.max(...year)), fiftyTwoWeekLow: round(Math.min(...year)),
    regularMarketVolume: Math.round(1e6 * (1 + hash(sym))), regularMarketTime: Math.floor(now / 60000) * 60,
  };
}

// Payments on the 10th of each fixture month over the past five years.
function dividends(s, now) {
  if (!s.div) return [];
  const out = [], d = new Date(now);
  for (let y = d.getUTCFullYear() - 5; y <= d.getUTCFullYear(); y++) {
    for (const m of s.div.months) { const t = Date.UTC(y, m - 1, 10); if (t <= now && t > now - 5 * 366 * DAY) out.push({ t, amount: s.div.amount }); }
  }
  return out;
}
function nextDividend(s, now) {
  if (!s.div) return null;
  const y = new Date(now).getUTCFullYear();
  for (const yy of [y, y + 1]) for (const m of s.div.months) { const t = Date.UTC(yy, m - 1, 10); if (t > now) return t; }
  return null;
}

// --- handlers ------------------------------------------------------------------
function chart(sym, q, now) {
  const s = lookup(sym);
  if (!s) return [404, { chart: { result: null, error: { code: 'Not Found', description: 'No data found, symbol may be delisted' } } }];
  const range = q.get('range') || '1mo', interval = q.get('interval') || '1d';
  const b = bars(sym, s, range, interval, now);
  const result = {
    meta: meta(sym, s, now),
    timestamp: b.map((x) => Math.floor(x.t / 1000)),
    indicators: { quote: [{ open: b.map((x) => x.o), high: b.map((x) => x.h), low: b.map((x) => x.l), close: b.map((x) => x.c), volume: b.map((x) => x.v) }] },
  };
  if ((q.get('events') || '').includes('div')) {
    result.events = { dividends: Object.fromEntries(dividends(s, now).map((d) => [d.t / 1000, { date: d.t / 1000, amount: d.amount }])) };
  }
  return [200, { chart: { result: [result], error: null } }];
}

function searchHandler(q, now) {
  const term = (q.get('q') || '').trim().toUpperCase();
  const quotes = Object.entries(symbols)
    .filter(([sym, s]) => term && (sym.startsWith(term) || s.name.toUpperCase().includes(term)))
    .sort(([a], [b]) => (a === term ? -1 : b === term ? 1 : a.localeCompare(b)))
    .slice(0, Number(q.get('quotesCount') ?? 10))
    .map(([sym, s]) => ({ symbol: sym, longname: s.name, shortname: s.name, exchange: s.exchange || '', exchDisp: s.exchange || '',
      quoteType: s.type || 'EQUITY', typeDisp: s.type || 'EQUITY', sector: s.sector }));
  const hour = Math.floor(now / 3600000) * 3600;
  const tagged = news.filter((n) => n.tickers.includes(term));
  const items = (tagged.length ? tagged : news).slice(0, Number(q.get('newsCount') ?? 0)).map((n, i) => ({
    uuid: `fake-${hash(n.title).toString(36).slice(2, 10)}-${i}`, title: n.title, publisher: n.publisher,
    link: `https://example.com/news/${encodeURIComponent(n.title.toLowerCase().replace(/\W+/g, '-'))}`,
    providerPublishTime: hour - n.ageHours * 3600, relatedTickers: n.tickers,
  }));
  return [200, { quotes, news: items }];
}

function quoteDetails(q, now) {
  const result = (q.get('symbols') || '').split(',').filter(Boolean).map((sym) => {
    const s = lookup(sym); if (!s) return null;
    const out = { symbol: sym, currency: s.currency };
    if (s.div) {
      const rate = s.div.amount * s.div.months.length;
      Object.assign(out, { dividendRate: rate, trailingAnnualDividendRate: rate, dividendYield: round(rate / s.price * 100) });
      const next = nextDividend(s, now);
      if (next) Object.assign(out, { dividendDate: next / 1000, exDividendDate: (next - 14 * DAY) / 1000 });
    }
    if (s.earningsInDays != null) {
      const t = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate() + s.earningsInDays, 21) / 1000;
      Object.assign(out, { earningsTimestampStart: t, earningsTimestampEnd: t, isEarningsDateEstimate: false });
    }
    return out;
  }).filter(Boolean);
  return [200, { quoteResponse: { result, error: null } }];
}

// Monthly FRED CSV from `cosd` to now.
function fred(q, now) {
  const id = (q.get('id') || 'DGS10').toUpperCase();
  const level = macro.fred[id] ?? 3;
  const g = walk(`fred:${id}`, 0.6);
  const start = new Date(q.get('cosd') || '2015-01-01'), end = new Date(now);
  const rows = ['observation_date,' + id];
  const months = (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + end.getUTCMonth() - start.getUTCMonth();
  for (let i = 0; i <= months; i++) {
    const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1));
    rows.push(`${d.toISOString().slice(0, 10)},${round(level * g((months - i) * 30)).toFixed(level >= 100 ? 1 : 2)}`);
  }
  return [200, rows.join('\n') + '\n', 'text/csv'];
}

// World Bank: [meta, rows], newest year first, like the real API.
function worldBank(pathname, now) {
  const m = /\/v2\/country\/([^/]+)\/indicator\/([^/]+)/.exec(pathname);
  if (!m) return [404, { message: 'Not found' }];
  const country = decodeURIComponent(m[1]).toUpperCase(), indicator = decodeURIComponent(m[2]);
  const name = macro.worldbank.countries[country];
  if (!name) return [200, [{ message: [{ id: '120', key: 'Invalid value', value: 'The provided parameter value is not valid' }] }]];
  const ind = macro.worldbank.indicators[indicator] || { label: indicator, level: 100 };
  const g = walk(`wb:${country}:${indicator}`, 0.8);
  const last = new Date(now).getUTCFullYear() - 1;
  const rows = Array.from({ length: 30 }, (_, i) => ({
    indicator: { id: indicator, value: ind.label }, country: { id: country, value: name },
    date: String(last - i), value: Number((ind.level * g(i * 365)).toPrecision(6)),
  }));
  return [200, [{ page: 1, pages: 1, per_page: 60, total: rows.length }, rows]];
}

function forexFactory(now) {
  const today = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate());
  return [200, calendar.map((e) => ({ title: e.title, country: e.country, impact: e.impact, forecast: e.forecast, previous: e.previous,
    date: new Date(today + e.dayOffset * DAY + e.hourUtc * 3600000).toISOString() }))];
}

// --- fetch shim ----------------------------------------------------------------
function respond(status, body, type = 'application/json', setCookie = []) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  const headers = new Headers({ 'content-type': type });
  headers.getSetCookie = () => setCookie;
  return { ok: status >= 200 && status < 300, status, headers, json: async () => JSON.parse(text), text: async () => text };
}

function route(u, now) {
  const host = u.hostname;
  if (/^query[12]\.finance\.yahoo\.com$/.test(host)) {
    const c = u.pathname.match(/^\/v8\/finance\/chart\/(.+)$/);
    if (c) return chart(decodeURIComponent(c[1]), u.searchParams, now);
    if (u.pathname === '/v1/finance/search') return searchHandler(u.searchParams, now);
    if (u.pathname === '/v7/finance/quote') return quoteDetails(u.searchParams, now);
    if (u.pathname === '/v1/test/getcrumb') return [200, 'fakecrumb', 'text/plain'];
    return [404, { error: 'Not found' }];
  }
  if (host === 'fc.yahoo.com') return [404, '', 'text/html', ['A3=fake; Path=/']];
  if (host === 'fred.stlouisfed.org') return fred(u.searchParams, now);
  if (host === 'api.worldbank.org') return worldBank(u.pathname, now);
  if (host === 'nfs.faireconomy.media') return forexFactory(now);
  return null;
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
let installed = false;
function install() {
  if (installed) return;
  installed = true;
  loadFixtures();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const u = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url);
    if (LOOPBACK.has(u.hostname)) return realFetch(input, init);
    const r = route(u, Date.now());
    if (!r) throw new TypeError(`fetch blocked: FINSIGHT_FAKE_MARKET=1 has no fixture for ${u.hostname}`);
    return respond(...r);
  };
  console.log('FINSIGHT_FAKE_MARKET=1: market data comes from test/fixtures/market (no network).');
}

module.exports = { install, walk, lookup };
