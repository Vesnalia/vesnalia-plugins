import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import {createState,ingest,turnStats} from './stats.ts';
const require=createRequire(import.meta.url);
const ts=require('typescript');
const state=createState();
const event=(seq,type,time,turnId,data={})=>({seq,type,createdAt:time,scope:{kind:'turn',turnId},data});
const usage=(total,last)=>({providerThreadId:'p',tokenUsage:{total:{outputTokens:total},last:{outputTokens:last}}});
ingest(state,[event(1,'turn/started',1000,'a'),event(2,'thread/tokenUsage/updated',2000,'a',usage(100,100))]);
assert.deepEqual(turnStats(state,'thr_a'),[]);
ingest(state,[event(3,'thread/tokenUsage/updated',4000,'a',usage(150,50)),event(4,'thread/tokenUsage/updated',5000,'a',usage(150,50)),event(5,'turn/completed',11000,'a')]);
assert.equal(turnStats(state,'thr_a')[0].tokens,150);
assert.equal(turnStats(state,'thr_a')[0].durationMs,10000);
assert.equal(turnStats(state,'thr_a')[0].tps,15);
ingest(state,[event(5,'turn/completed',11000,'a'),event(6,'turn/started',12000,'b'),event(7,'thread/tokenUsage/updated',13000,'b',usage(200,50)),event(8,'turn/completed',14000,'b')]);
assert.equal(turnStats(state,'thr_a')[1].tokens,50);
ingest(state,[event(9,'turn/started',15000,'c'),event(10,'thread/tokenUsage/updated',16000,'c',usage(25,25)),event(11,'turn/completed',17000,'c')]);
assert.equal(turnStats(state,'thr_a')[2].tokens,25);
ingest(state,[event(12,'turn/started',18000,'d'),event(13,'turn/completed',19000,'d')]);
assert.equal(turnStats(state,'thr_a').length,3);
class Row {
 constructor(id,label){this.dataset={timelineRowId:id};this.badge=null;this.label=label??'';}
 querySelector(){return this.badge;}
 appendChild(badge){this.badge=badge;badge.remove=()=>{this.badge=null;};}
 removeAttribute(){}
}
class Button {
 constructor(row){this.row=row;this.attrs={};}
 get textContent(){return this.row.label;}
 closest(selector){return selector==='[data-timeline-row-id]'?this.row:null;}
 getAttribute(name){return Object.prototype.hasOwnProperty.call(this.attrs,name)?this.attrs[name]:null;}
 setAttribute(name,value){this.attrs[name]=value;}
 hasAttribute(name){return Object.prototype.hasOwnProperty.call(this.attrs,name);}
 removeAttribute(name){delete this.attrs[name];}
 get title(){return this.getAttribute('title')??'';}
 set title(value){this.setAttribute('title',value);}
}
const rows=[new Row('thr_a:assistant:kind:assistant|turn:a|parent:root'),new Row('thr_b:assistant:kind:assistant|turn:a|parent:root'),new Row('thr_a:assistant:unknown'),new Row('thr_a:a:turn','Worked for 1m 40s'),new Row('thr_a:b:turn:0','Worked for 1m 40s'),new Row('thr_a:op:thread-provisioning:3')];
const buttons=rows.map(row=>new Button(row));
const document={querySelectorAll:selector=>selector==='button'?buttons:rows.filter(row=>row.dataset.timelineRowId.includes(':assistant:')),createElement:()=>({})};
let source=fs.readFileSync(new URL('./app.tsx',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').split('export default definePluginApp')[0];
source=ts.transpile(source,{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None});
const rowIdSource=ts.transpile(fs.readFileSync(new URL('./lib/row-id.ts',import.meta.url),'utf8').replace(/^export /gm,''),{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None});
const ctx=vm.createContext({document,window:{location:{pathname:'/threads/thr_a'}}});
vm.runInContext(rowIdSource+'\n'+source,ctx);
const assistantRow=ctx.parseRowId('thr_a:assistant:kind:assistant|turn:a|parent:root');
assert.equal(assistantRow.threadId,'thr_a','assistant row thread id');
assert.equal(assistantRow.turnId,'a','assistant row turn id');
const headerRow=ctx.parseRowId('thr_a:a:turn');
assert.equal(headerRow.threadId,'thr_a','header row thread id');
assert.equal(headerRow.turnId,'a','header row turn id');
const indexedHeaderRow=ctx.parseRowId('thr_a:b:turn:0');
assert.equal(indexedHeaderRow.turnId,'b','indexed header row turn id');
assert.equal(ctx.parseRowId('thr_a:op:thread-provisioning:3'),null,'row without a turn id');
assert.equal(ctx.parseRowId(undefined),null,'missing row id');
ctx.decorate(turnStats(state,'thr_a'));
assert.ok(rows[0].badge);
assert.equal(rows[1].badge,null,'same turn id in another thread must not match');
assert.equal(rows[2].badge,null,'no positional fallback');
assert.equal(buttons[3].getAttribute('data-alia-tps'),'15 tps','header button shows the turn rate');
assert.equal(buttons[4].getAttribute('data-alia-tps'),'25 tps','indexed header row shows the turn rate');
assert.ok(buttons[3].title.includes('15 tok/s'),'header button tooltip explains the rate');
ctx.decorate([]);
assert.equal(rows[0].badge,null,'empty results clear stale badges');
assert.equal(buttons[3].getAttribute('data-alia-tps'),null,'empty results clear header labels');
assert.equal(buttons[3].title,'','empty results clear header tooltips');
const os = require('node:os');
const path = require('node:path');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omp-test-'));
const sessDir = path.join(tmpDir, 'sessions', 'project_a');
fs.mkdirSync(sessDir, { recursive: true });
const mockSessionFile = path.join(sessDir, '2026-09-05T00-00-00-000Z_mock_omp_pid.jsonl');
const mockLines = [
  JSON.stringify({ type: 'message', message: { role: 'user', content: 'hello' } }),
  JSON.stringify({ type: 'message', message: { role: 'assistant', usage: { output: 50 }, duration: 2000 } }),
  JSON.stringify({ type: 'message', message: { role: 'user', content: 'world' } }),
  JSON.stringify({ type: 'message', message: { role: 'assistant', usage: { output: 150 }, duration: 3000 } })
];
fs.writeFileSync(mockSessionFile, mockLines.join('\n') + '\n');
const prevDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = tmpDir;
try {
  const ompState = createState();
  ingest(ompState, [
    event(1, 'thread/identity', 1000, undefined, { providerThreadId: 'mock_omp_pid' }),
    event(2, 'turn/started', 2000, 't1', { providerThreadId: 'mock_omp_pid' }),
    event(3, 'turn/completed', 5000, 't1', { providerThreadId: 'mock_omp_pid' }),
    event(4, 'turn/started', 6000, 't2', { providerThreadId: 'mock_omp_pid' }),
    event(5, 'turn/completed', 10000, 't2', { providerThreadId: 'mock_omp_pid' }),
    event(6, 'turn/started', 11000, 't3', { providerThreadId: 'mock_omp_pid' })
  ]);
  const ompStats = turnStats(ompState, 'thr_omp');
  assert.equal(ompStats.length, 2, 'only completed turns are returned');
  assert.equal(ompStats[0].tokens, 50);
  assert.equal(ompStats[0].durationMs, 2000);
  assert.equal(ompStats[0].tps, 25);
  assert.equal(ompStats[0].label, '25 tps');
  assert.equal(ompStats[1].tokens, 150);
  assert.equal(ompStats[1].durationMs, 3000);
  assert.equal(ompStats[1].tps, 50);
  assert.equal(ompStats[1].label, '50 tps');
} finally {
  if (prevDir !== undefined) process.env.PI_CODING_AGENT_DIR = prevDir;
  else delete process.env.PI_CODING_AGENT_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
console.log('PASS: accounting, exact thread/turn badge matching, missing IDs, stale badge cleanup, OMP native TPS resolution');

