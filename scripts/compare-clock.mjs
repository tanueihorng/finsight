// Preloaded by compare-servers.mjs into both servers (`node --import`), so two
// runs of one scripted session are reproducible and can be compared exactly:
//   - the clock starts at COMPARE_T0 and moves forward exactly 1 s per incoming
//     HTTP request, staying constant within a request (same ties, same TTLs);
//   - Math.random is a fixed-seed generator (ids end in a random suffix).
// Timers still run on real time. Never loaded by the app itself.
import http from 'node:http';

const T0 = Number(process.env.COMPARE_T0);
if (!Number.isFinite(T0)) throw new Error('compare-clock: COMPARE_T0 is required');
let now = T0;
const RealDate = Date;
class VirtualDate extends RealDate {
  constructor(...a) { if (a.length) super(...a); else super(now); }
  static now() { return now; }
}
globalThis.Date = VirtualDate;

const emit = http.Server.prototype.emit;
http.Server.prototype.emit = function (event, ...rest) {
  if (event === 'request') now += 1000;
  return emit.call(this, event, ...rest);
};

let s = 0x9e3779b9;
Math.random = () => {
  s = (s + 0x6d2b79f5) | 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
