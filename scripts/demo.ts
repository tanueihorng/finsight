#!/usr/bin/env node
// Demo mode: a separate FinSight (port 8003) + agent (port 8103) on a made-up
// portfolio in its own data folder. Your real data is never read or touched.
//   node scripts/demo.ts           start (seeds the demo data on first run)
//   node scripts/demo.ts --reset   wipe the demo folder and seed it again
// Env: FINSIGHT_DEMO_DIR (default ~/FinSightDemo). The bundled agent (agent/) is started by FinSight itself.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { isInsidePersonalData } from './demo-safety.ts';

const ROOT = path.join(import.meta.dirname, '..');
const DEMO_DIR = path.resolve(process.env.FINSIGHT_DEMO_DIR || path.join(os.homedir(), 'FinSightDemo'));
const PORT = 8003, AGENT_PORT = 8103;
const DEMO_PIN = '2468'; // demo only: the demo folder holds no real data
const URL = `http://127.0.0.1:${PORT}`; // 127.0.0.1, not localhost: keeps demo browser storage apart from the personal app

const real = path.resolve(os.homedir(), 'FinSightData');
if (isInsidePersonalData(DEMO_DIR, real)) { console.error('Refusing: the demo folder must not be your real FinSightData.'); process.exit(1); }

if (process.argv.includes('--reset')) { fs.rmSync(DEMO_DIR, { recursive: true, force: true }); console.log(`Reset ${DEMO_DIR}`); }

const DEMO_CSV = [
  'symbol,quantity,avg price,date',
  'NVDA,60,95.5,2024-11-04', 'MSFT,18,402,2025-01-15', 'AAPL,25,188,2024-12-02', 'GOOGL,30,165,2025-02-10',
  'VOO,22,470,2024-10-01', 'TSM,40,170,2025-03-03', 'D05.SI,300,36.2,2024-09-12', 'O39.SI,500,14.8,2025-04-08', 'ES3.SI,1200,3.45,2024-08-20',
].join('\n');

const RECORDS: Record<string, string> = {
  'INVESTMENT_POLICY.md': `# Demo investment policy v0.1\n\nThis is a DEMO policy for a fictional investor.\n\n- Goal: long-term growth with a 10-year horizon.\n- Proposed (not accepted) limits: single stock <= 15% of net worth; technology sector <= 45%; cash buffer >= 6 months of expenses.\n- Process: every buy needs a written thesis, a valuation check and an invalidation condition.\n`,
  'INVESTOR_PROFILE.md': `# Demo investor profile\n\nFictional investor for demonstrations. Singapore-based, reports in SGD, holds US and SGX stocks. Tax status: not stated.\n`,
  'DECISION_LOG.md': `# Demo decision log\n\n## D-DEMO-001 (proposal)\nReview technology concentration after strong gains in NVDA and TSM. No action decided.\n`,
  'reviews/nvda-thesis.md': `# NVDA thesis (demo)\nOwned for AI data-centre demand. Invalidation: two consecutive quarters of falling data-centre revenue, or gross margin below 65%.\n`,
};

async function seed(): Promise<boolean> {
  fs.mkdirSync(DEMO_DIR, { recursive: true });
  if (fs.existsSync(path.join(DEMO_DIR, 'portfolio.json'))) return false;
  process.env.FINSIGHT_DATA_DIR = DEMO_DIR; // must be set before lib/ is loaded:
  process.env.NOTIFY = '0';                  // lib/config.ts reads it once, so import lib/ only now
  const { setPin } = await import('../lib/auth.ts');
  const { importCsv, setCash, watchAdd } = await import('../lib/portfolio.ts');
  console.log('Seeding demo portfolio (fetches live prices)…');
  await setPin(DEMO_PIN);
  await importCsv(DEMO_CSV, true, undefined, 'SGD');
  await setCash('SGD', 25000); await setCash('USD', 6000);
  for (const s of ['AMD', 'AVGO', 'C6L.SI']) { try { await watchAdd(s); } catch { /* offline */ } }
  const rec = path.join(DEMO_DIR, 'records');
  for (const [f, text] of Object.entries(RECORDS)) { fs.mkdirSync(path.dirname(path.join(rec, f)), { recursive: true }); fs.writeFileSync(path.join(rec, f), text); }
  return true;
}

(async () => {
  const fresh = await seed();
  // FinSight starts and supervises its bundled agent; point both at the demo folder.
  const finsight = spawn(process.execPath, [path.join(ROOT, 'server.ts')], {
    cwd: ROOT, stdio: 'inherit',
    env: { ...process.env, FINSIGHT_DATA_DIR: DEMO_DIR, PORT: String(PORT), AGENT_URL: `http://127.0.0.1:${AGENT_PORT}`, NOTIFY: '0',
      FINSIGHT_DEMO_MODE: '1', AGENT_HOME: path.join(DEMO_DIR, 'agent'), RECORDS_DIR: path.join(DEMO_DIR, 'records') },
  });
  console.log(`\n  DEMO MODE   ${URL}   PIN ${DEMO_PIN}   data: ${DEMO_DIR}${fresh ? ' (freshly seeded)' : ''}`);
  console.log('  Made-up portfolio. Your real FinSightData is not used. Ctrl-C stops the demo.\n');
  const stop = () => { try { finsight.kill('SIGTERM'); } catch { /* gone */ } setTimeout(() => process.exit(0), 5000).unref(); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop); process.on('SIGHUP', stop);
  finsight.on('exit', () => process.exit(0));
  // open the browser when the server answers
  for (let i = 0; i < 40; i++) {
    try { await fetch(`${URL}/api/health`); if (process.platform === 'darwin' && !process.env.NO_BROWSER) execFile('open', [URL]); break; }
    catch { await new Promise((r) => setTimeout(r, 500)); }
  }
})().catch((e) => { console.error('Demo failed:', (e as Error).message); process.exit(1); });
