import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveSubjects } from '../src/chat/research-subjects.ts';
import type { ResearchSubject } from '../src/chat/research-subjects.ts';
const response = (value: unknown) => ({ blocks: [{ type: 'text' as const, text: JSON.stringify(value) }], usage: { inputTokens: 10, outputTokens: 10 }, stopReason: 'end' as const });
const intent = (subjects: {mention: string; symbol: string}[]) => ({ kind: 'explicit', subjects, clarification: '' });
const reference = { kind: 'reference', subjects: [], clarification: '' };
const candidate = (symbol: string, name: string) => ({ symbol, name, exchange: 'NASDAQ', type: 'EQUITY' });
const previous: ResearchSubject[] = [{ mention: 'AMD', symbol: 'AMD', name: 'Advanced Micro Devices', basis: 'question' }];
const run = (question: string, plan: unknown, extra: Partial<Parameters<typeof resolveSubjects>[0]> = {}) => resolveSubjects({ question, panel: { symbol: 'TSM' }, previous: [], signal: new AbortController().signal, call: async () => response(plan), search: async q => [candidate(q.toUpperCase(), q)], ...extra });

test('an explicit lowercase ticker overrides another chart and works without any chart', async () => {
 for (const panel of [{symbol:'TSM'}, undefined]) {
  const r = await run('should i buy amd', intent([{mention:'amd',symbol:'AMD'}]), {panel});
  assert.equal(r.status,'ready');assert.deepEqual(r.subjects.map(s=>[s.symbol,s.basis]),[['AMD','question']]);
 }
});
test('company names require a source-backed listing and comparisons keep all explicit subjects', async () => {
 const queries:string[]=[];const r=await run('Compare Nvidia and AMD',intent([{mention:'Nvidia',symbol:'NVDA'},{mention:'AMD',symbol:'AMD'}]),{search:async q=>{queries.push(q);return q==='AMD'?[candidate('AMD','Advanced Micro Devices, Inc.')]:[candidate('NVDA','NVIDIA Corporation')];}});
 assert.deepEqual(queries,['Nvidia','AMD']);assert.deepEqual(r.subjects.map(s=>s.symbol),['NVDA','AMD']);assert.equal(r.subjects[0]!.name,'NVIDIA Corporation');
 const full=await run('Research Advanced Micro Devices',intent([{mention:'Advanced Micro Devices',symbol:'AMD'}]),{search:async()=>[candidate('AMD','Advanced Micro Devices, Inc.')]});assert.equal(full.status,'ready');
});
test('ambiguous listings, invented names and mismatched proposed tickers cannot become research subjects', async () => {
 const ambiguous=await run('Research Acme',intent([{mention:'Acme',symbol:'ACME'}]),{search:async()=>[candidate('ACME','Acme Inc.'),candidate('ACMB','Acme Corp.')]});assert.equal(ambiguous.status,'needs-clarification');assert.equal(ambiguous.subjects.length,0);
 const mismatch=await run('Research Nvidia',intent([{mention:'Nvidia',symbol:'AMD'}]),{search:async()=>[candidate('NVDA','NVIDIA Corporation')]});assert.equal(mismatch.status,'needs-clarification');
 const invented=await run('Research AMD',intent([{mention:'TSM',symbol:'TSM'}]));assert.equal(invented.status,'needs-clarification');
});
test('chart references and conversation pronouns have separate, explicit fallback rules', async () => {
 const chart=await run('Should I buy this stock?',reference,{previous});assert.equal(chart.subjects[0]!.symbol,'TSM');assert.equal(chart.subjects[0]!.basis,'chart');
 const conversation=await run('What about its risks?',reference,{previous});assert.equal(conversation.subjects[0]!.symbol,'AMD');assert.equal(conversation.subjects[0]!.basis,'conversation');
 const noChart=await run('What about it?',reference,{panel:undefined,previous});assert.equal(noChart.subjects[0]!.symbol,'AMD');
 const noReference=await run('Should I buy AMD?',reference);assert.equal(noReference.status,'needs-clarification');
 const noSubject=await run('What about it?',reference,{panel:undefined});assert.equal(noSubject.status,'needs-clarification');
 const multiple=await run('What about it?',reference,{previous:[...previous,{...previous[0]!,symbol:'NVDA'}]});assert.equal(multiple.status,'needs-clarification');
});
test('general questions do not inherit a chart subject; malformed intent asks a clarification', async () => {
 const r=await run('What are my biggest exposures?',{kind:'general',subjects:[],clarification:''});assert.equal(r.status,'general');assert.deepEqual(r.subjects,[]);
 const bad=await run('Research AMD',{findings:[]});assert.equal(bad.status,'needs-clarification');
});
test('lookup outages are explicit and never fall back to the selected chart',async()=>{
 const r=await run('Research Nvidia',intent([{mention:'Nvidia',symbol:'NVDA'}]),{search:async()=>{throw Error('offline');}});assert.equal(r.status,'unavailable');assert.deepEqual(r.subjects,[]);assert.match(r.note,/chart has not been substituted/);
});
test('references to earlier conversation require a literal source-backed company mention', async () => {
 const r=await run('What about its risks?',{kind:'reference',subjects:[{mention:'Nvidia',symbol:'NVDA'}],clarification:''},{panel:undefined,conversation:[{role:'user',text:'Compare Nvidia against bonds.'}],search:async()=>[candidate('NVDA','NVIDIA Corporation')]});
 assert.equal(r.status,'ready');assert.deepEqual(r.subjects.map(s=>[s.symbol,s.basis]),[['NVDA','conversation']]);
 const invented=await run('What about its risks?',{kind:'reference',subjects:[{mention:'AMD',symbol:'AMD'}],clarification:''},{panel:undefined,conversation:[{role:'user',text:'Compare Nvidia against bonds.'}]});
 assert.equal(invented.status,'needs-clarification');
});
