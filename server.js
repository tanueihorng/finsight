'use strict';
/*
 * FINSIGHT // PERSONAL TERMINAL  -  backend
 * ----------------------------------------------------------------------------
 * Zero-dependency Node.js server (built-in http + native fetch, Node 18+).
 *   - Proxies FREE, no-key data sources (Yahoo Finance, World Bank, FRED)
 *   - Stores your portfolio locally in data/portfolio.json
 *   - Serves the terminal UI from public/
 * Logic lives in lib/; this file is only the HTTP layer.
 *
 * Run:   node server.js          then open http://localhost:8000
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const { PORT, HOST, PUBLIC_DIR, PORTFOLIO_FILE } = require('./lib/config');
const { getQuotes, getHistory, search, getMarkets, getNews, getCategories } = require('./lib/market');
const { worldBank, getFred, getCalendar } = require('./lib/macro');
const {
  buy, sell, del, listAccounts, accountAdd, accountRename, accountRemove, portfolioWithQuotes, fxRisk,
  dividendsReport, watchlistWithQuotes, watchAdd, watchRemove, alertAdd, alertRemove, evaluateAlerts,
  alertsWithStatus, importCsv, resetPortfolio,
} = require('./lib/portfolio');
const { portfolioPerformance } = require('./lib/performance');
const {
  sessions, failState, loadAuth, setPin, verifyPin, newSession, sessionValid, getCookie, setSessionCookie, PIN_RE,
} = require('./lib/auth');

// --------------------------------------------------------------------------
// HTTP server
// --------------------------------------------------------------------------
function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve) => {
    let data = '', done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } }; // always settle, even on teardown
    const MAX = 25e6; // big enough for full broker statements
    req.on('data', (c) => { data += c; if (data.length > MAX) { req.destroy(); finish({}); } });
    req.on('end', () => { try { finish(data ? JSON.parse(data) : {}); } catch { finish({}); } });
    req.on('aborted', () => finish({}));
    req.on('error', () => finish({}));
    req.on('close', () => finish({}));
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.png': 'image/png',
};
function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  // Structural containment: a plain prefix check would also accept sibling
  // directories like <root>/publicx. path.relative leaves only via ".." or an
  // absolute jump.
  const relCheck = path.relative(PUBLIC_DIR, filePath);
  if (relCheck.startsWith('..') || path.isAbsolute(relCheck)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(filePath, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);
  const p = u.pathname;
  try {
    if (p === '/api/health') return sendJson(res, 200, { ok: true, time: Date.now() });

    // ---- auth (always reachable) ----
    if (p === '/api/auth/status') {
      return sendJson(res, 200, { pinSet: !!loadAuth(), authed: sessionValid(getCookie(req, 'sid')) });
    }
    if (p === '/api/auth/setup' && req.method === 'POST') {
      if (loadAuth()) return sendJson(res, 400, { error: 'A PIN is already set' });
      const b = await readBody(req); const pin = String(b.pin || '');
      if (!PIN_RE.test(pin)) return sendJson(res, 400, { error: 'PIN must be 4–12 digits' });
      await setPin(pin); setSessionCookie(res, newSession());
      return sendJson(res, 200, { ok: true });
    }
    if (p === '/api/auth/login' && req.method === 'POST') {
      const ip = req.socket.remoteAddress || 'unknown';
      const f = failState(ip);
      if (Date.now() < f.until) return sendJson(res, 429, { error: `Too many tries — wait ${Math.ceil((f.until - Date.now()) / 1000)}s` });
      const b = await readBody(req);
      if (await verifyPin(String(b.pin || ''))) { f.n = 0; setSessionCookie(res, newSession()); return sendJson(res, 200, { ok: true }); }
      f.n++;
      if (f.n >= 5) f.until = Date.now() + Math.min(300, 15 * (f.n - 4)) * 1000;
      return sendJson(res, 401, { error: 'Wrong PIN' });
    }
    if (p === '/api/auth/logout' && req.method === 'POST') {
      const t = getCookie(req, 'sid'); if (t) sessions.delete(t);
      res.setHeader('Set-Cookie', 'sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
      return sendJson(res, 200, { ok: true });
    }
    if (p === '/api/auth/change' && req.method === 'POST') {
      const b = await readBody(req);
      if (!sessionValid(getCookie(req, 'sid'))) return sendJson(res, 401, { error: 'Locked' });
      if (!(await verifyPin(String(b.current || '')))) return sendJson(res, 401, { error: 'Current PIN is wrong' });
      if (!PIN_RE.test(String(b.pin || ''))) return sendJson(res, 400, { error: 'New PIN must be 4–12 digits' });
      await setPin(String(b.pin));
      // A PIN rotation must invalidate every existing session (a stolen cookie
      // would otherwise survive the change). Re-issue one for this client.
      sessions.clear();
      setSessionCookie(res, newSession());
      return sendJson(res, 200, { ok: true });
    }
    // ---- gate everything else under /api/ behind a valid session ----
    // NOTE: the gate must fail CLOSED. When no PIN exists yet (fresh install, or
    // after deleting auth.json to reset a forgotten PIN) every /api route would
    // otherwise be wide open — so an unauthenticated caller is rejected here too.
    if (p.startsWith('/api/') && (!loadAuth() || !sessionValid(getCookie(req, 'sid')))) {
      return sendJson(res, 401, { error: 'Locked. Enter your PIN.' });
    }

    if (p === '/api/quote') {
      const symbols = (u.searchParams.get('symbols') || '').split(',').map((s) => s.trim()).filter(Boolean);
      if (!symbols.length) return sendJson(res, 400, { error: 'symbols required' });
      return sendJson(res, 200, { quotes: await getQuotes(symbols) });
    }
    if (p === '/api/history') {
      const symbol = u.searchParams.get('symbol');
      if (!symbol) return sendJson(res, 400, { error: 'symbol required' });
      return sendJson(res, 200, await getHistory(symbol, u.searchParams.get('range') || '1mo', u.searchParams.get('interval') || '1d'));
    }
    if (p === '/api/search') {
      const q = u.searchParams.get('q') || '';
      if (q.length < 1) return sendJson(res, 200, []);
      return sendJson(res, 200, await search(q));
    }
    if (p === '/api/markets') return sendJson(res, 200, await getMarkets());
    if (p === '/api/worldbank') {
      const country = u.searchParams.get('country') || 'WLD';
      const indicator = u.searchParams.get('indicator') || 'NY.GDP.MKTP.CD';
      return sendJson(res, 200, await worldBank(country, indicator));
    }
    if (p === '/api/fred') {
      return sendJson(res, 200, await getFred(
        u.searchParams.get('series') || 'DGS10',
        u.searchParams.get('transform') || 'lin',
        u.searchParams.get('start') || '2015-01-01'));
    }

    const base = u.searchParams.get('base') || 'SGD';
    const acct = u.searchParams.get('account') || undefined; // undefined -> active account

    // accounts
    if (p === '/api/accounts' && req.method === 'GET') return sendJson(res, 200, listAccounts());
    if (p === '/api/accounts/add' && req.method === 'POST') {
      const b = await readBody(req); const id = await accountAdd(b.name, b.type);
      return sendJson(res, 200, { ...listAccounts(), newId: id });
    }
    if (p === '/api/accounts/rename' && req.method === 'POST') {
      const b = await readBody(req); await accountRename(b.id, b.name, b.type);
      return sendJson(res, 200, listAccounts());
    }
    if (p === '/api/accounts/remove' && req.method === 'POST') {
      const b = await readBody(req); await accountRemove(b.id);
      return sendJson(res, 200, listAccounts());
    }

    if (p === '/api/portfolio' && req.method === 'GET') return sendJson(res, 200, await portfolioWithQuotes(base, acct));
    if (p === '/api/portfolio/buy' && req.method === 'POST') {
      const b = await readBody(req); await buy(b.symbol, b.quantity, b.price, b.date ? Date.parse(b.date) : null, acct, base);
      return sendJson(res, 200, await portfolioWithQuotes(base, acct));
    }
    if (p === '/api/portfolio/sell' && req.method === 'POST') {
      const b = await readBody(req); const r = await sell(b.symbol, b.quantity, b.price, acct, base);
      const pf = await portfolioWithQuotes(base, acct); pf.lastRealized = r.realized;
      return sendJson(res, 200, pf);
    }
    if (p === '/api/portfolio/delete' && req.method === 'POST') {
      const b = await readBody(req); await del(b.symbol, acct);
      return sendJson(res, 200, await portfolioWithQuotes(base, acct));
    }
    if (p === '/api/portfolio/import' && req.method === 'POST') {
      const b = await readBody(req); const r = await importCsv(b.csv, !!b.replace, acct, base);
      const pf = await portfolioWithQuotes(base, acct); pf.imported = r;
      return sendJson(res, 200, pf);
    }
    if (p === '/api/portfolio/reset' && req.method === 'POST') {
      await resetPortfolio(acct); return sendJson(res, 200, await portfolioWithQuotes(base, acct));
    }

    // watchlist
    if (p === '/api/watchlist' && req.method === 'GET') return sendJson(res, 200, { watchlist: await watchlistWithQuotes() });
    if (p === '/api/watchlist/add' && req.method === 'POST') {
      const b = await readBody(req); await watchAdd(b.symbol);
      return sendJson(res, 200, { watchlist: await watchlistWithQuotes() });
    }
    if (p === '/api/watchlist/remove' && req.method === 'POST') {
      const b = await readBody(req); await watchRemove(b.symbol);
      return sendJson(res, 200, { watchlist: await watchlistWithQuotes() });
    }

    // alerts
    if (p === '/api/alerts' && req.method === 'GET') return sendJson(res, 200, { alerts: await alertsWithStatus() });
    if (p === '/api/alerts/add' && req.method === 'POST') {
      const b = await readBody(req); await alertAdd(b);
      return sendJson(res, 200, { alerts: await alertsWithStatus() });
    }
    if (p === '/api/alerts/remove' && req.method === 'POST') {
      const b = await readBody(req); await alertRemove(b.id);
      return sendJson(res, 200, { alerts: await alertsWithStatus() });
    }

    // news
    if (p === '/api/news') return sendJson(res, 200, { news: await getNews(u.searchParams.get('symbol') || '') });

    // categories (sector) + portfolio performance (charts/heatmap)
    if (p === '/api/categories') {
      const symbols = (u.searchParams.get('symbols') || '').split(',').map((s) => s.trim()).filter(Boolean);
      if (!symbols.length) return sendJson(res, 200, {});
      return sendJson(res, 200, await getCategories(symbols));
    }
    if (p === '/api/dividends') {
      return sendJson(res, 200, await dividendsReport(base, acct));
    }
    if (p === '/api/portfolio/performance') {
      return sendJson(res, 200, await portfolioPerformance(u.searchParams.get('range') || '1y', base, acct));
    }
    if (p === '/api/fx-risk') {
      return sendJson(res, 200, await fxRisk(base, acct));
    }
    if (p === '/api/calendar') {
      return sendJson(res, 200, await getCalendar());
    }

    if (p.startsWith('/api/')) return sendJson(res, 404, { error: 'Unknown endpoint' });
    return serveStatic(req, res, p);
  } catch (err) {
    return sendJson(res, 500, { error: String(err && err.message || err) });
  }
});

// Background alert checker — evaluates alerts on a timer and fires desktop
// notifications even when no browser is open. Override cadence with ALERT_INTERVAL (seconds).
const ALERT_INTERVAL = Math.max(15, Number(process.env.ALERT_INTERVAL) || 60) * 1000;
setInterval(() => { evaluateAlerts(true).catch(() => {}); }, ALERT_INTERVAL);

server.listen(PORT, HOST, () => {
  console.log(`\n  FINSIGHT // PERSONAL TERMINAL`);
  console.log(`  running at  http://localhost:${PORT}  (bound to ${HOST})`);
  console.log(`  portfolio   ${PORTFOLIO_FILE}`);
  console.log(`  data        free / no-key (Yahoo Finance, World Bank, FRED)`);
  console.log(`  alerts      background check every ${ALERT_INTERVAL / 1000}s` +
    (process.env.NOTIFY === '0' ? ' (desktop notifications off)' : ' → macOS notifications') + `\n`);
});

// A busy port must not crash-loop under launchd KeepAlive; explain and exit cleanly.
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`FINSIGHT failed to start: port ${PORT} is already in use.\n` +
      `  Is another instance running? Try:  PORT=9000 node server.js`);
    process.exit(1);
  }
  console.error('FINSIGHT server error:', e.message);
  process.exit(1);
});

// Graceful shutdown so in-flight requests finish and no temp files are stranded.
function shutdown(sig) {
  console.log(`\n${sig} received — closing server…`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
