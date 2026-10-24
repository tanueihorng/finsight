// SSRF guard for fetching arbitrary URLs. The IP check happens inside the
// socket's DNS lookup, so the address that is checked is the address that is
// connected to (no time-of-check/time-of-use gap). Redirects are followed
// manually and every hop is checked again.
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import zlib from 'node:zlib';
import { AgentError } from '../types.ts';

const blocked = new net.BlockList();
for (const [a, p] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 4], ['240.0.0.0', 4]] as const) blocked.addSubnet(a, p, 'ipv4');
for (const [a, p] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['2001:db8::', 32], ['100::', 64], ['64:ff9b:1::', 48], ['2002::', 16]] as const) blocked.addSubnet(a, p, 'ipv6');

export function isBlockedIp(ip: string): boolean {
  const fam = net.isIP(ip);
  if (fam === 4) return blocked.check(ip, 'ipv4');
  if (fam === 6) {
    const low = ip.toLowerCase();
    const mapped = low.match(/^(?:::ffff:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/); // v4-mapped / NAT64 forms
    if (mapped) return isBlockedIp(mapped[1]!);
    // net.BlockList also matches IPv4 against ::ffff:0:0/96 rules, so mapped and NAT64 forms are decoded here instead.
    const hexMapped = low.match(/^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hexMapped) { const n = (parseInt(hexMapped[1]!, 16) << 16) | parseInt(hexMapped[2]!, 16); return isBlockedIp([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.')); }
    return blocked.check(ip, 'ipv6');
  }
  return true;
}

const guardedLookup: net.LookupFunction = (hostname, options, cb) => {
  dns.lookup(hostname, { all: true, verbatim: true }, (err, addrs) => {
    if (err) return (cb as any)(err);
    const list = addrs as dns.LookupAddress[];
    const bad = list.find((a) => isBlockedIp(a.address));
    if (bad || !list.length) return (cb as any)(new AgentError('SSRF_BLOCKED', `Blocked: ${hostname} resolves to a private or local address`));
    if ((options as any).all) return (cb as any)(null, list);
    return (cb as any)(null, list[0]!.address, list[0]!.family);
  });
};

export type FetchedDoc = { finalUrl: string; status: number; contentType: string; body: Buffer };

const ALLOWED_TYPES = /^(text\/(html|plain|xml|csv|markdown)|application\/(json|xml|xhtml\+xml|rss\+xml|atom\+xml|pdf))/i;

export async function guardedFetch(url: string, opts: { maxBytes?: number; timeoutMs?: number; maxRedirects?: number; signal?: AbortSignal; headers?: Record<string, string> } = {}): Promise<FetchedDoc> {
  const maxBytes = opts.maxBytes ?? 10 * 1024 * 1024, timeoutMs = opts.timeoutMs ?? 20_000, maxRedirects = opts.maxRedirects ?? 5;
  let current = url;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    let u: URL;
    try { u = new URL(current); } catch { throw new AgentError('BAD_URL', `Invalid URL: ${current}`); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new AgentError('SSRF_BLOCKED', 'Only http(s) URLs are allowed');
    if (u.username || u.password) throw new AgentError('SSRF_BLOCKED', 'URLs with credentials are not allowed');
    const host = u.hostname.replace(/^\[|\]$/g, '');
    if (net.isIP(host) && isBlockedIp(host)) throw new AgentError('SSRF_BLOCKED', `Blocked private or local address ${host}`);
    if (/^(localhost|.*\.localhost|.*\.local|.*\.internal)$/i.test(host)) throw new AgentError('SSRF_BLOCKED', `Blocked local hostname ${host}`);
    const res = await requestOnce(u, { maxBytes, timeoutMs, signal: opts.signal, headers: opts.headers });
    if (res.status >= 300 && res.status < 400 && res.location) { current = new URL(res.location, u).toString(); continue; }
    return { finalUrl: u.toString(), status: res.status, contentType: res.contentType, body: res.body };
  }
  throw new AgentError('TOO_MANY_REDIRECTS', `More than ${maxRedirects} redirects`);
}

function requestOnce(u: URL, o: { maxBytes: number; timeoutMs: number; signal?: AbortSignal; headers?: Record<string, string> }):
  Promise<{ status: number; contentType: string; location?: string; body: Buffer }> {
  const lib = u.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.request(u, {
      method: 'GET', lookup: guardedLookup, timeout: o.timeoutMs, signal: o.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (FinSight-Agent research)', 'Accept': 'text/html,application/xhtml+xml,application/json,application/pdf,text/plain;q=0.9,*/*;q=0.5', 'Accept-Encoding': 'gzip, deflate, br', ...o.headers },
    }, (res) => {
      const status = res.statusCode || 0;
      const contentType = String(res.headers['content-type'] || '');
      if (status >= 300 && status < 400) { res.resume(); return resolve({ status, contentType, location: String(res.headers.location || ''), body: Buffer.alloc(0) }); }
      if (status < 400 && contentType && !ALLOWED_TYPES.test(contentType)) { res.destroy(); return reject(new AgentError('CONTENT_TYPE_BLOCKED', `Content type ${contentType} not allowed`)); }
      const declared = Number(res.headers['content-length'] || 0);
      if (declared > o.maxBytes) { res.destroy(); return reject(new AgentError('TOO_LARGE', 'Response too large')); }
      const enc = String(res.headers['content-encoding'] || '');
      const stream = enc.includes('br') ? res.pipe(zlib.createBrotliDecompress()) : enc.includes('gzip') ? res.pipe(zlib.createGunzip()) : enc.includes('deflate') ? res.pipe(zlib.createInflate()) : res;
      const chunks: Buffer[] = []; let size = 0;
      stream.on('data', (c: Buffer) => { size += c.length; if (size > o.maxBytes) { res.destroy(); reject(new AgentError('TOO_LARGE', 'Response too large')); } else chunks.push(c); });
      stream.on('end', () => resolve({ status, contentType, body: Buffer.concat(chunks) }));
      stream.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new AgentError('FETCH_TIMEOUT', 'Fetch timed out')));
    req.on('error', (e) => reject(e instanceof AgentError ? e : (e as any)?.cause instanceof AgentError ? (e as any).cause : new AgentError('FETCH_FAILED', String(e.message))));
    req.end();
  });
}
