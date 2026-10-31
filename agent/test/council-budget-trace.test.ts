// Synthetic reconstruction of the measured AMD trace; no original source text or holdings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CouncilBudget, runCouncil } from '../src/chat/council.ts';
import { BrainManifest } from '../src/brains/types.ts';
import type { StepRequest } from '../src/brains/types.ts';

const manifest = BrainManifest.parse({ apiVersion: 1, kind: 'brain', id: 'trace-fixture', label: 'Trace fixture', transport: 'mock', model: 'fixture', pricing: { inputPerM: .3, outputPerM: 1.2, cacheReadPerM: .006, version: 'synthetic' }, capabilities: { tools: true, streaming: false, contextTokens: 1000000 }, costTier: '$', maxOutputTokens: 8000 });
const sizes = [612, 1174, 4794, 1850, 6913, 669, 2291, 1279];
const scopes: (string[] | undefined)[] = [undefined, ['growth','macro','risk'], ['growth','macro'], ['growth','macro','risk'], ['growth','macro'], ['risk'], ['risk'], ['macro']];
const evidence = sizes.map((size,i) => ({ id:'e'+i, source:'Synthetic source '+i, observedAt:'2026-10-01', retrievedAt:'2026-10-29', roles: scopes[i], content: JSON.stringify({ symbol:'SYN', passage: ('Synthetic source statement. ').repeat(Math.ceil(size/28)).slice(0,size) }) }));
const ids: Record<string,string[]> = { growth:['e0','e1','e2','e3','e4'], macro:['e0','e1','e2','e3','e4','e7'], risk:['e0','e1','e3','e5','e6'], chair:['e0'] };
const usage: Record<string,{inputTokens:number;outputTokens:number;cacheReadTokens:number}> = {
  'growth:assessment': {inputTokens:10182,outputTokens:1064,cacheReadTokens:3200},
  'macro:assessment': {inputTokens:10883,outputTokens:1243,cacheReadTokens:3200},
  'risk:assessment': {inputTokens:7127,outputTokens:1043,cacheReadTokens:3200},
  'growth:challenge': {inputTokens:14170,outputTokens:792,cacheReadTokens:1792},
  'macro:challenge': {inputTokens:14170,outputTokens:833,cacheReadTokens:1792},
  'risk:challenge': {inputTokens:14170,outputTokens:833,cacheReadTokens:1792},
  'chair:synthesis': {inputTokens:16007,outputTokens:1027,cacheReadTokens:1920},
};
function answer(role:string, phase:string) {
 const long = 'Synthetic analysis and limitation. '.repeat(phase === 'challenge' ? 6 : 15);
 return { findings: Array.from({length:3},(_,i) => ({claim:`${role} ${i} ${long}`, evidenceIds:ids[role], assumptions:[long], uncertainty:long, counterevidence:[], invalidation:long, missingEvidence:[]})), unresolvedQuestions:['Synthetic research gap'] };
}
test('trace-sized evidence packet fits seven stages with full context and the chosen council budget', async () => {
 const requests: StepRequest[]=[]; const reservations:number[]=[]; let held=0, charged=0, peak=0;
 const brain = {kind:'api' as const, manifest, step:async(req:StepRequest) => {
  requests.push(req); const m=/Council role: (\w+)\./.exec(req.system);
  const role=m?.[1] || 'resolution', phase=role==='chair'?'synthesis':req.system.includes('This phase has no research tools')?'challenge':'assessment';
  return {blocks:[{type:'text' as const,text:JSON.stringify(role==='resolution'?{}:answer(role, phase))}], usage:usage[role+':'+phase] ?? {inputTokens:427,outputTokens:24,cacheReadTokens:256},stopReason:'end' as const};
 }};
 const result = await runCouncil({ question:'Review SYN', evidence, brain, system:'Core rules. '+ 'x'.repeat(5500), signal:new AbortController().signal, capUsd:.5, maxOutputTokens:8000, dayBudget:new CouncilBudget(2), tools:[], emit:()=>{}, account:()=>{}, execute:async()=>{throw Error('not used');}, reserveCost:(n)=>{reservations.push(n); held+=n; peak=Math.max(peak,held+charged); return (actual)=>{held-=n; charged+=actual ?? n;};}, prepare:async(call)=>{await call('x'.repeat(1776),[{role:'user',blocks:[{type:'text',text:'subject'}]}]);return {question:'Review SYN '+ 'q'.repeat(2700),evidence:[]};} });
 assert.deepEqual(result.runs.filter(r=>r.status!=='completed').map(r=>[r.role,r.phase,r.error]), []);
 assert.equal(result.steps,8); assert.ok(peak <= .5); assert.ok(result.costUsd !== null && result.costUsd < .5); assert.ok(Math.abs(held) < 1e-12);
 assert.ok(requests.some(r=>r.system.includes('Council role: chair') && Buffer.byteLength(JSON.stringify({system:r.system,messages:r.messages,tools:r.tools})) > 60000), 'chair fixture exercises the previous 60 KB failure');
 for (const req of requests.filter(r=>r.system.includes('This phase has no research tools') && !r.system.includes('Council role: chair'))) {
   const data=JSON.parse((req.messages[0]!.blocks[0] as {text:string}).text);
   assert.deepEqual(data.data.map((p:{role:string})=>p.role).sort(), ['growth','macro','risk'].sort());
   const supplied=new Map<string,unknown>(data.evidence.map((e:{id:string;content:unknown})=>[e.id,e.content]));
   for (const peer of data.data) for (const finding of peer.findings.findings) for(const id of finding.evidenceIds) assert.ok(supplied.has(id));
   for (const [id,content] of supplied) assert.equal(JSON.stringify(content), evidence.find(e=>e.id===id)!.content);
   assert.equal(req.maxOutputTokens, 8000);
 }
});
