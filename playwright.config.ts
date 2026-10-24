// E2E: a throwaway FinSight on port 8099 with fake market data, a fresh temp
// data folder per run, and the agent switched off. Never touches ~/FinSightData.
import { defineConfig, devices } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Workers re-load this file; reuse the folder the main process created.
process.env.FINSIGHT_E2E_DIR ||= fs.mkdtempSync(path.join(os.tmpdir(), 'finsight-e2e-'));
const DATA = process.env.FINSIGHT_E2E_DIR;
const PORT = 8099;

export default defineConfig({
  testDir: 'web/e2e',
  // One server and one data folder: specs run in order, one at a time.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: [['list']],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
    viewport: { width: 1600, height: 1000 },
  },
  projects: [{ name: 'chromium' }],
  webServer: {
    command: 'node server.js',
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      FINSIGHT_FAKE_MARKET: '1',
      FINSIGHT_DATA_DIR: DATA,
      PORT: String(PORT),
      AGENT_AUTOSTART: '0',
      // A closed port, so E2E never talks to a real Kestrel agent on 8100.
      AGENT_URL: 'http://127.0.0.1:9',
      AGENT_HOME: path.join(DATA, 'agent'),
      RECORDS_DIR: path.join(DATA, 'records'),
      NOTIFY: '0',
    },
  },
});
