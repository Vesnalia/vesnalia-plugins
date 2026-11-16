import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { JSDOM } from 'jsdom';
const source = ts.transpileModule(fs.readFileSync(new URL('./localize.ts',import.meta.url),'utf8'),{
  compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022},
}).outputText;
const {createTranslator,mountChinese} = await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const read = name => JSON.parse(fs.readFileSync(new URL(name,import.meta.url),'utf8').replace(/^\uFEFF/,''));
const dictionary = read('./dictionary.json');
const rules = read('./template-rules.json');
const tick = () => new Promise(resolve=>setTimeout(resolve,0));
test('dictionary preserves all dynamic placeholders and has no unfinished markers',()=>{
  for(const [key,value] of Object.entries(dictionary)) {
    assert.deepEqual((value.match(/\{\d+\}/g)||[]).sort(),(key.match(/\{\d+\}/g)||[]).sort(),key);
    assert.equal((value.match(/%s/g)||[]).length,(key.match(/%s/g)||[]).length,key);
    assert.doesNotMatch(value,/ZXQ\d|QXZ|QQQ\d/,key);
  }
});
test('merged runtime rules compose count units and fixed operation names',()=>{
  const t=createTranslator(dictionary,rules);
  assert.equal(t('2 dev servers running at the last scan are stopped first.'),'上次扫描时仍在运行的 2 个开发服务器 会先停止。');
  assert.equal(t('Automation "Daily" requires a prompt before it can run. Edit it and add a prompt first.'),'自动化任务“Daily”需要先添加提示词，才能运行。先编辑任务并添加提示词。');
  assert.doesNotMatch(t('bb cloud can\'t transcribe this audio; use WebM, Ogg, MP4, MP3, WAV, FLAC, or AAC'),/\bthis\b/);
  assert.match(t('bb cloud can\'t transcribe audio/custom audio; use WebM, Ogg, MP4, MP3, WAV, FLAC, or AAC'),/audio\/custom/);
});
test('cron ordered slots render numbers without leaving percent placeholders',()=>{
  const t=createTranslator(dictionary,rules);
  assert.equal(t('Every 5 minutes'),dictionary['every %s minutes'].replace('%s','5'));
  assert.equal(t('Every minute between 09:00 and 18:00'),dictionary['Every minute between %s and %s'].replace('%s','09:00').replace('%s','18:00'));
});
test('exact UI, terms, whitespace, and dynamic placeholders',()=>{
  const t=createTranslator({...dictionary,'Delete {0} files?':'删除 {0} 个文件？'});
  assert.equal(t('  Settings\n'),'  设置\n');
  assert.equal(t('New project'),'新建 project');
  assert.equal(t('project'),'project');
  assert.equal(t('Delete 42 files?'),'删除 42 个文件？');
  assert.equal(t('My personal project title'),'My personal project title');
});
test('English plural suffixes disappear without removing names or counts',()=>{
  const t=createTranslator({'Delete {0} thread{1}?':'删除 {0} 个 thread{1}？'},
    {'Delete {0} thread{1}?':{englishPluralSuffixes:['{1}']}});
  assert.equal(t('Delete 1 thread?'),'删除 1 个 thread？');
  assert.equal(t('Delete 12 threads?'),'删除 12 个 thread？');
  assert.equal(t('Delete abc threadx?'),'Delete abc threadx?');
});
test('short dynamic usage labels and optional fragments translate',()=>{
  const t=createTranslator({'{0}% used':'{0}% 已使用','Selected {0} files{1}':'已选择 {0} 个文件{1}'});
  assert.equal(t('42% used'),'42% 已使用');
  assert.equal(t('Selected 2 files'),'已选择 2 个文件');
});
test('dynamic names keep their original spaces and line breaks',()=>{
  const t=createTranslator({'Archive project {0}?':'归档 project {0}？'});
  assert.equal(t('Archive project My  Name?'),'归档 project My  Name？');
  assert.equal(t('Archive project My\nName?'),'归档 project My\nName？');
});
test('only proven finite choices translate inside a dynamic placeholder',()=>{
  const t=createTranslator({'{0} surface':'{0}界面','Project {0} unavailable':'project {0} 不可用'},
    {'{0} surface':{placeholderChoices:{'{0}':{Next:'下一个',Previous:'上一个'}}}});
  assert.equal(t('Next surface'),'下一个界面');
  assert.equal(t('Previous surface'),'上一个界面');
  assert.equal(t('Project Next unavailable'),'project Next 不可用');
});
test('context distinguishes pagination, form steps, Git and mergeability',()=>{
  const dom=new JSDOM('<nav aria-label="Results pagination"><button>Next</button></nav><form><button>Next</button></form><div><span>Mergeability</span><span>Clean</span></div><div>Clean</div>');
  const d=dom.window.document;
  const dispose=mountChinese(d,{'Results pagination':'结果分页',Next:'下一步',Clean:'无改动',Mergeability:'可合并性'},undefined,{},[
    {source:'Next',translation:'下一页',ancestorAriaLabel:'Results pagination'},
    {source:'Clean',translation:'无冲突',siblingText:'Mergeability'},
  ]);
  assert.equal(d.querySelector('nav').getAttribute('aria-label'),'结果分页');
  assert.equal(d.querySelector('nav button').textContent,'下一页');
  assert.equal(d.querySelector('form button').textContent,'下一步');
  assert.equal(d.querySelectorAll('div')[0].textContent,'可合并性无冲突');
  assert.equal(d.querySelectorAll('div')[1].textContent,'无改动');
  dispose();assert.equal(d.querySelector('nav button').textContent,'Next');dom.window.close();
});
test('account history follows its adjacent definition label',()=>{
  const dom=new JSDOM('<dl><dt>Last used</dt><dd>Never</dd><dt>Usage refreshed</dt><dd>Never</dd></dl><button>Never</button>');
  const d=dom.window.document;
  const dispose=mountChinese(d,{Never:'永不','Last used':'上次使用','Usage refreshed':'用量刷新'},undefined,{},[
    {source:'Never',translation:'从未使用',precedingText:'Last used'},
    {source:'Never',translation:'从未刷新',precedingText:'Usage refreshed'},
  ]);
  assert.deepEqual([...d.querySelectorAll('dd')].map(x=>x.textContent),['从未使用','从未刷新']);
  assert.equal(d.querySelector('button').textContent,'永不');dispose();dom.window.close();
});
test('count labels translate only in placeholders proven to use the count formatter',()=>{
  const t=createTranslator({'Remove {0} ({1})?':'删除 {0}（{1}）？'},{'Remove {0} ({1})?':{placeholderUnits:{'{0}':{'development instance':'个开发实例','development instances':'个开发实例'}}}});
  assert.equal(t('Remove 1 development instance (8 MB)?'),'删除 1 个开发实例（8 MB）？');
  assert.equal(t('Remove 1,200 development instances (8 MB)?'),'删除 1,200 个开发实例（8 MB）？');
  assert.equal(t('Remove My development instance (8 MB)?'),'删除 My development instance（8 MB）？');
});
test('split destructive warning keeps the complete meaning',()=>{
  const t=createTranslator(dictionary,rules);
  const fragments=['This permanently deletes the database, settings and plugin data',' ','MACHINE-A',' kept when the server moved to ','MACHINE-B','. The server on ','MACHINE-B',' is not affected.'];
  const translated=fragments.map(t).join('');
  assert.match(translated,/永久删除/);
  assert.match(translated,/数据库/);
  assert.match(translated,/设置/);
  assert.match(translated,/plugin 数据/);
  assert.match(translated,/不受影响/);
  assert.equal(translated.split('MACHINE-B').length-1,2);
  assert.match(translated,/MACHINE-A/);
});
test('initial render, attributes, user content, edits and reversible disposal',async()=>{
  const dom=new JSDOM('<html lang="en"><body><button title="Settings">Settings</button><input placeholder="Search commands" value="Settings"><pre>Settings</pre><div contenteditable="true">Settings</div><div data-message-seq="1">Settings</div><div data-sidebar-thread-id="t">Settings</div></body></html>');
  const d=dom.window.document;
  const dispose=mountChinese(d,dictionary);
  assert.equal(d.querySelector('button').textContent,'设置');
  assert.equal(d.querySelector('button').title,'设置');
  assert.equal(d.querySelector('input').placeholder,'搜索命令');
  assert.equal(d.querySelector('input').value,'Settings');
  for(const selector of ['pre','[contenteditable]','[data-message-seq]','[data-sidebar-thread-id]'])assert.equal(d.querySelector(selector).textContent,'Settings');
  assert.equal(d.documentElement.lang,'zh-CN');
  const button=d.createElement('button');button.textContent='Cancel';d.body.append(button);
  await tick();assert.equal(button.textContent,'取消');
  button.firstChild.data='Delete';await tick();assert.equal(button.textContent,'删除');
  button.setAttribute('title','New project');await tick();assert.equal(button.title,'新建 project');
  dispose();dispose();
  assert.equal(button.textContent,'Delete');assert.equal(button.title,'New project');
  assert.equal(d.querySelector('button').textContent,'Settings');assert.equal(d.documentElement.lang,'en');
  button.firstChild.data='Cancel';await tick();assert.equal(button.textContent,'Cancel');
  dom.window.close();
});
test('abort restores UI without overwriting later user changes',async()=>{
  const dom=new JSDOM('<button title="Settings">Settings</button>');
  const d=dom.window.document;const abort=new AbortController();
  mountChinese(d,dictionary,abort.signal);
  d.querySelector('button').firstChild.data='User text';
  d.querySelector('button').title='User tooltip';
  await tick();abort.abort();
  assert.equal(d.querySelector('button').textContent,'User text');
  assert.equal(d.querySelector('button').title,'User tooltip');
  assert.equal(d.documentElement.getAttribute('lang'),null);dom.window.close();
});
test('preserves original nodes and click handlers',()=>{
  const dom=new JSDOM('<button>Settings</button>');const d=dom.window.document;
  const button=d.querySelector('button');const node=button.firstChild;let clicks=0;
  button.addEventListener('click',()=>clicks++);const dispose=mountChinese(d,dictionary);
  assert.equal(button.firstChild,node);button.click();assert.equal(clicks,1);dispose();dom.window.close();
});
test('removed nodes are restored before reuse as user content',async()=>{
  const dom=new JSDOM('<button>Settings</button>');const d=dom.window.document;
  const dispose=mountChinese(d,dictionary);const b=d.querySelector('button');
  b.remove();await tick();assert.equal(b.textContent,'Settings');
  dispose();dom.window.close();
});
test('compiled plugin registers and mounts against the shared runtime',async()=>{
  const dom=new JSDOM('<button>Settings</button><button>New project</button>');
  globalThis.document=dom.window.document;
  globalThis.__bbPluginRuntime={pluginSdkApp:{definePluginApp:setup=>({setup})}};
  try {
    const bundle=await import('./dist/app.js');
    const registrations=[];
    bundle.default.setup({contentScripts:{register:value=>registrations.push(value)}});
    assert.equal(registrations.length,1);
    assert.equal(registrations[0].id,'chinese-interface');
    const abort=new AbortController();
    const dispose=registrations[0].mount({pluginId:'zh-cn',generation:1,signal:abort.signal});
    assert.equal(document.body.textContent,'设置新建 project');
    abort.abort();dispose();
    assert.equal(document.body.textContent,'SettingsNew project');
  } finally {
    delete globalThis.document;delete globalThis.__bbPluginRuntime;dom.window.close();
  }
});
