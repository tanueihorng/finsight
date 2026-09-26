'use strict';
// Paths + runtime settings shared by every module.
const path = require('path');

const ROOT = path.join(__dirname, '..');
// FINSIGHT_DATA_DIR lets tests (or a second profile) point at a different store.
const DATA_DIR = process.env.FINSIGHT_DATA_DIR ? path.resolve(process.env.FINSIGHT_DATA_DIR) : path.join(ROOT, 'data');

module.exports = {
  PORT: process.env.PORT || 8000,
  // Bind loopback only: this app holds your full portfolio and has no HTTPS, so it
  // must not be reachable from other machines on the network. Set HOST=0.0.0.0
  // only if you genuinely understand the exposure.
  HOST: process.env.HOST || '127.0.0.1',
  ROOT,
  PUBLIC_DIR: path.join(ROOT, 'public'),
  DATA_DIR,
  PORTFOLIO_FILE: path.join(DATA_DIR, 'portfolio.json'),
  AUTH_FILE: path.join(DATA_DIR, 'auth.json'),
  // NOTE: a "rich" desktop Chrome UA triggers Yahoo bot-detection (HTTP 429) from
  // server-side fetch. A minimal UA is accepted. Keep this simple.
  UA: 'Mozilla/5.0',
};
