'use strict';
const fs = require('fs');
const crypto = require('crypto');
const { DATA_DIR, AUTH_FILE } = require('./config');

// --------------------------------------------------------------------------
// PIN lock — gates the API (UI shell stays public). The PIN is scrypt-hashed
// in data/auth.json; sessions live in memory so they clear on server restart.
// --------------------------------------------------------------------------
const SESSION_TTL = (Number(process.env.LOCK_IDLE_MIN) || 480) * 60 * 1000; // idle timeout
const sessions = new Map();
// Per-IP brute-force throttle. A single shared counter let anyone who could reach
// the API lock the owner out; keying by source address contains the damage.
const loginFails = new Map(); // ip -> { n, until }
function failState(ip) {
  let f = loginFails.get(ip);
  if (!f) { f = { n: 0, until: 0 }; loginFails.set(ip, f); }
  return f;
}
// Hourly janitor: stale sessions and throttle entries used to linger forever
// in this long-lived process (LaunchAgent runs for months). Sweep them.
setInterval(() => {
  const now = Date.now();
  for (const [t, s] of sessions) if (now - s.at > SESSION_TTL) sessions.delete(t);
  for (const [ip, f] of loginFails) if (now > f.until && f.n === 0) loginFails.delete(ip);
}, 60 * 60 * 1000).unref();
function loadAuth() { try { return JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8')); } catch { return null; } }
// Async scrypt keeps the ~50ms KDF off the event loop on the unauthenticated path.
function hashPin(pin, salt) {
  return new Promise((resolve, reject) =>
    crypto.scrypt(String(pin), String(salt), 32, (err, key) => (err ? reject(err) : resolve(key.toString('hex')))));
}
async function setPin(pin) {
  const salt = crypto.randomBytes(16).toString('hex');
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(AUTH_FILE, JSON.stringify({ salt, hash: await hashPin(pin, salt), createdAt: Date.now() }, null, 2));
}
async function verifyPin(pin) {
  const a = loadAuth(); if (!a) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(await hashPin(pin, a.salt), 'hex'), Buffer.from(a.hash, 'hex'));
  } catch { return false; }
}
function newSession() { const t = crypto.randomBytes(24).toString('hex'); sessions.set(t, { at: Date.now() }); return t; }
function sessionValid(t) {
  const s = t && sessions.get(t); if (!s) return false;
  if (Date.now() - s.at > SESSION_TTL) { sessions.delete(t); return false; }
  s.at = Date.now(); return true;
}
function getCookie(req, name) {
  const m = (req.headers.cookie || '').match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return m ? m[1] : null;
}
function setSessionCookie(res, token) { res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; SameSite=Strict; Path=/`); }
const PIN_RE = /^\d{4,12}$/;

module.exports = {
  sessions, failState, loadAuth, setPin, verifyPin, newSession, sessionValid, getCookie, setSessionCookie, PIN_RE,
};
