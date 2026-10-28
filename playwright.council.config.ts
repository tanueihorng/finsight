// Separate disposable ports/output; never shares the ordinary fake-agent store.
import base from './playwright.config.ts';
import { defineConfig } from '@playwright/test';
const servers = base.webServer as Array<Record<string, any>>;
const app = servers[2]!;
const portBase = Number(process.env.E2E_PORT_BASE || 8096);
export default defineConfig({ ...base, testIgnore: [], testMatch: /COUNCIL\.realagent\.spec\.ts$/, outputDir: '/tmp/finsight-real-council-results',
  projects: [{ name: 'real-council', use: { baseURL: `http://127.0.0.1:${portBase + 2}` } }],
  webServer: [
    { ...servers[1], command: 'node web/e2e/real-council-agent.mjs', env: { ...app.env, AGENT_PORT: String(portBase + 1), FINSIGHT_URL: `http://127.0.0.1:${portBase + 2}`, KESTREL_COUNCIL: '1', AGENT_NO_KEYCHAIN: '1' } },
    app,
  ],
});
