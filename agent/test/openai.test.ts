import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BrainManifest, costOf } from '../src/brains/types.ts';
import { openAiBrain, toOpenAiMessages } from '../src/brains/openai.ts';
import { loadBrains } from '../src/brains/registry.ts';
import { loadConfig } from '../src/config.ts';
import { clearSecretCache } from '../src/secrets.ts';
import { openDb } from '../src/store/db.ts';
import * as store from '../src/store/db.ts';
import { ChatEngine } from '../src/chat/engine.ts';
import { EventBus } from '../src/chat/bus.ts';
import { ToolRegistry } from '../src/tools/registry.ts';
import { z } from 'zod';

const manifest = (id: string) => BrainManifest.parse(JSON.parse(fs.readFileSync(new URL(`../plugins/brains/${id}/manifest.json`,import.meta.url),'utf8')));
const original = { ...process.env }; const clean: (()=>void)[]=[];
afterEach(()=>{for(const f of clean.splice(0).reverse())f();for(const k of ['OPENAI_API_KEY','AGENT_NO_KEYCHAIN']){if(original[k]===undefined)delete process.env[k];else process.env[k]=original[k];}clearSecretCache();});
function config(){const home=fs.mkdtempSync(path.join(os.tmpdir(),'kestrel-gpt-'));clean.push(()=>fs.rmSync(home,{recursive:true,force:true}));return loadConfig({AGENT_HOME:home,FINSIGHT_DATA_DIR:home});}
function stream(events: any[]) {
  const bytes=new TextEncoder().encode(events.map(x=>'data: '+JSON.stringify(x)+'\n\n').join('')+'data: [DONE]\n\n');
  return new Response(new ReadableStream({start(c){for(let i=0;i<bytes.length;i+=7)c.enqueue(bytes.slice(i,i+7));c.close();}}));
}
const usage={prompt_tokens:1000,completion_tokens:20,prompt_tokens_details:{cached_tokens:400}};
const delta=(d:any,finish_reason:string|null=null)=>({choices:[{delta:d,finish_reason}]});

test('GPT manifests discover through existing loader, require a key, preserve default, and declare current prices',()=>{
  process.env.AGENT_NO_KEYCHAIN='1';delete process.env.OPENAI_API_KEY;clearSecretCache();const cfg=config();
  const unavailable=loadBrains(cfg);
  for(const id of ['gpt-6-luna','gpt-6-sol'])assert.equal(unavailable.brains.get(id)?.available,false);
  process.env.OPENAI_API_KEY='test-openai-key';clearSecretCache();const found=loadBrains(cfg);assert.deepEqual(found.invalid,[]);
  for(const id of ['gpt-6-luna','gpt-6-sol']){const b=found.brains.get(id)!;assert.equal(b.available,true);assert.equal(b.manifest.capabilities.vision,true);assert.equal(b.manifest.options.reasoning_effort,'none');assert.equal(b.create().kind,'api');}
  assert.equal(cfg.defaultBrain,'deepseek-flash');
  assert.equal(manifest('gpt-6-luna').pricing.inputPerM,.1);assert.equal(manifest('gpt-6-sol').pricing.outputPerM,10);
});
test('OpenAI sends max_completion_tokens only; DeepSeek retains max_tokens and native options',async()=>{
  for(const id of ['gpt-6-luna','gpt-6-sol','deepseek-flash']){
    const m=manifest(id);let sent:any;
    const b=openAiBrain(m,'test-key',async(url,opts)=>{assert.equal(String(url),m.baseUrl+'/chat/completions');sent=JSON.parse(String(opts?.body));assert.equal(new Headers(opts?.headers).get('authorization'),'Bearer test-key');return stream([delta({content:'Done'},'stop'),{choices:[],usage}]);});
    let text='';const result=await b.step({system:'sys',messages:[{role:'user',blocks:[{type:'text',text:'hello'}]}],tools:[],signal:new AbortController().signal,onText:d=>{text+=d;}});
    assert.equal(text,'Done');assert.equal(result.stopReason,'end');assert.equal(result.usage.cacheReadTokens,400);
    const gpt=id.startsWith('gpt-');assert.equal(sent[gpt?'max_completion_tokens':'max_tokens'],m.maxOutputTokens);
    if(gpt){assert.ok(!('max_tokens'in sent));assert.equal(sent.reasoning_effort,'none');}else assert.ok(!('max_completion_tokens'in sent));
  }
});
test('fragmented stream assembles tool name/JSON and Unicode; image and tool history survive translation',async()=>{
  const history:any[]=[{role:'user',blocks:[{type:'text',text:'Read this chart'},{type:'image',mime:'image/png',data:'aGVsbG8='}]},
    {role:'assistant',blocks:[{type:'tool_call',id:'call:1/x',name:'get_cash',args:{}}]},
    {role:'tool',blocks:[{type:'tool_result',callId:'call:1/x',name:'get_cash',ok:true,content:'{"cash":42}'}]}];
  const messages=toOpenAiMessages('sys',history);assert.match(messages[1].content[1].image_url.url,/^data:image\/png;base64,/);assert.equal(messages[2].tool_calls[0].id,messages[3].tool_call_id);
  let text='';const brain=openAiBrain(manifest('gpt-6-luna'),'test-key',async()=>stream([
    delta({content:'Checking € ' ,tool_calls:[{index:0,id:'call_1',function:{name:'get_',arguments:'{"base":'}}]}),
    delta({tool_calls:[{index:0,function:{name:'cash',arguments:'"SGD"}'}}]},'tool_calls'),{choices:[],usage}]));
  const r=await brain.step({system:'sys',messages:history,tools:[{name:'get_cash',description:'cash',parameters:{type:'object'}}],signal:new AbortController().signal,onText:d=>{text+=d;}});
  assert.equal(text,'Checking € ');assert.equal(r.stopReason,'tool_use');assert.deepEqual(r.blocks[1],{type:'tool_call',id:'call_1',name:'get_cash',args:{base:'SGD'}});
  const usd=costOf(manifest('gpt-6-luna'),r.usage);assert.ok(Math.abs(usd-0.000074)<1e-12);
});
test('provider error classification and caller cancellation remain intact',async()=>{
  for(const [status,code]of [[429,'PROVIDER_RATE_LIMIT'],[500,'PROVIDER_ERROR'],[400,'PROVIDER_INVALID']]as const){
    const b=openAiBrain(manifest('gpt-6-luna'),'test-key',async()=>new Response('{}',{status}));
    await assert.rejects(b.step({system:'s',messages:[],tools:[],signal:new AbortController().signal,onText:()=>{}}),(e:any)=>e.code===code);
  }
  const controller=new AbortController();controller.abort();const b=openAiBrain(manifest('gpt-6-luna'),'test-key',async(_url,opts)=>{opts?.signal?.throwIfAborted();throw Error('unreachable');});
  await assert.rejects(b.step({system:'s',messages:[],tools:[],signal:controller.signal,onText:()=>{}}),(e:any)=>e.name==='AbortError');
});
test('GPT streaming tool loop persists outputs and token costs in existing engine',async()=>{
  const cfg=config(),db=openDb(':memory:');clean.push(()=>db.close());cfg.defaultBrain='gpt-6-luna';let steps=0;
  const tools=new ToolRegistry().add({name:'test_cash',description:'synthetic cash',input:z.object({}),handler:async()=>({cash:42})});
  const brain=openAiBrain(manifest('gpt-6-luna'),'test-key',async(_url,opts)=>{
    const b=JSON.parse(String(opts?.body));steps++;
    if(steps===1)return stream([delta({tool_calls:[{index:0,id:'c1',function:{name:'test_cash',arguments:'{}'}}]},'tool_calls'),{choices:[],usage}]);
    assert.ok(b.messages.some((m:any)=>m.role==='tool'&&m.content.includes('42')));
    return stream([delta({content:'Cash is 42.'},'stop'),{choices:[],usage}]);
  });
  const bus=new EventBus(db);const engine=new ChatEngine({cfg,db,bus,tools,brains:new Map(),finsight:{get:async()=>{throw Error('synthetic no portfolio');}}});engine.setBrain('gpt-6-luna',brain);
  const thread=store.createThread(db);const r=engine.send({threadId:thread.id,content:'Cash?'});
  for(let i=0;i<100&&(db.prepare('SELECT status FROM turns WHERE id=?').get(r.turnId)as any).status==='running';i++)await new Promise(r=>setTimeout(r,10));
  assert.equal((db.prepare('SELECT status FROM turns WHERE id=?').get(r.turnId)as any).status,'succeeded');assert.equal(steps,2);
  assert.equal(store.listMessages(db,thread.id).at(-1)!.blocks[0]!.type,'text');assert.ok(Math.abs(store.spendSince(db,0)-0.000148)<1e-12);
  assert.ok(store.eventsAfter(db,thread.id,0).some(e=>e.type==='turn.finished'));
});
test('existing /v1/brains API exposes GPT entries without frontend or response-shape changes',async()=>{
  const {createApi}=await import('../src/api/server.ts');
  const http=await import('node:http');
  process.env.AGENT_NO_KEYCHAIN='1';process.env.OPENAI_API_KEY='test-openai-key';clearSecretCache();
  const cfg=config();const secret='synthetic-proxy-secret-for-test-only';
  fs.writeFileSync(path.join(cfg.finsightDataDir,'agent-link.json'),JSON.stringify({token:'synthetic-test-token',proxySecret:secret}));
  const db=openDb(':memory:');clean.push(()=>db.close());const bus=new EventBus(db),tools=new ToolRegistry(),finsight={get:async()=>{throw Error('unused');}};
  const {brains,invalid}=loadBrains(cfg);const engine=new ChatEngine({cfg,db,bus,tools,brains,finsight});const server=createApi({cfg,db,bus,tools,brains,brainsInvalid:invalid,engine,finsight});
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
  try{const port=(server.address()as import('node:net').AddressInfo).port;
    const res=await new Promise<{status:number;body:string}>((resolve,reject)=>{
      const req=http.request({host:'127.0.0.1',port,path:'/v1/brains',headers:{host:`127.0.0.1:${cfg.port}`,'x-agent-secret':secret}},r=>{
        let body='';r.on('data',c=>{body+=c;});r.on('end',()=>resolve({status:r.statusCode||0,body}));
      });req.on('error',reject);req.end();
    });assert.equal(res.status,200);
    const data:any=JSON.parse(res.body);assert.equal(data.default,'deepseek-flash');for(const id of ['gpt-6-luna','gpt-6-sol']){const b=data.brains.find((x:any)=>x.id===id);assert.equal(b.available,true);assert.equal(b.tools,true);assert.equal(b.transport,'openai-compatible');}
  }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
});
