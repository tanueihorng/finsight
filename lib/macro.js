'use strict';
// Macro data: World Bank, FRED and the economic calendar (all free, no key).
const { UA } = require('./config');
const { fetchJson } = require('./market');
const { cacheGet, cacheSet } = require('./cache');

// World Bank macro data (free, no key) ---------------------------------------
async function worldBank(country, indicator) {
  const key = `wb:${country}:${indicator}`;
  const cached = cacheGet(key);
  if (cached) return cached;
  const url = `https://api.worldbank.org/v2/country/${encodeURIComponent(country)}/indicator/${encodeURIComponent(
    indicator
  )}?format=json&per_page=60`;
  const data = await fetchJson(url);
  const meta = Array.isArray(data) ? data[0] : null;
  const rows = (Array.isArray(data) ? data[1] : []) || [];
  const series = rows
    .filter((r) => r.value != null)
    .map((r) => ({ year: r.date, value: r.value }))
    .sort((a, b) => Number(a.year) - Number(b.year));
  const label = rows[0]?.indicator?.value || indicator;
  const countryName = rows[0]?.country?.value || country;
  const payload = { country, countryName, indicator, label, series };
  return cacheSet(key, payload, 6 * 60 * 60000);
}

// FRED (US Federal Reserve) macro data — free, NO API KEY via the graph CSV export.
async function getFred(series, transform, start) {
  series = (series || 'DGS10').toUpperCase();
  transform = transform || 'lin';
  start = start || '2015-01-01';
  const key = `fred:${series}:${transform}:${start}`;
  const cached = cacheGet(key);
  if (cached) return cached;
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(series)}` +
    `&transformation=${encodeURIComponent(transform)}&cosd=${encodeURIComponent(start)}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error(`FRED HTTP ${res.status}`);
  const text = await res.text();
  const lines = text.trim().split(/\r?\n/);
  const points = [];
  for (let i = 1; i < lines.length; i++) {
    const [date, val] = lines[i].split(',');
    const v = parseFloat(val);
    if (date && Number.isFinite(v)) points.push({ date, value: v });
  }
  const payload = { series, transform, points };
  return cacheSet(key, payload, 60 * 60000);
}

// Economic calendar (free, no key) -------------------------------------------
// Curated FOMC schedule — the Fed publishes the whole year ahead and the dates
// are fixed, so the next rate decision + dot-plot (SEP) are always known even
// without a feed. SEP = Summary of Economic Projections ("dot plot"). Refresh
// this list once a year (federalreserve.gov/monetarypolicy/fomccalendars.htm).
const FOMC_SCHEDULE = [
  { start: '2026-01-27', end: '2026-01-28', sep: false },
  { start: '2026-03-17', end: '2026-03-18', sep: true },
  { start: '2026-04-28', end: '2026-04-29', sep: false },
  { start: '2026-06-16', end: '2026-06-17', sep: true },
  { start: '2026-07-28', end: '2026-07-29', sep: false },
  { start: '2026-09-15', end: '2026-09-16', sep: true },
  { start: '2026-10-27', end: '2026-10-28', sep: false },
  { start: '2026-12-08', end: '2026-12-09', sep: true },
];

// Upcoming macro events: the curated FOMC anchor + this-week high-impact US (and
// any SG) releases from Forex Factory's key-free weekly JSON (CPI, PCE, NFP, GDP,
// the rate decision itself…). No API key, no account. Personal/local use only —
// the feed rate-limits hard, so we cache for an hour and degrade gracefully.
async function getCalendar() {
  const key = 'calendar';
  const cached = cacheGet(key);
  if (cached) return cached;
  const now = Date.now();

  // FOMC: the decision lands on the 2nd day; keep meetings whose end is today/future.
  const fomc = FOMC_SCHEDULE
    .map((m) => ({ ...m, decisionMs: Date.parse(m.end + 'T18:30:00Z') })) // ~14:00 ET, DST-neutral
    .filter((m) => m.decisionMs >= now - 12 * 60 * 60000);
  if (fomc.length === 0) {
    // The curated list expired — say so once instead of silently dropping the
    // FOMC panel. Refresh FOMC_SCHEDULE from federalreserve.gov each December.
    console.warn('FOMC_SCHEDULE is exhausted (last entry passed). Refresh the list for the new year.');
  }
  const nextFomc = fomc[0] || null;
  const nextSep = fomc.find((m) => m.sep) || null;

  // This-week high-impact events (best effort).
  let events = [], eventsOk = false;
  try {
    const res = await fetch('https://nfs.faireconomy.media/ff_calendar_thisweek.json',
      { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12000) });
    if (res.ok) {
      const all = await res.json();
      events = (Array.isArray(all) ? all : [])
        .filter((e) => (e.country === 'USD' && e.impact === 'High') || e.country === 'SGD')
        .map((e) => ({
          title: e.title, country: e.country, time: e.date, impact: e.impact || '',
          forecast: e.forecast || '', previous: e.previous || '',
        }))
        .sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
      eventsOk = true;
    }
  } catch {}

  const payload = { now, fomc, nextFomc, nextSep, events, eventsOk,
    sepUrl: 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm' };
  return cacheSet(key, payload, 60 * 60000); // 1h
}

module.exports = { worldBank, getFred, getCalendar, FOMC_SCHEDULE };
