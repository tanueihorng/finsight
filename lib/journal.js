'use strict';
// Trade journal / log: ideas, paper, replay and live trades with plan, exits,
// rule-following and an optional chart snapshot. Stored in DATA_DIR/journal.json
// with images in DATA_DIR/journal-img/. Records only — never places orders.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA_DIR } = require('./config');

const FILE = () => path.join(DATA_DIR, 'journal.json');
const IMG_DIR = () => path.join(DATA_DIR, 'journal-img');
const KINDS = ['idea', 'paper', 'replay', 'live'];
const STATUSES = ['watching', 'open', 'closed', 'cancelled'];
const RULES = ['', 'yes', 'partial', 'no'];
const ID_RE = /^[a-f0-9]{16}$/;
const MAX_IMG = 6e6;

function load() {
  try { const d = JSON.parse(fs.readFileSync(FILE(), 'utf8')); return Array.isArray(d.entries) ? d.entries : []; } catch { return []; }
}
function save(entries) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = FILE() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ version: 1, entries }, null, 1), { mode: 0o600 });
  fs.renameSync(tmp, FILE());
}

const num = (v) => (v === '' || v == null ? null : Number(v));
const str = (v, n) => (v == null ? '' : String(v).slice(0, n));
function finiteOrNull(v, name) {
  const x = num(v);
  if (x == null) return null;
  if (!isFinite(x)) throw new Error(`${name} must be a number`);
  return x;
}

// Normalise + validate user input into a stored entry (without derived metrics).
function sanitize(input, prev) {
  const e = Object.assign({}, prev || {});
  const s = input || {};
  e.symbol = str(s.symbol ?? e.symbol, 24).trim().toUpperCase();
  if (!/^[A-Z0-9.^=\-_:]{1,24}$/.test(e.symbol)) throw new Error('Symbol required');
  e.kind = KINDS.includes(s.kind) ? s.kind : (e.kind || 'idea');
  e.status = STATUSES.includes(s.status) ? s.status : (e.status || 'watching');
  e.side = s.side === 'short' ? 'short' : s.side === 'long' ? 'long' : (e.side || 'long');
  e.interval = str(s.interval ?? e.interval, 8);
  e.setup = str(s.setup ?? e.setup, 120);
  e.tags = (Array.isArray(s.tags) ? s.tags : String(s.tags ?? (e.tags || []).join(',')).split(','))
    .map((t) => String(t).trim().slice(0, 30)).filter(Boolean).slice(0, 12);
  for (const k of ['entry', 'stop', 'target', 'qty', 'fees']) e[k] = finiteOrNull(k in s ? s[k] : e[k], k);
  if (e.qty != null && e.qty < 0) throw new Error('qty must be positive');
  if (e.fees != null && e.fees < 0) throw new Error('fees must be positive');
  const exits = Array.isArray(s.exits) ? s.exits : (e.exits || []);
  e.exits = exits.slice(0, 20).map((x) => {
    const px = finiteOrNull(x.price, 'exit price'), q = finiteOrNull(x.qty, 'exit qty');
    if (px == null || q == null || px <= 0 || q <= 0) throw new Error('Each exit needs a positive price and quantity');
    return { date: str(x.date, 25), price: px, qty: q, note: str(x.note, 80) };
  });
  e.entryDate = str(s.entryDate ?? e.entryDate, 25);
  e.rule = RULES.includes(s.rule) ? s.rule : (e.rule || '');
  e.notes = str(s.notes ?? e.notes, 5000);
  e.lesson = str(s.lesson ?? e.lesson, 2000);
  e.chartAt = finiteOrNull(s.chartAt ?? e.chartAt, 'chartAt');
  e.price = finiteOrNull(s.price ?? e.price, 'price');
  e.ledgerRef = str(s.ledgerRef ?? e.ledgerRef, 80);
  if (e.entry != null && e.stop != null) {
    if (e.side === 'long' && !(e.stop < e.entry)) throw new Error('Long stop must be below entry');
    if (e.side === 'short' && !(e.stop > e.entry)) throw new Error('Short stop must be above entry');
  }
  const exited = e.exits.reduce((a, x) => a + x.qty, 0);
  if (e.qty != null && exited > e.qty + 1e-9) throw new Error('Exits exceed position quantity');
  return e;
}

// Derived plan/outcome metrics. R is measured on the INITIAL stop.
function metrics(e) {
  const m = { riskPerUnit: null, stopPct: null, plannedRR: null, riskAmount: null, exitedQty: 0, remaining: null, avgExit: null, netPnl: null, netR: null, closed: false };
  const sgn = e.side === 'short' ? -1 : 1;
  if (e.entry != null && e.stop != null) {
    m.riskPerUnit = Math.abs(e.entry - e.stop);
    m.stopPct = m.riskPerUnit / e.entry * 100;
    if (e.target != null && m.riskPerUnit > 0) m.plannedRR = sgn * (e.target - e.entry) / m.riskPerUnit;
    if (e.qty != null) m.riskAmount = m.riskPerUnit * e.qty;
  }
  m.exitedQty = e.exits.reduce((a, x) => a + x.qty, 0);
  if (m.exitedQty > 0) m.avgExit = e.exits.reduce((a, x) => a + x.qty * x.price, 0) / m.exitedQty;
  if (e.qty != null) m.remaining = Math.max(0, e.qty - m.exitedQty);
  m.closed = e.status === 'closed' || (e.qty != null && e.qty > 0 && m.remaining === 0);
  if (e.entry != null && m.exitedQty > 0) {
    m.netPnl = sgn * e.exits.reduce((a, x) => a + x.qty * (x.price - e.entry), 0) - (e.fees || 0);
    if (m.closed && m.riskPerUnit > 0 && e.qty) m.netR = m.netPnl / (m.riskPerUnit * e.qty);
  }
  return m;
}

function withMetrics(e) { return Object.assign({}, e, { m: metrics(e), hasImage: fs.existsSync(path.join(IMG_DIR(), e.id + '.png')) }); }

function list() { return load().map(withMetrics).sort((a, b) => b.created - a.created); }

function create(input) {
  const e = sanitize(input);
  e.id = crypto.randomBytes(8).toString('hex');
  e.created = e.updated = Date.now();
  const all = load(); all.push(e); save(all);
  return withMetrics(e);
}

function update(id, input) {
  if (!ID_RE.test(String(id))) throw new Error('Bad id');
  const all = load(), i = all.findIndex((x) => x.id === id);
  if (i < 0) throw new Error('Entry not found');
  const e = sanitize(input, all[i]);
  e.id = id; e.created = all[i].created; e.updated = Date.now();
  all[i] = e; save(all);
  return withMetrics(e);
}

function remove(id) {
  if (!ID_RE.test(String(id))) throw new Error('Bad id');
  const all = load(), next = all.filter((x) => x.id !== id);
  if (next.length === all.length) return false;
  save(next);
  try { fs.unlinkSync(path.join(IMG_DIR(), id + '.png')); } catch {}
  return true;
}

function saveImage(id, dataUrl) {
  if (!ID_RE.test(String(id))) throw new Error('Bad id');
  if (!load().some((x) => x.id === id)) throw new Error('Entry not found');
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) throw new Error('Expected a PNG data URL');
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length > MAX_IMG) throw new Error('Image too large');
  if (buf.slice(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('Not a PNG');
  fs.mkdirSync(IMG_DIR(), { recursive: true });
  fs.writeFileSync(path.join(IMG_DIR(), id + '.png'), buf, { mode: 0o600 });
  return true;
}

function imagePath(id) {
  if (!ID_RE.test(String(id))) return null;
  const p = path.join(IMG_DIR(), id + '.png');
  return fs.existsSync(p) ? p : null;
}

// Aggregate closed-trade statistics in R, optionally by kind.
function stats(entries) {
  const closed = entries.filter((e) => e.m && e.m.netR != null);
  const Rs = closed.map((e) => e.m.netR);
  if (!Rs.length) return { n: 0 };
  const wins = Rs.filter((r) => r > 0), losses = Rs.filter((r) => r <= 0);
  const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  const ordered = closed.slice().sort((a, b) => a.updated - b.updated).map((e) => e.m.netR);
  let streak = 0, cur = 0;
  for (const r of ordered) { cur = r <= 0 ? cur + 1 : 0; streak = Math.max(streak, cur); }
  const ruled = closed.filter((e) => e.rule);
  return { n: Rs.length, winRate: wins.length / Rs.length, avgWin: wins.length ? mean(wins) : null, avgLoss: losses.length ? mean(losses) : null,
    expectancy: mean(Rs), totalR: Rs.reduce((s, x) => s + x, 0), maxLossStreak: streak,
    ruleRate: ruled.length ? ruled.filter((e) => e.rule === 'yes').length / ruled.length : null };
}

const CSV_COLS = ['created', 'symbol', 'kind', 'status', 'side', 'interval', 'setup', 'tags', 'entryDate', 'entry', 'stop', 'target', 'qty', 'fees', 'exits', 'riskPerUnit', 'plannedRR', 'netPnl', 'netR', 'rule', 'notes', 'lesson'];
function toCsv(entries) {
  const q = (v) => { if (typeof v === 'number') return String(v); const s = v == null ? '' : String(v); return /[",\n]/.test(s) || /^[=+\-@]/.test(s) ? '"' + s.replace(/"/g, '""').replace(/^([=+\-@])/, "'$1") + '"' : s; };
  const rows = entries.map((e) => [new Date(e.created).toISOString(), e.symbol, e.kind, e.status, e.side, e.interval, e.setup, e.tags.join('|'), e.entryDate,
    e.entry, e.stop, e.target, e.qty, e.fees, e.exits.map((x) => `${x.date} ${x.qty}@${x.price}`).join('; '),
    e.m.riskPerUnit, e.m.plannedRR, e.m.netPnl, e.m.netR, e.rule, e.notes, e.lesson].map(q).join(','));
  return [CSV_COLS.join(',')].concat(rows).join('\n');
}

module.exports = { list, create, update, remove, saveImage, imagePath, stats, metrics, sanitize, toCsv, KINDS, STATUSES };
