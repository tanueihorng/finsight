import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config.ts';
import { createWebTools, deepseekRequestCost } from '../src/tools/web.ts';
import { ToolRegistry } from '../src/tools/registry.ts';
import type { ToolCtx } from '../src/tools/registry.ts';
import { openDb, addCost } from '../src/store/db.ts';
import { clearSecretCache } from '../src/secrets.ts';
import { AgentError } from '../src/types.ts';
const original = { ...process.env }, cleanup: (() => void)[] = [];
afterEach(() => {
  for (const f of cleanup.splice(0).reverse()) f();
  for (const k of ['DEEPSEEK_API_KEY','TAVILY_API_KEY','BRAVE_API_KEY','AGENT_NO_KEYCHAIN']) {
    if (original[k] === undefined) delete process.env[k]; else process.env[k] = original[k];
  }
  clearSecretCache();
});
function fixture(provider: 'deepseek'|'tavily'|'brave'|'none' = 'deepseek') {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kestrel-web-'));
  cleanup.push(() => fs.rmSync(home, { recursive: true, force: true }));
  process.env.AGENT_NO_KEYCHAIN = '1'; process.env.DEEPSEEK_API_KEY = 'test-deepseek';
  delete process.env.TAVILY_API_KEY; delete process.env.BRAVE_API_KEY; clearSecretCache();
  const cfg = loadConfig({ AGENT_HOME: home, FINSIGHT_DATA_DIR: home }); cfg.searchProvider = provider;
  const db = openDb(':memory:'); cleanup.push(() => db.close());
  const ctx: ToolCtx = { cfg, db, finsight: { get: async () => { throw Error('unused'); } }, signal: new AbortController().signal,
    turnId: 'turn_test', threadId: 'th_test', citations: [], budget: { searches: 10, fetches: 15 } };
  return { ctx, home };
}
const hit = { title: 'SEC filing', url: 'https://www.sec.gov/example', summary: 'Reported revenue', date: '2026-10-23' };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const registry = (f: typeof fetch, guard?: Parameters<typeof createWebTools>[1]) => new ToolRegistry().add(...createWebTools(f, guard));
const q = { query: 'NVIDIA latest earnings', maxResults: 6 };

test('config preserves defaults and independently selects search/fetch; rejects invalid values', () => {
  const { home } = fixture(), env = { AGENT_HOME: home, FINSIGHT_DATA_DIR: home };
  assert.equal(loadConfig(env).searchProvider, 'tavily'); assert.equal(loadConfig(env).fetchProvider, 'local');
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ searchProvider: 'deepseek', fetchProvider: 'deepseek' }));
  assert.equal(loadConfig(env).searchProvider, 'deepseek'); assert.equal(loadConfig(env).fetchProvider, 'deepseek');
  fs.writeFileSync(path.join(home, 'config.json'), '{"searchProvider":"typo"}'); assert.throws(() => loadConfig(env), /Invalid/);
});
test('DeepSeek search maps filters, citations and usage; cache preserves provenance and separates providers', async () => {
  const { ctx } = fixture(); let calls = 0; process.env.TAVILY_API_KEY = 'test-tavily';
  const r = registry(async (url, options) => {
    calls++;
    if (String(url).includes('tavily')) return json({ results: [{ ...hit, content: 'Tavily' }] });
    assert.equal(String(url), 'https://api.deepseek.com/v1/tools/search');
    assert.equal(new Headers(options?.headers).get('authorization'), 'Bearer test-deepseek'); assert.equal(options?.redirect, 'error');
    const b = JSON.parse(String(options?.body)); assert.match(b.query, /site:sec.gov after:\d{4}-\d{2}-\d{2}/); assert.equal(b.count, 6);
    return json({ results: [hit] });
  });
  const input = { ...q, domains: ['sec.gov'], recencyDays: 7 };
  const a = JSON.parse((await r.execute('web_search', input, ctx)).content);
  assert.equal(a.provider, 'deepseek'); assert.equal(a.results[0].snippet, hit.summary); assert.equal(a.results[0].published, hit.date);
  assert.equal(ctx.citations[0]?.class, 'primary'); assert.equal(a.usage.requests, 1); assert.equal(ctx.budget.searches, 9);
  const b = JSON.parse((await r.execute('web_search', input, ctx)).content);
  assert.equal(b.cached, true); assert.equal(b.usage.requests, 0); assert.equal(b.retrievedAt, a.retrievedAt); assert.equal(calls, 1);
  ctx.cfg.searchProvider = 'tavily'; assert.equal(JSON.parse((await r.execute('web_search', input, ctx)).content).provider, 'tavily'); assert.equal(calls, 2);
  assert.equal((ctx.db.prepare('SELECT COUNT(*) n FROM cost_ledger').get() as any).n, 1);
});
test('query limits include filters, count Unicode characters and reject injected domain syntax', async () => {
  const { ctx } = fixture(); let calls = 0; const r = registry(async () => { calls++; return json({ results: [] }); });
  for (const input of [{query:'a'.repeat(129)}, {query:'a'.repeat(120),domains:['sec.gov']}, {query:'filings',domains:['sec.gov OR evil.com']}]) assert.equal((await r.execute('web_search', input, ctx)).ok, false);
  assert.equal((await r.execute('web_search', {query:'🙂'.repeat(100)}, ctx)).ok, true); assert.equal(calls, 1);
});
test('failed requests are not cached or costed; empty search is not billable', async () => {
  const { ctx } = fixture(); let n = 0; const r = registry(async () => ++n === 1 ? json({}, 429) : json({results:[]}));
  assert.match((await r.execute('web_search', q, ctx)).content, /429/);
  assert.equal((ctx.db.prepare('SELECT COUNT(*) n FROM cost_ledger').get() as any).n, 0);
  const empty = JSON.parse((await r.execute('web_search', q, ctx)).content); assert.equal(empty.usage.billableRequests, 0); assert.equal(empty.usage.estimatedCostUsd, 0);
});
test('disabled search, request cap and missing key stop before provider I/O', async () => {
  const { ctx } = fixture('none'); let calls = 0; const r = registry(async () => { calls++; throw Error('unexpected'); });
  assert.equal((await r.execute('web_search', q, ctx)).ok, false);
  ctx.cfg.searchProvider = 'deepseek'; ctx.budget.searches = 0; assert.match((await r.execute('web_search', q, ctx)).content, /BUDGET_EXCEEDED/);
  ctx.budget.searches = 1; delete process.env.DEEPSEEK_API_KEY; clearSecretCache(); assert.match((await r.execute('web_search', q, ctx)).content, /SEARCH_NOT_CONFIGURED/); assert.equal(calls, 0);
});
test('DeepSeek fetch uses guarded final URL; truncates, marks untrusted, caches full text and costs', async () => {
  const { ctx } = fixture(); ctx.cfg.fetchProvider = 'deepseek'; let calls = 0, guards = 0;
  const r = registry(async (url, options) => {
    calls++; assert.equal(String(url), 'https://api.deepseek.com/v1/tools/fetch'); assert.deepEqual(JSON.parse(String(options?.body)), {url:'https://www.sec.gov/final'});
    return json({title:'Filing', content:'x'.repeat(2000)});
  }, async () => { guards++; return {finalUrl:'https://www.sec.gov/final',status:200,contentType:'text/html',body:Buffer.from('ok')}; });
  const input = {url:'https://www.sec.gov/start',maxChars:1000}; const a = JSON.parse((await r.execute('fetch_url', input, ctx)).content);
  assert.match(a.notice, /UNTRUSTED/); assert.equal(a.text.length, 1000); assert.equal(a.truncated, true); assert.equal(a.usage.requests, 1);
  assert.equal(ctx.citations[0]?.url, 'https://www.sec.gov/final');
  const b = JSON.parse((await r.execute('fetch_url', {...input,maxChars:3000}, ctx)).content); assert.equal(b.text.length, 2000); assert.equal(b.usage.requests, 0); assert.equal(guards, 1); assert.equal(calls, 1);
});
test('private, metadata and credential URLs never reach DeepSeek fetch', async () => {
  const { ctx } = fixture(); ctx.cfg.fetchProvider = 'deepseek'; let calls = 0; const r = registry(async () => {calls++; throw Error('unexpected');});
  for (const url of ['http://127.0.0.1','http://169.254.169.254/latest','http://[::1]','http://localhost','file:///etc/passwd','https://u:p@example.com']) {
    const out = await r.execute('fetch_url',{url},ctx); assert.equal(out.ok,false); assert.match(out.content,/SSRF_BLOCKED/);
  }
  assert.equal(calls,0);
});
test('redirect guard failure prevents remote fetch; local reader remains keyless', async () => {
  const { ctx } = fixture(); ctx.cfg.fetchProvider = 'deepseek'; let calls = 0;
  const r = registry(async () => {calls++; throw Error('unexpected');},async () => {throw new AgentError('SSRF_BLOCKED','private redirect');});
  assert.match((await r.execute('fetch_url',{url:'https://example.com'},ctx)).content,/SSRF_BLOCKED/); assert.equal(calls,0);
  ctx.cfg.fetchProvider = 'local'; delete process.env.DEEPSEEK_API_KEY; clearSecretCache();
  const local = registry(async () => {throw Error('unexpected');}, async () => ({finalUrl:'https://example.com',status:200,contentType:'text/plain',body:Buffer.from('local text')}));
  const a = JSON.parse((await local.execute('fetch_url',{url:'https://example.com'},ctx)).content); assert.equal(a.text,'local text'); assert.equal(a.usage.estimatedCostUsd,0);
});
test('Singapore billing boundary, ledger attribution, daily and per-turn fee caps', async (t) => {
  const start = Date.parse('2026-11-01T00:00:00+08:00'); assert.equal(deepseekRequestCost(true,start-1),0); assert.equal(deepseekRequestCost(true,start),0.00075); assert.equal(deepseekRequestCost(false,start),0);
  const {ctx} = fixture(); t.mock.method(Date,'now',()=>start+1000); let calls = 0; const r = registry(async () => {calls++; return json({results:[hit]});});
  const a = JSON.parse((await r.execute('web_search',q,ctx)).content); assert.equal(a.usage.estimatedCostUsd,0.00075);
  const row = ctx.db.prepare('SELECT * FROM cost_ledger').get() as any; assert.equal(row.kind,'search'); assert.equal(row.turn_id,ctx.turnId); assert.equal(row.usd,0.00075);
  ctx.cfg.limits.turnUsd = 0.001; assert.match((await r.execute('web_search',{query:'other query'},ctx)).content,/BUDGET_EXCEEDED/);
  ctx.cfg.limits.turnUsd = 1; addCost(ctx.db,{brain:'model',kind:'tokens',units:1,usd:ctx.cfg.limits.dayUsd}); assert.match((await r.execute('web_search',{query:'third query'},ctx)).content,/BUDGET_EXCEEDED/); assert.equal(calls,1);
});
test('existing Tavily/Brave fallback works; malformed DeepSeek output fails', async () => {
  const {ctx} = fixture('tavily'); process.env.TAVILY_API_KEY = 'test-tavily'; process.env.BRAVE_API_KEY = 'test-brave'; let calls = 0;
  const r = registry(async (url) => {calls++; if(String(url).includes('tavily'))return json({},503); if(String(url).includes('brave'))return json({web:{results:[{...hit,description:'Brave'}]}}); return json({unexpected:true});});
  assert.equal(JSON.parse((await r.execute('web_search',q,ctx)).content).provider,'brave'); assert.equal(calls,2);
  ctx.cfg.searchProvider='deepseek'; assert.match((await r.execute('web_search',q,ctx)).content,/PROVIDER_INVALID/);
});
test('parallel paid requests reserve fees and release them after provider errors',async(t)=>{
  const {ctx}=fixture();t.mock.method(Date,'now',()=>Date.parse('2026-11-02T00:00:00+08:00'));ctx.cfg.limits.turnUsd=.001;
  let release!:()=>void,calls=0;const ready=new Promise<void>(r=>{release=r;});
  const r=registry(async()=>{calls++;await ready;return json({},500);});
  const first=r.execute('web_search',q,ctx);
  const second=await r.execute('web_search',{query:'parallel other'},ctx);assert.match(second.content,/BUDGET_EXCEEDED/);assert.equal(calls,1);
  release();await first;
  const third=await r.execute('web_search',{query:'retry after failure'},ctx);assert.match(third.content,/500/);assert.equal(calls,2);
});
test('paid DeepSeek fetch records its own fee and aborted calls do not create ledger charges',async(t)=>{
  const {ctx}=fixture();ctx.cfg.fetchProvider='deepseek';t.mock.method(Date,'now',()=>Date.parse('2026-11-02T00:00:00+08:00'));
  const page=async()=>({finalUrl:'https://example.com',status:200,contentType:'text/plain',body:Buffer.from('text')});
  const r=registry(async()=>json({title:'Page',content:'remote text'}),page);
  const a=JSON.parse((await r.execute('fetch_url',{url:'https://example.com'},ctx)).content);assert.equal(a.usage.estimatedCostUsd,.00075);
  assert.equal((ctx.db.prepare('SELECT kind FROM cost_ledger').get()as any).kind,'fetch');
  const c=new AbortController();c.abort();ctx.signal=c.signal;
  const stopped=registry(async(_url,opts)=>{opts?.signal?.throwIfAborted();throw Error('unexpected');});
  assert.equal((await stopped.execute('web_search',q,ctx)).ok,false);assert.equal((ctx.db.prepare('SELECT COUNT(*) n FROM cost_ledger').get()as any).n,1);
});
