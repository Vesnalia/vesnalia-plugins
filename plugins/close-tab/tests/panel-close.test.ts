import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {mountPanelClose} from '../lib/panel-close';
function setup(html:string){
 const dom=new JSDOM('<head></head><body>'+html+'</body>',{pretendToBeVisual:true});
 Object.assign(globalThis,{document:dom.window.document,HTMLElement:dom.window.HTMLElement,MutationObserver:dom.window.MutationObserver,requestAnimationFrame:dom.window.requestAnimationFrame.bind(dom.window),cancelAnimationFrame:dom.window.cancelAnimationFrame.bind(dom.window)});
 return dom;
}
const chrome=(inside:string)=>`<div data-testid="thread-secondary-panel-top-chrome"><div role="toolbar"></div><div><button aria-label="Full Screen"><svg></svg></button>${inside}</div></div>`;
const wait=()=>new Promise(r=>setTimeout(r,60));
test('native close icon retains handler, survives replacement, restores on abort',async()=>{
 const dom=setup(chrome('<button aria-label="Hide right panel"><svg data-icon="PanelRight"></svg></button>'));
 const doc=dom.window.document,controller=new AbortController();let clicks=0;
 const button=doc.querySelector<HTMLButtonElement>('[aria-label="Hide right panel"]')!;
 button.onclick=()=>clicks++;
 const stop=mountPanelClose({signal:controller.signal});
 assert.equal(doc.querySelectorAll('[data-close-tab-cross]').length,1);
 assert.equal(doc.querySelectorAll('button').length,2);
 button.click();assert.equal(clicks,1);
 await wait();assert.equal(doc.querySelectorAll('[data-close-tab-cross]').length,1);
 // VesnALIA replaces only its own icon, so the plugin's decoration stays singular.
 button.querySelector('[data-icon]')!.replaceWith(doc.createElementNS('http://www.w3.org/2000/svg','svg'));
 await wait();assert.equal(doc.querySelectorAll('[data-close-tab-cross]').length,1);
 const replacement=button.cloneNode(true) as HTMLButtonElement;
 replacement.querySelector('[data-close-tab-cross]')!.remove();button.replaceWith(replacement);
 await wait();assert.equal(doc.querySelectorAll('[data-close-tab-cross]').length,1);
 controller.abort();stop();
 assert.equal(doc.querySelectorAll('[data-close-tab-cross],[data-close-tab-native-panel-x]').length,0);
 assert.equal(doc.querySelectorAll('head style').length,0);
 doc.body.appendChild(doc.createElement('div'));await wait();
 assert.equal(doc.querySelectorAll('[data-close-tab-cross]').length,0);
 dom.window.close();
});
test('outside hide toggle adds one cross and re-mount disposes without queued work',async()=>{
 const dom=setup('<button id="toggle" aria-label="Hide right panel"></button>'+chrome(''));
 const doc=dom.window.document;let clicks=0;
 doc.querySelector<HTMLButtonElement>('#toggle')!.onclick=()=>clicks++;
 const stop=mountPanelClose({signal:new AbortController().signal});
 const button=doc.querySelector<HTMLButtonElement>('[data-close-tab-panel-x]')!;
 assert.ok(button);button.click();assert.equal(clicks,1);
 await wait();assert.equal(doc.querySelectorAll('[data-close-tab-panel-x]').length,1);
 doc.body.appendChild(doc.createElement('div'));stop();
 await wait();assert.equal(doc.querySelectorAll('[data-close-tab-panel-x]').length,0);
 const stop2=mountPanelClose({signal:new AbortController().signal});
 assert.equal(doc.querySelectorAll('[data-close-tab-panel-x]').length,1);stop2();
 dom.window.close();
});
test('no hide target and pre-aborted mounts add no controls',()=>{
 const dom=setup(chrome(''));
 const stop=mountPanelClose({signal:new AbortController().signal});
 assert.equal(dom.window.document.querySelectorAll('[data-close-tab-panel-x]').length,0);stop();
 const controller=new AbortController();controller.abort();
 mountPanelClose({signal:controller.signal})();
 assert.equal(dom.window.document.querySelectorAll('head style').length,0);
 dom.window.close();
});
