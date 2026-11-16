import { describe, it, expect, vi } from 'vitest';
import { JobRegistry, active, safeDisplay, safeError, snapshotInputSchema } from '../lib/observability';
function setup(stored: unknown = null) {
 let value = stored;
 const host = { read: async () => value, write: vi.fn(async (v: unknown) => { value = v; }), publish: vi.fn() };
 return { registry: new JobRegistry(host), host, stored: () => value };
}
describe('bounded operational registry', () => {
 it('empty snapshot', () => expect(setup().registry.snapshot().jobs).toEqual([]));
 it('routing starts with generic task label, null actuals and direct origin', () => {
  const {registry:r}=setup();r.start('coding');
  expect(r.snapshot().jobs[0]).toMatchObject({state:'routing',label:'Local coding task',actualModel:null,server:null,origin:null,revision:1,attemptCount:0});
 });
 it.each(['coding','reasoning','security','general'] as const)('generic %s label', t => {
  const {registry:r}=setup();r.start(t); expect(r.snapshot().jobs[0].label).toBe(`Local ${t} task`);
 });
 it('running uses actual model and friendly server; fallback retains identity and increments revision/attempt', () => {
  const {registry:r}=setup();const id=r.start('coding','Review', {threadId:'t',projectId:'p'});
  r.attempt(id,'model-a',{id:'s1',name:'Desktop PC'});
  expect(r.snapshot().jobs[0]).toMatchObject({jobId:id,revision:2,state:'running',actualModel:'model-a',server:{id:'s1',name:'Desktop PC'},attemptCount:1,origin:{threadId:'t',projectId:'p'},label:'Review'});
  r.attempt(id,'model-b',{id:'s2',name:'Laptop'});r.finish(id,'completed');
  expect(r.snapshot().jobs[0]).toMatchObject({jobId:id,revision:4,state:'completed',actualModel:'model-b',server:{id:'s2',name:'Laptop'},attemptCount:2});
 });
 it.each(['completed','failed','cancelled'] as const)('%s is terminal with timing and no resurrection', state => {
  const {registry:r}=setup();const id=r.start('general');r.finish(id,state,'raw secret');
  const j=r.snapshot().jobs[0];expect(j.state).toBe(state);expect(j.finishedAt).not.toBeNull();expect(j.durationMs).toBeGreaterThanOrEqual(0);
  r.attempt(id,'late',{id:'s',name:'late'});r.finish(id,'completed');expect(r.snapshot().jobs[0]).toEqual(j);
 });
 it('distinct concurrent jobs and scoped active filtering', () => {
  const {registry:r}=setup();const a=r.start('general','a',{threadId:'a',projectId:'p'});const b=r.start('general','b',{threadId:'b',projectId:'p'});
  expect(a).not.toBe(b);expect(r.snapshot().jobs).toHaveLength(2);r.finish(a,'completed');
  expect(r.snapshot({activeOnly:true}).jobs.map(j=>j.jobId)).toEqual([b]);expect(r.snapshot({originThreadId:'a'}).jobs.map(j=>j.jobId)).toEqual([a]);
 });
 it('snapshot cap, input cap, requested lower bound', () => {
  const {registry:r}=setup();for(let i=0;i<25;i++)r.start('general');
  expect(r.snapshot({limit:999}).jobs).toHaveLength(20);expect(r.snapshot().truncated).toBe(true);
  expect(r.snapshot({limit:3}).jobs).toHaveLength(3);expect(snapshotInputSchema.safeParse({limit:21}).success).toBe(false);
 });
 it('retains newest 100 terminal jobs, evicts oldest, persists one bounded record', async () => {
  vi.useFakeTimers();try {
   const {registry:r,stored}=setup();let first='';
   for(let i=0;i<105;i++){vi.setSystemTime(i*1000);const id=r.start('general')!;if(!i)first=id;r.finish(id,'completed');}
   await r.flush();const data=stored() as {jobs:{jobId:string}[]};expect(data.jobs).toHaveLength(100);expect(data.jobs.some(j=>j.jobId===first)).toBe(false);
  } finally {vi.useRealTimers();}
 });
 it('evicts oldest transitions when all timestamps tie', async () => {
  vi.useFakeTimers();try {
   vi.setSystemTime(1000);const {registry:r,stored}=setup();const ids=[];
   for(let i=0;i<105;i++){const id=r.start('general')!;ids.push(id);r.finish(id,'completed');}
   await r.flush();const data=stored() as {jobs:{jobId:string}[]};
   expect(data.jobs.map(j=>j.jobId)).toEqual(ids.slice(5));
   expect(r.snapshot().jobs[0].jobId).toBe(ids[104]);
  } finally {vi.useRealTimers();}
 });
 it('bounds persisted active rows without hiding concurrent jobs from filters', async () => {
  const {registry:r,stored}=setup();for(let i=0;i<30;i++)r.start('general',undefined,{threadId:String(i),projectId:'p'});
  await r.flush();expect((stored() as {jobs:unknown[]}).jobs).toHaveLength(20);expect(r.snapshot({originThreadId:'0'}).jobs).toHaveLength(1);
 });
 it('reload reconciles unfinished jobs and preserves completed model/server', async () => {
  const a=setup();a.registry.start('general');const id=a.registry.start('coding');a.registry.attempt(id,'model',{id:'s',name:'Desktop'});a.registry.finish(id,'completed');await a.registry.flush();
  const b=setup(a.stored());await b.registry.initialize();await b.registry.flush();
  expect(b.registry.snapshot().jobs.some(active)).toBe(false);expect(b.registry.snapshot().jobs.find(j=>j.state==='cancelled')?.errorPreview).toContain('Fleet reloaded');
  expect(b.registry.snapshot().jobs.find(j=>j.jobId===id)?.actualModel).toBe('model');
 });
 it.each([null,{},'bad',{schemaVersion:2,jobs:[]},{schemaVersion:1,jobs:[{}]}])('malformed KV %j', async value => {
  const {registry:r}=setup(value);await r.initialize();expect(r.snapshot().jobs).toEqual([]);
 });
 it('bounded labels never expose URLs, common credentials, or control characters', () => {
  const {registry:r}=setup();r.start('coding','x'.repeat(300));expect(r.snapshot().jobs[0].label).toHaveLength(120);
  expect(safeDisplay('Review https://user:password@host/path token=secret Bearer abc sk-abcdef\n')).not.toMatch(/password|host|secret|abc/);
 });
 it.each(['raw payload '+ 'x'.repeat(1000),new Error('prompt response reasoning password=hunter2'),{response:'secret'}])('errors are categorical and bounded', e => {
  expect(safeError(e)).toBe('Generation failed');expect(safeError(e).length).toBeLessThanOrEqual(360);
 });
 it('publication and persistence failures do not throw', async () => {
  const a=setup();a.host.write.mockRejectedValue(new Error('KV'));a.host.publish.mockImplementation(()=>{throw Error('signal');});
  const id=a.registry.start('general');a.registry.attempt(id,'m',{id:'s',name:'Desktop'});a.registry.finish(id,'completed');await a.registry.flush();expect(a.registry.snapshot().jobs[0].state).toBe('completed');
 });
 it('async signal rejection is contained', async () => {
  const a=setup();a.host.publish.mockImplementation(()=>Promise.reject(Error('signal')));a.registry.start('general');await a.registry.flush();
 });
 it('snapshots are detached and KV unknown fields stripped', async () => {
  const a=setup();a.registry.start('general');await a.registry.flush();const value=a.stored() as {jobs:Record<string,unknown>[]};value.jobs[0].prompt='PROMPT';value.jobs[0].response='RESPONSE';value.jobs[0].reasoning='REASONING';
  const b=setup(value);await b.registry.initialize();await b.registry.flush();expect(JSON.stringify(b.stored())).not.toMatch(/PROMPT|RESPONSE|REASONING/);
  b.registry.snapshot().jobs[0].label='mutated';expect(b.registry.snapshot().jobs[0].label).not.toBe('mutated');
 });
});
