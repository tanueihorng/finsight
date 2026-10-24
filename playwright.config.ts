// E2E: throwaway FinSight servers with fake market data and fresh temp data
// folders per run. Never touches ~/FinSightData or a real Kestrel agent.
//   chromium  :8099  agent off (AGENT_URL is a closed port)      most specs
//   agent     :8098  -> fake agent :8097 (web/e2e/fake-agent.mjs) *.agent.spec.ts
//   sw        :8096  copy of the app in a temp folder, service    *.sw.spec.ts
//                    workers allowed (the spec edits that copy)
import { defineConfig, devices } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Workers re-load this file; reuse the folders the main process created.
const tmp = (key: string, prefix: string) => (process.env[key] ||= fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
const DATA = tmp('FINSIGHT_E2E_DIR', 'finsight-e2e-');
const AGENT_DATA = tmp('FINSIGHT_E2E_AGENT_DIR', 'finsight-e2e-agent-');
const SW_ROOT = tmp('FINSIGHT_E2E_SW_ROOT', 'finsight-e2e-sw-');
const PORT = 8099, AGENT_FINSIGHT_PORT = 8098, FAKE_AGENT_PORT = 8097, SW_PORT = 8096;

const finsightEnv = (data: string, port: number, agentUrl: string) => ({
  FINSIGHT_FAKE_MARKET: '1',
  FINSIGHT_DATA_DIR: data,
  PORT: String(port),
  AGENT_AUTOSTART: '0',
  AGENT_URL: agentUrl,
  AGENT_HOME: path.join(data, 'agent'),
  RECORDS_DIR: path.join(data, 'records'),
  NOTIFY: '0',
});
const health = (port: number) => `http://127.0.0.1:${port}/api/health`;

export default defineConfig({
  testDir: 'web/e2e',
  // One server and one data folder per project: specs run in order, one at a time.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: [['list']],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
    viewport: { width: 1600, height: 1000 },
  },
  projects: [
    { name: 'chromium', testIgnore: /\.(agent|sw)\.spec\.ts$/, use: { baseURL: `http://127.0.0.1:${PORT}` } },
    { name: 'agent', testMatch: /\.agent\.spec\.ts$/, use: { baseURL: `http://127.0.0.1:${AGENT_FINSIGHT_PORT}` } },
    { name: 'sw', testMatch: /\.sw\.spec\.ts$/, use: { baseURL: `http://127.0.0.1:${SW_PORT}`, serviceWorkers: 'allow' } },
  ],
  webServer: [
    // A closed port, so the main server never talks to a real Kestrel agent on 8100.
    { command: 'node server.js', url: health(PORT), reuseExistingServer: false, timeout: 30_000, env: finsightEnv(DATA, PORT, 'http://127.0.0.1:9') },
    { command: 'node web/e2e/fake-agent.mjs', url: `http://127.0.0.1:${FAKE_AGENT_PORT}/v1/info`, reuseExistingServer: false, timeout: 15_000, env: { FAKE_AGENT_PORT: String(FAKE_AGENT_PORT) } },
    { command: 'node server.js', url: health(AGENT_FINSIGHT_PORT), reuseExistingServer: false, timeout: 30_000,
      env: finsightEnv(AGENT_DATA, AGENT_FINSIGHT_PORT, `http://127.0.0.1:${FAKE_AGENT_PORT}`) },
    { command: `node web/e2e/sw-server.mjs ${JSON.stringify(SW_ROOT)}`, url: health(SW_PORT), reuseExistingServer: false, timeout: 30_000,
      env: finsightEnv(path.join(SW_ROOT, 'data'), SW_PORT, 'http://127.0.0.1:9') },
  ],
});
