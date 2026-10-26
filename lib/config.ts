// Paths + runtime settings shared by every module.
import path from 'node:path';

export const ROOT = path.join(import.meta.dirname, '..');
// FINSIGHT_DATA_DIR lets tests (or a second profile) point at a different store.
export const DATA_DIR = process.env.FINSIGHT_DATA_DIR ? path.resolve(process.env.FINSIGHT_DATA_DIR) : path.join(ROOT, 'data');

export const PORT: string | number = process.env.PORT || 8000;
// Bind loopback only: this app holds your full portfolio and has no HTTPS, so it
// must not be reachable from other machines on the network. Set HOST=0.0.0.0
// only if you genuinely understand the exposure.
export const HOST = process.env.HOST || '127.0.0.1';
export const PUBLIC_DIR = path.join(ROOT, 'public');
export const PORTFOLIO_FILE = path.join(DATA_DIR, 'portfolio.json');
export const AUTH_FILE = path.join(DATA_DIR, 'auth.json');
// NOTE: a "rich" desktop Chrome UA triggers Yahoo bot-detection (HTTP 429) from
// server-side fetch. A minimal UA is accepted. Keep this simple.
export const UA = 'Mozilla/5.0';
