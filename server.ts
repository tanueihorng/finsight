/*
 * FINSIGHT // PERSONAL TERMINAL  -  backend
 * ----------------------------------------------------------------------------
 * Zero-dependency Node.js server (built-in http + native fetch, Node 24+;
 * Node runs this TypeScript directly, `npm run typecheck` checks it).
 *   - Proxies FREE, no-key data sources (Yahoo Finance, World Bank, FRED)
 *   - Stores your portfolio locally in data/portfolio.json
 *   - Serves the terminal UI from public/
 * Logic lives in lib/; this file is only the HTTP layer.
 *
 * Run:   node server.ts          then open http://localhost:8000
 */

import http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { URL } from 'node:url';

import { PORT, HOST, PUBLIC_DIR, PORTFOLIO_FILE } from './lib/config.ts';
import { persistNow } from './lib/cache.ts';
import { getQuotes, getHistory, search, getMarkets, getNews, getCategories } from './lib/market.ts';
import { worldBank, getFred, getCalendar } from './lib/macro.ts';
import {
  buy, sell, del, listAccounts, accountAdd, accountRename, accountRemove, portfolioWithQuotes, fxRisk, setCash,
  watchlistWithQuotes, watchAdd, watchRemove, alertAdd, alertUpdate, alertRemove, evaluateAlerts,
  alertsWithStatus, importCsv, resetPortfolio,
} from './lib/portfolio.ts';
import { dividendsReport, upcomingEvents, setWithholding } from './lib/dividends.ts';
import { chartTrades, ledger, editBuy, deleteBuy, realizedReport } from './lib/ledger.ts';
import { undo, undoInfo } from './lib/store.ts';
import * as charts from './lib/charts.ts';
import * as journal from './lib/journal.ts';
import { portfolioPerformance } from './lib/performance.ts';
import {
  sessions, failState, loadAuth, setPin, verifyPin, newSession, sessionValid, getCookie, setSessionCookie, PIN_RE,
} from './lib/auth.ts';
import * as agentlink from './lib/agentlink.ts';
import * as agentproc from './lib/agentproc.ts';

/** A parsed JSON request body: untrusted, {} when missing or malformed. The lib functions validate it. */
type Body = Record<string, any>;

// --------------------------------------------------------------------------
// HTTP server
// --------------------------------------------------------------------------
function sendJson(res: ServerResponse, status: number, obj: unknown): void {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(body);
}
function readBody(req: IncomingMessage): Promise<Body> {
  return new Promise((resolve) => {
    // Collect Buffers, not strings: a multi-byte UTF-8 character split across
    // two chunks would be corrupted if each chunk were decoded on its own.
    const chunks: Buffer[] = [];
    let size = 0, done = false;
    const finish = (v: Body) => { if (!done) { done = true; resolve(v); } }; // always settle, even on teardown
    const MAX = 25e6; // big enough for full broker statements
    req.on('data', (c: Buffer) => { chunks.push(c); size += c.length; if (size > MAX) { req.destroy(); finish({}); } });
    req.on('end', () => {
      try { const body = Buffer.concat(chunks).toString('utf8'); finish(body ? JSON.parse(body) : {}); }
      catch { finish({}); }
    });
    req.on('aborted', () => finish({}));
    req.on('error', () => finish({}));
    req.on('close', () => finish({}));
  });
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2',
};
// Content-hashed build chunks (esbuild's 8-character hash) never change under
// the same URL, so the browser may keep them without asking again (H1).
const HASHED_CHUNK = /^\/app\/chunks\/[^/]+-[A-Z0-9]{8}\.(js|css)$/;
function serveStatic(req: IncomingMessage, res: ServerResponse, pathname: string): void {
  let rel = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  // Structural containment: a plain prefix check would also accept sibling
  // directories like <root>/publicx. path.relative leaves only via ".." or an
  // absolute jump.
  const relCheck = path.relative(PUBLIC_DIR, filePath);
  if (relCheck.startsWith('..') || path.isAbsolute(relCheck)) { res.writeHead(403); return void res.end('Forbidden'); }
  fs.stat(filePath, (serr, st) => {
    if (serr || !st.isFile()) { res.writeHead(404); return void res.end('Not found'); }
    // no-cache = revalidate each load, so UI updates (and sw.js) are never stuck;
    // the ETag lets an unchanged file answer 304 with no body.
    const etag = 'W/"' + st.size.toString(36) + '-' + Math.floor(st.mtimeMs).toString(36) + '"';
    const cache = HASHED_CHUNK.test(rel) ? 'public, max-age=31536000, immutable' : 'no-cache';
    const head = { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream', 'Cache-Control': cache, ETag: etag };
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, head); return void res.end(); }
    fs.readFile(filePath, (err, buf) => {
      if (err) { res.writeHead(404); return void res.end('Not found'); }
      res.writeHead(200, head);
      res.end(buf);
    });
  });
}

const server = http.createServer(async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  // Applied to every response: the terminal must not be framed or MIME-sniffed.
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // DNS-rebinding defense: when bound to loopback, only answer requests whose
  // Host is this machine (a rebound origin would not carry the session cookie,
  // but rejecting the host outright closes the class). HOST=0.0.0.0 is a
  // deliberate LAN exposure and opts out of this check.
  if (HOST === '127.0.0.1' || HOST === '::1' || HOST === 'localhost') {
    const h = String(req.headers.host || '').toLowerCase();
    const name = h.startsWith('[') ? h.slice(0, h.indexOf(']') + 1) : h.split(':')[0];
    if (name !== 'localhost' && name !== '127.0.0.1' && name !== '[::1]' && name !== '::1') {
      res.writeHead(403);
      return void res.end('Forbidden');
    }
  }
  const u = new URL(req.url!, `http://${req.headers.host}`); // always set on a server request
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
    // The local agent's bearer token may read a fixed GET allowlist without a
    // session; a token on any other method or path is refused outright.
    const agentToken = p.startsWith('/api/') ? agentlink.tokenCheck(req, p) : 'none';
    if (agentToken === 'deny') return sendJson(res, 403, { error: 'Agent token not allowed here' });
    // Fails closed before a PIN exists, for the token too.
    if (p.startsWith('/api/') && (!loadAuth() || (agentToken !== 'ok' && !sessionValid(getCookie(req, 'sid'))))) {
      return sendJson(res, 401, { error: 'Locked. Enter your PIN.' });
    }

    if (p === '/api/agent-status' && req.method === 'GET') return sendJson(res, 200, agentproc.status());
    // ---- chat panel -> local agent service (session-gated proxy, SSE passthrough) ----
    if (p.startsWith('/api/agent/')) return agentlink.proxy(req, res, p, u.search);

    // ---- chart workspace (drawings, layouts) + trade journal ----
    if (p.startsWith('/api/charts/') || p.startsWith('/api/journal')) {
      try {
        if (p === '/api/charts/drawings' && req.method === 'GET') return sendJson(res, 200, { drawings: charts.getDrawings(u.searchParams.get('symbol')) });
        if (p === '/api/charts/drawings' && req.method === 'POST') { const b = await readBody(req); return sendJson(res, 200, { ok: true, count: charts.putDrawings(b.symbol, b.drawings) }); }
        if (p === '/api/charts/layouts' && req.method === 'GET') return sendJson(res, 200, charts.getLayouts());
        if (p === '/api/charts/current' && req.method === 'POST') { const b = await readBody(req); charts.putCurrent(b.cfg); return sendJson(res, 200, { ok: true }); }
        if (p === '/api/charts/layouts/save' && req.method === 'POST') { const b = await readBody(req); charts.saveLayout(b.name, b.cfg); return sendJson(res, 200, charts.getLayouts()); }
        if (p === '/api/charts/layouts/delete' && req.method === 'POST') { const b = await readBody(req); charts.deleteLayout(b.name); return sendJson(res, 200, charts.getLayouts()); }
        if (p === '/api/journal' && req.method === 'GET') {
          const entries = journal.list(), byKind: Record<string, ReturnType<typeof journal.stats>> = {};
          journal.KINDS.forEach((k) => { byKind[k] = journal.stats(entries.filter((e) => e.kind === k)); });
          return sendJson(res, 200, { entries, stats: journal.stats(entries), byKind });
        }
        if (p === '/api/journal/create' && req.method === 'POST') return sendJson(res, 200, { entry: journal.create(await readBody(req)) });
        if (p === '/api/journal/update' && req.method === 'POST') { const b = await readBody(req); return sendJson(res, 200, { entry: journal.update(b.id, b.entry) }); }
        if (p === '/api/journal/delete' && req.method === 'POST') { const b = await readBody(req); return sendJson(res, 200, { ok: journal.remove(b.id) }); }
        if (p === '/api/journal/image' && req.method === 'POST') { const b = await readBody(req); journal.saveImage(b.id, b.dataUrl); return sendJson(res, 200, { ok: true }); }
        if (p === '/api/journal/image' && req.method === 'GET') {
          const f = journal.imagePath(u.searchParams.get('id'));
          if (!f) return sendJson(res, 404, { error: 'No image' });
          res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
          return void fs.createReadStream(f).pipe(res);
        }
        if (p === '/api/journal/csv' && req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="finsight-journal.csv"', 'Cache-Control': 'no-store' });
          return void res.end(journal.toCsv(journal.list()));
        }
      } catch (err) {
        return sendJson(res, 400, { error: String(err && (err as Error).message || err) });
      }
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
    // Many symbols in one call (strategy scans): shares the history cache, bounded fan-out.
    if (p === '/api/history/batch') {
      const symbols = [...new Set((u.searchParams.get('symbols') || '').split(',').map((s) => s.trim()).filter(Boolean))];
      if (!symbols.length) return sendJson(res, 400, { error: 'symbols required' });
      if (symbols.length > 200) return sendJson(res, 400, { error: 'at most 200 symbols' });
      const range = u.searchParams.get('range') || '1y', interval = u.searchParams.get('interval') || '1d';
      const results: Record<string, unknown> = {}; let i = 0;
      await Promise.all(Array.from({ length: Math.min(6, symbols.length) }, async () => {
        while (i < symbols.length) {
          const s = symbols[i++]!;
          try { results[s.toUpperCase()] = await getHistory(s, range, interval); }
          catch (e) { results[s.toUpperCase()] = { error: String(e && (e as Error).message || e) }; }
        }
      }));
      return sendJson(res, 200, { range, interval, results });
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
      const b = await readBody(req); const r = await sell(b.symbol, b.quantity, b.price, acct, base, b.date ? Date.parse(b.date) : null);
      const pf = { ...await portfolioWithQuotes(base, acct), lastRealized: r.realized };
      return sendJson(res, 200, pf);
    }
    if (p === '/api/portfolio/delete' && req.method === 'POST') {
      const b = await readBody(req); await del(b.symbol, acct);
      return sendJson(res, 200, await portfolioWithQuotes(base, acct));
    }
    if (p === '/api/portfolio/import' && req.method === 'POST') {
      const b = await readBody(req); const r = await importCsv(b.csv, !!b.replace, acct, base);
      const pf = { ...await portfolioWithQuotes(base, acct), imported: r };
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
    if (p === '/api/alerts/update' && req.method === 'POST') {
      const b = await readBody(req); await alertUpdate(b);
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
    if (p === '/api/events') return sendJson(res, 200, await upcomingEvents(acct));
    if (p === '/api/settings/withholding' && req.method === 'POST') {
      const b = await readBody(req); return sendJson(res, 200, { withholding: await setWithholding(b.market, b.pct) });
    }
    if (p === '/api/cash' && req.method === 'POST') {
      const b = await readBody(req); await setCash(b.ccy, b.amount, acct);
      return sendJson(res, 200, await portfolioWithQuotes(base, acct));
    }

    // ledger, realized report, undo
    if (p === '/api/chart-trades' && req.method === 'GET') return sendJson(res, 200, chartTrades(u.searchParams.get('symbol'), acct));
    if (p === '/api/ledger' && req.method === 'GET') return sendJson(res, 200, await ledger(base, acct));
    if (p === '/api/ledger/edit' && req.method === 'POST') {
      const b = await readBody(req); return sendJson(res, 200, await editBuy(b.id, b, base));
    }
    if (p === '/api/ledger/delete' && req.method === 'POST') {
      const b = await readBody(req); return sendJson(res, 200, await deleteBuy(b.id));
    }
    if (p === '/api/realized') return sendJson(res, 200, await realizedReport(base, acct));
    if (p === '/api/undo' && req.method === 'GET') return sendJson(res, 200, undoInfo());
    if (p === '/api/undo' && req.method === 'POST') return sendJson(res, 200, await undo());
    if (p === '/api/portfolio/performance') {
      return sendJson(res, 200, await portfolioPerformance(u.searchParams.get('range') || '1y', base, acct, u.searchParams.get('benchmark') || undefined));
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
    return sendJson(res, 500, { error: String(err && (err as Error).message || err) });
  }
});

// Background alert checker — evaluates alerts on a timer and fires desktop
// notifications even when no browser is open. Override cadence with ALERT_INTERVAL (seconds).
const ALERT_INTERVAL = Math.max(15, Number(process.env.ALERT_INTERVAL) || 60) * 1000;
setInterval(() => { evaluateAlerts(true).catch(() => {}); }, ALERT_INTERVAL);

agentlink.ensureLink(); // creates DATA_DIR/agent-link.json (0600) for the optional local agent
// PORT may be a numeric string from the environment; listen() accepts that.
server.listen(PORT as number, HOST, () => {
  console.log(`\n  FINSIGHT // PERSONAL TERMINAL`);
  console.log(`  running at  http://localhost:${PORT}  (bound to ${HOST})`);
  console.log(`  portfolio   ${PORTFOLIO_FILE}`);
  console.log(`  data        free / no-key (Yahoo Finance, World Bank, FRED)`);
  console.log(`  alerts      background check every ${ALERT_INTERVAL / 1000}s` +
    (process.env.NOTIFY === '0' ? ' (desktop notifications off)' : ' → macOS notifications'));
  agentproc.start(PORT).then((s) => {
    const msg = ({ running: `started (log: ${agentproc.status().logFile})`, external: s.message, disabled: 'off (AGENT_AUTOSTART=0)', 'not-installed': 'not installed: run  npm run agent:install' } as Record<string, string>)[s.status] || s.message;
    console.log(`  agent       ${msg}\n`);
  }).catch((e) => console.log(`  agent       failed to start: ${e.message}\n`));
});

// A busy port must not crash-loop under launchd KeepAlive; explain and exit cleanly.
server.on('error', (e: NodeJS.ErrnoException) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`FINSIGHT failed to start: port ${PORT} is already in use.\n` +
      `  Is another instance running? Try:  PORT=9000 node server.ts`);
    process.exit(1);
  }
  console.error('FINSIGHT server error:', e.message);
  process.exit(1);
});

// Graceful shutdown so in-flight requests finish and no temp files are stranded.
function shutdown(sig: string) {
  console.log(`\n${sig} received — closing server…`);
  persistNow(); // keep the warm cache for the next start
  agentproc.stop().finally(() => server.close(() => process.exit(0)));
  setTimeout(() => process.exit(0), 4000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGHUP', () => shutdown('SIGHUP')); // Terminal window closed: stop the agent too
