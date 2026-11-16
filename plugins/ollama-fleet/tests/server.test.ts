import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakePluginHost } from '@get-bb/plugin-sdk/testing';
import plugin from '../server';
import { JOBS_KEY, JOBS_CHANGED, type Job } from '../lib/observability';
const hosts: ReturnType<typeof createFakePluginHost>[]=[];
afterEach(async()=>{vi.unstubAllGlobals();for(const h of hosts.splice(0))await h.harness.behavior.dispose();});
function deferred<T>() {let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>resolve=r);return {promise,resolve};}
async function setup(chat?: (url:string,init:RequestInit)=>Promise<Response>, endpoints=1) {
 const h=createFakePluginHost({pluginId:'ollama-fleet'});hosts.push(h);await plugin(h.bb);
 await h.bb.storage.kv.set('endpoints',Array.from({length:endpoints},(_,i)=>({id:`s${i}`,name:i?'Laptop':'Desktop PC',baseUrl:`http://server${i}.invalid:11434`,createdAt:new Date().toISOString()})));
 vi.stubGlobal('fetch',vi.fn(async (url:string,init:RequestInit={})=>{
  if(url.endsWith('/api/tags'))return Response.json({models:[{name:url.includes('server0')?'qwen3-coder:a':'qwen3-coder:b'}]});
  if(url.endsWith('/api/ps'))return Response.json({models:[]});
  if(url.endsWith('/api/show'))return Response.json({model_info:{'llama.context_length':32000}});
  if(url.endsWith('/api/chat'))return chat?chat(url,init):Response.json({message:{content:'RAW_RESPONSE'},done:true});
  throw Error('unexpected request');
 }));
 const snap=async()=>{const result=await h.harness.behavior.callRpc('fleet_observability_snapshot',{});return result as {jobs:Job[]}};
 return {...h,snap};
}
const input={taskType:'coding',prompt:'RAW_PROMPT',localOnly:true,maxAttempts:2};
describe('Fleet public registered paths',()=>{
 it('existing route result remains compatible while direct RPC origin is null',async()=>{
  const h=await setup();const result=await h.harness.behavior.callRpc('fleet_route',input);
  expect(result).toMatchObject({taskType:'coding',prompt:'RAW_PROMPT',response:'RAW_RESPONSE',succeeded:true});
  expect((await h.snap()).jobs[0]).toMatchObject({origin:null,state:'completed',label:'Local coding task',actualModel:'qwen3-coder:a',server:{id:'s0',name:'Desktop PC'}});
 });
 it('agent context origin and optional label, actual running state, completion',async()=>{
  const started=deferred<void>(),done=deferred<Response>();const h=await setup(async()=>{started.resolve();return done.promise;});
  const route=h.harness.behavior.callAgentTool('ollama_fleet_route',{...input,label:'Review bounds'},{threadId:'thread1',projectId:'project1'});
  await started.promise;expect((await h.snap()).jobs[0]).toMatchObject({state:'running',origin:{threadId:'thread1',projectId:'project1'},label:'Review bounds'});
  done.resolve(Response.json({message:{content:'RAW_RESPONSE'},done:true}));await route;
  expect((await h.snap()).jobs[0].state).toBe('completed');
  expect(h.harness.inspection.realtimeSignals.filter(s=>s.channel===JOBS_CHANGED).map(s=>(s.payload as {state:string}).state)).toEqual(['routing','running','completed']);
 });
 it('fallback changes actual model/server on the same job without intermediate failure',async()=>{
  let calls=0;const h=await setup(async()=>++calls===1?new Response('',{status:503}):Response.json({message:{content:'ok'},done:true}),2);
  await h.harness.behavior.callRpc('fleet_route',input);const j=(await h.snap()).jobs[0];expect(j).toMatchObject({attemptCount:2,revision:4,state:'completed'});
  const signals=h.harness.inspection.realtimeSignals.filter(s=>s.channel===JOBS_CHANGED).map(s=>s.payload as {jobId:string;state:string});
  expect(new Set(signals.map(s=>s.jobId)).size).toBe(1);expect(signals.map(s=>s.state)).toEqual(['routing','running','running','completed']);
  expect(j.actualModel).toBe('qwen3-coder:b');expect(j.server?.name).toBe('Laptop');
 });
 it('all attempts fail with safe error',async()=>{
  const h=await setup(async()=>{throw Error('RAW_PROMPT RAW_RESPONSE reasoning https://secret.invalid token=ABC')});
  await h.harness.behavior.callRpc('fleet_route',input);expect((await h.snap()).jobs[0]).toMatchObject({state:'failed',errorPreview:'Generation failed'});
 });
 it('no servers produces truthful failed job with no actual candidate',async()=>{
  const h=await setup(undefined,0);await h.harness.behavior.callRpc('fleet_route',input);
  expect((await h.snap()).jobs[0]).toMatchObject({state:'failed',actualModel:null,server:null,attemptCount:0});
 });
 it('abort propagates to fetch, records cancellation and stops fallbacks',async()=>{
  const started=deferred<void>();let calls=0;const h=await setup(async(_url,init)=>{
   calls++;started.resolve();return new Promise((_resolve,reject)=>init.signal!.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true}));
  },2);
  const c=new AbortController();const route=h.harness.behavior.callAgentTool('ollama_fleet_route',input,{signal:c.signal});await started.promise;c.abort();await route;
  expect(calls).toBe(1);expect((await h.snap()).jobs[0].state).toBe('cancelled');
 });
 it('already aborted route never starts generation',async()=>{
  const h=await setup();await h.harness.behavior.callAgentTool('ollama_fleet_route',input,{signal:AbortSignal.abort()});
  expect(fetch).not.toHaveBeenCalled();expect((await h.snap()).jobs[0]).toMatchObject({state:'cancelled',attemptCount:0});
 });
 it('concurrent routes remain simultaneous and distinct',async()=>{
  const both=deferred<void>(),done=deferred<Response>();let count=0;const h=await setup(async()=>{if(++count===2)both.resolve();return (await done.promise).clone()});
  const a=h.harness.behavior.callRpc('fleet_route',input),b=h.harness.behavior.callRpc('fleet_route',input);await both.promise;
  expect((await h.snap()).jobs.filter(j=>j.state==='running')).toHaveLength(2);
  done.resolve(Response.json({message:{content:'ok'},done:true}));await Promise.all([a,b]);expect(new Set((await h.snap()).jobs.map(j=>j.jobId)).size).toBe(2);
 });
 it('snapshot, persisted metadata and signals contain no prompt/response/reasoning/endpoint',async()=>{
  const h=await setup();await h.harness.behavior.callRpc('fleet_route',input);await new Promise(r=>setTimeout(r,0));
  const data=JSON.stringify([await h.bb.storage.kv.get(JOBS_KEY),h.harness.inspection.realtimeSignals.filter(s=>s.channel===JOBS_CHANGED)]);
  expect(data).not.toMatch(/RAW_PROMPT|RAW_RESPONSE|reasoning|server0\.invalid|baseUrl|https?:/);
 });
 it('observability KV failure does not fail successful route',async()=>{
  const h=await setup();const original=h.bb.storage.kv.set.bind(h.bb.storage.kv);
  vi.spyOn(h.bb.storage.kv,'set').mockImplementation(async(key,value)=>{if(key===JOBS_KEY)throw Error('KV');return original(key,value)});
  expect(await h.harness.behavior.callRpc('fleet_route',input)).toMatchObject({succeeded:true});expect((await h.snap()).jobs[0].state).toBe('completed');
 });
 it('observability publish failure does not fail successful route',async()=>{
  const h=await setup();vi.spyOn(h.bb.realtime,'publish').mockImplementation(()=>{throw Error('signal')});
  expect(await h.harness.behavior.callRpc('fleet_route',input)).toMatchObject({succeeded:true});
 });
 it('public input rejects excessive label and snapshot cap',async()=>{
  const h=await setup();await expect(h.harness.behavior.callRpc('fleet_route',{...input,label:'x'.repeat(121)})).rejects.toThrow();
  await expect(h.harness.behavior.callRpc('fleet_observability_snapshot',{limit:21})).rejects.toThrow();
 });
 it('snapshot never trusts caller-supplied origin',async()=>{
  const h=await setup();await h.harness.behavior.callRpc('fleet_route',{...input,origin:{threadId:'spoof',projectId:'spoof'}});
  expect((await h.snap()).jobs[0].origin).toBeNull();
 });
});
