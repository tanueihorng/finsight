import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {fakeFinsight,testConfig,testCtx} from './helpers.ts';
import type {Fake} from './helpers.ts';
import {openDb} from '../src/store/db.ts';
import * as store from '../src/store/db.ts';
import {EventBus} from '../src/chat/bus.ts';
import {buildRegistry} from '../src/tools/index.ts';
import {runStoredCouncil} from '../src/chat/council-service.ts';
import {BrainManifest} from '../src/brains/types.ts';
import type {StepRequest,StepResult} from '../src/brains/types.ts';
let fake:Fake;before(async()=>{fake=await fakeFinsight();});after(async()=>{await fake.close();});
const manifest=BrainManifest.parse({apiVersion:1,kind:'brain',id:'subject-fixture',label:'Fixture',transport:'mock',model:'fixture',pricing:{inputPerM:0.1,outputPerM:0.1,version:'fixture'},capabilities:{tools:true,streaming:false,contextTokens:100000},maxOutputTokens:1200,costTier:'$'});
const result=(value:unknown):StepResult=>({blocks:[{type:'text',text:JSON.stringify(value)}],usage:{inputTokens:50,outputTokens:50},stopReason:'end'});
function setup(question='Should I buy AMD?',plan:unknown={kind:'explicit',subjects:[{mention:'AMD',symbol:'AMD'}],clarification:''}){
 const cfg=testConfig(fake);cfg.limits.turnUsd=2;const db=openDb(':memory:');const thread=store.createThread(db);const turn=store.createTurn(db,thread.id,'subject-fixture');const ctx=testCtx(cfg,db);ctx.threadId=thread.id;ctx.turnId=turn.id;
 const requests:StepRequest[]=[];const brain={kind:'api' as const,manifest,step:async(req:StepRequest)=>{requests.push(req);if(req.system.startsWith('Research subject resolution.'))return result(plan);const data=JSON.parse((req.messages[0]!.blocks[0] as {text:string}).text);return result({findings:data.evidence.length?[{claim:'Verified subject quote',evidenceIds:[data.evidence[0].id],assumptions:[],uncertainty:'Valuation not supplied',counterevidence:[],invalidation:'New filing',missingEvidence:['Valuation']}]:[],unresolvedQuestions:[]});}};
 const args={db,bus:new EventBus(db),tools:buildRegistry(),ctx,brain,system:'Core read-only rules',question,usageTotal:{inputTokens:0,outputTokens:0,cacheReadTokens:0},scope:{symbol:'TSM'} as import('../src/types.ts').PageContext | undefined};
 return {db,ctx,cfg,requests,args};
}
test('actual council service fetches AMD before any specialist even with TSM attached, and persists its scope',async()=>{
 const s=setup();const out=await runStoredCouncil(s.args);
 for(const req of s.requests.slice(1)){const data=JSON.parse((req.messages[0]!.blocks[0] as {text:string}).text);const quote=JSON.parse(data.evidence[0].content);assert.deepEqual(quote.quotes.map((x:{symbol:string})=>x.symbol),['AMD']);assert.deepEqual(JSON.parse(data.question).researchSubjects.map((x:{symbol:string})=>x.symbol),['AMD']);}
 assert.equal(out.steps,8);assert.equal(s.requests.length,8);
 const notices=store.listMessages(s.db,s.ctx.threadId!).flatMap(m=>m.blocks).filter(b=>b.type==='notice');assert.ok(notices.some(b=>b.type==='notice'&&b.kind==='research_scope'&&JSON.parse(b.text).subjects[0].symbol==='AMD'));
 assert.equal(store.getTrace(s.db,s.ctx.turnId!).length,8);assert.ok(store.spendSince(s.db,0)>0);assert.ok(out.runs.every(r=>r.status==='completed'));s.db.close();
});
test('wrong-subject or unavailable quotes stop before specialists instead of supplying chart data',async()=>{
 for(const mode of ['wrong','unavailable']){
  const s=setup();s.ctx.finsight={get:async<T>(url:string)=>(url==='/api/search'?[{symbol:'AMD',name:'Advanced Micro Devices, Inc.',exchange:'NASDAQ',type:'EQUITY'}]:{quotes:mode==='wrong'?[{symbol:'TSM',price:400}]:[{symbol:'AMD',price:null}]}) as T};
  const out=await runStoredCouncil(s.args);assert.equal(s.requests.length,1);assert.equal(out.runs.length,0);assert.match(out.text,/verified market data for AMD/);assert.match(out.text,/not been substituted/);s.db.close();
 }
});
test('ambiguous intent asks before quote/research; general questions do not force a chart quote',async()=>{
 const s=setup('Research Mercury',{kind:'clarify',subjects:[],clarification:'Which Mercury company do you mean?'});s.ctx.finsight={get:async()=>{throw Error('Must not fetch');}};const out=await runStoredCouncil(s.args);assert.equal(out.steps,1);assert.equal(out.text,'Which Mercury company do you mean?');assert.equal(out.runs.length,0);s.db.close();
 const g=setup('Review portfolio liquidity',{kind:'general',subjects:[],clarification:''});const generic=await runStoredCouncil(g.args);assert.equal(generic.runs.length,7);const msgs=store.listMessages(g.db,g.ctx.threadId!);assert.ok(!msgs.flatMap(m=>m.blocks).some(b=>b.type==='notice'&&b.kind==='council_evidence'));g.db.close();
});
test('subject planning cannot dispatch outside the existing budget or after cancellation',async()=>{
 const small=setup();small.cfg.limits.turnUsd=0.00000001;await assert.rejects(runStoredCouncil(small.args),/budget/i);assert.equal(small.requests.length,0);small.db.close();
 const stopped=setup();const ctrl=new AbortController();ctrl.abort();stopped.ctx.signal=ctrl.signal;await assert.rejects(runStoredCouncil(stopped.args));assert.equal(stopped.requests.length,0);stopped.db.close();
});
test('cancellation during non-cooperative instrument lookup accepts no late evidence or scope',async()=>{
 const s=setup('Research Nvidia',{kind:'explicit',subjects:[{mention:'Nvidia',symbol:'NVDA'}],clarification:''});const ctrl=new AbortController();s.ctx.signal=ctrl.signal;let release!:(value:unknown)=>void;let started!:()=>void;const entered=new Promise<void>(resolve=>{started=resolve;});
 s.ctx.finsight={get:async<T>()=>{started();return await new Promise<unknown>(resolve=>{release=resolve;}) as T;}};
 const pending=runStoredCouncil(s.args);await entered;ctrl.abort();await assert.rejects(pending);release([{symbol:'NVDA',name:'NVIDIA Corporation',exchange:'NASDAQ',type:'EQUITY'}]);await new Promise(resolve=>setTimeout(resolve,0));
 assert.ok(!store.listMessages(s.db,s.ctx.threadId!).flatMap(m=>m.blocks).some(b=>b.type==='notice'&&b.kind==='research_scope'));s.db.close();
});


test('company-name comparisons fetch all requested quotes without requiring chart context', async () => {
  const s = setup('Compare Nvidia and AMD', {kind:'explicit', subjects:[{mention:'Nvidia',symbol:'NVDA'}, {mention:'AMD',symbol:'AMD'}], clarification:''});
  s.args.scope = undefined;
  const out = await runStoredCouncil(s.args);
  assert.equal(out.runs.length, 7);
  for (const req of s.requests.slice(1)) {
    const data = JSON.parse((req.messages[0]!.blocks[0] as {text:string}).text);
    assert.deepEqual(JSON.parse(data.evidence[0].content).quotes.map((q:{symbol:string})=>q.symbol), ['NVDA','AMD']);
  }
  s.db.close();
});

test('conversation references use the latest saved scope and do not resurrect a superseded topic', async () => {
  for (const status of ['ready','needs-clarification']) {
    const s = setup('What about its risks?', {kind:'reference', subjects:[], clarification:''});
    s.args.scope = undefined;
    store.appendMessage(s.db, s.ctx.threadId!, 'user', [{type:'notice',kind:'research_scope',text:JSON.stringify({version:1,status:'ready',subjects:[{mention:'AMD',symbol:'AMD',name:'Advanced Micro Devices',basis:'question'}]})}]);
    if (status==='needs-clarification') store.appendMessage(s.db, s.ctx.threadId!, 'user', [{type:'notice',kind:'research_scope',text:JSON.stringify({version:1,status,subjects:[]})}]);
    const out = await runStoredCouncil(s.args);
    if (status==='ready') {
      assert.equal(out.runs.length,7);
      const data=JSON.parse((s.requests[1]!.messages[0]!.blocks[0] as {text:string}).text);
      assert.equal(JSON.parse(data.question).researchSubjects[0].symbol,'AMD');
    } else { assert.equal(out.runs.length,0); assert.match(out.text,/Which company or ticker/); }
    s.db.close();
  }
});

test('council receives bounded prior text as untrusted context, with the chosen system lens', async () => {
 const s=setup('Review the comparison', {kind:'general',subjects:[],clarification:''});
 store.appendMessage(s.db,s.ctx.threadId!,'user',[{type:'text',text:'Compare long-term risks with the bond alternative.'},{type:'notice',kind:'private',text:'do not include notice'}]);
 store.appendMessage(s.db,s.ctx.threadId!,'assistant',[{type:'text',text:'The bond has interest-rate risk.'}]);
 s.args.system='Core read-only rules\nAnalytical lens: growth';
 await runStoredCouncil(s.args);
 const plan=JSON.parse((s.requests[0]!.messages[0]!.blocks[0] as {text:string}).text);
 assert.equal(plan.recentConversation.length,2);
 for(const req of s.requests.slice(1)) {
   assert.match(req.system,/Analytical lens: growth/);
   const data=JSON.parse((req.messages[0]!.blocks[0] as {text:string}).text);
   const scope=JSON.parse(data.question);
   assert.deepEqual(scope.recentConversation.map((m:{text:string})=>m.text),['Compare long-term risks with the bond alternative.','The bond has interest-rate risk.']);
   assert.match(scope.conversationNote,/not verified evidence/);
 }
 s.db.close();
});
