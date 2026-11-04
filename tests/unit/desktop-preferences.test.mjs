import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import * as Vue from 'vue';
import * as controls from '../../src/components/ui/control.ts';
import * as design from 'tdesign-vue-next';
import {parse,compileScript} from 'vue/compiler-sfc';
import {renderToString} from '@vue/server-renderer';
import ts from 'typescript';
import {createDesktopPreferences} from '../../src/stores/desktopPreferences.ts';

const preferences=(workMode=false,petOnStartup=false)=>({version:1,workMode,petOnStartup});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function fixture(){
 let actual=preferences(),failure=null,readFailure=null;const calls=[];
 const model=createDesktopPreferences(async(command,args)=>{
  calls.push({command,args});
  if(command==='read_desktop_status')return {enabled:true,shortcutRegistered:true};
  if(command==='read_desktop_preferences'){if(readFailure)throw readFailure;return {...actual};}
  if(command==='save_desktop_preferences'){
   if(failure?.code==='DESKTOP_CONFLICT')throw failure;
   assert.deepEqual(args.input.expected,actual);actual={...args.input.preferences};
   if(failure)throw failure;return {preferences:{...actual},warning:null};
  }
  throw Error(command);
 });
 return {model,calls,get actual(){return actual;},set actual(value){actual=value;},set failure(value){failure=value;},set readFailure(value){readFailure=value;}};
}
test('desktop preferences cannot save before a confirmed read and never mutate business data',async()=>{
 const f=fixture();f.model.draft.workMode=true;assert.equal(await f.model.save(),false);assert.equal(f.calls.length,0);
 await f.model.load();assert.equal(f.model.draft.workMode,true);assert.equal(await f.model.save(),true);
 assert.deepEqual(f.actual,preferences(true));assert.ok(f.calls.every(c=>['read_desktop_preferences','save_desktop_preferences'].includes(c.command)));
});
test('read failure preserves the last applied mode, saved value and draft',async()=>{
 const f=fixture();f.actual=preferences(true);await f.model.load();f.model.draft.petOnStartup=true;f.readFailure=Error('synthetic read failure');
 await f.model.load();assert.equal(f.model.ready.value,false);assert.equal(f.model.appliedWorkMode.value,true);assert.equal(f.model.draft.petOnStartup,true);assert.deepEqual(f.model.saved.value,preferences(true));
 assert.equal(await f.model.save(),false);
});
test('unknown save requires explicit reconciliation; background reads cannot re-enable saving',async()=>{
 const f=fixture();await f.model.load();f.model.draft.workMode=true;f.failure=Error('reply lost after commit');
 assert.equal(await f.model.save(),false);assert.equal(f.model.ready.value,false);assert.equal(f.model.draft.workMode,true);
 f.failure=null;await f.model.load(false);assert.equal(f.model.ready.value,false);assert.equal(await f.model.save(),false);
 await f.model.load();assert.equal(f.model.ready.value,true);assert.equal(f.model.dirty.value,false);assert.equal(f.model.appliedWorkMode.value,true);
 assert.equal(f.calls.filter(c=>c.command==='save_desktop_preferences').length,1);
});
test('conflict preserves an independent draft through readback and discard is explicit',async()=>{
 const f=fixture();await f.model.load();f.model.draft.workMode=true;f.actual=preferences(false,true);f.failure={code:'DESKTOP_CONFLICT',message:'synthetic conflict'};
 assert.equal(await f.model.save(),false);await f.model.load();assert.deepEqual(f.model.saved.value,preferences(false,true));
 assert.equal(f.model.draft.workMode,true);assert.equal(f.model.draft.petOnStartup,false);assert.equal(f.model.dirty.value,true);
 f.model.discard();assert.equal(f.model.dirty.value,false);assert.equal(f.model.draft.petOnStartup,true);
});
test('an older read cannot overwrite a later confirmation or publish after disposal',async()=>{
 const pending=deferred();let reads=0;const model=createDesktopPreferences(async()=>++reads===1?pending.promise:preferences(true));
 const old=model.load();await model.load();pending.resolve(preferences());await old;assert.equal(model.appliedWorkMode.value,true);
 const later=deferred(),disposed=createDesktopPreferences(()=>later.promise);const read=disposed.load();disposed.dispose();later.resolve(preferences(true,true));await read;assert.equal(disposed.ready.value,false);assert.deepEqual(disposed.saved.value,preferences());
});
test('reads and duplicate writes cannot race an in-flight save or replace newer edits',async()=>{
 const pending=deferred(),calls=[];const model=createDesktopPreferences(async(command,args)=>{calls.push({command,args});return command==='read_desktop_preferences'?preferences():pending.promise;});
 await model.load();model.draft.workMode=true;const save=model.save();await model.load();assert.equal(await model.save(),false);
 model.draft.petOnStartup=true;pending.resolve({preferences:preferences(true),warning:'synthetic sync warning'});await save;
 assert.equal(calls.length,2);assert.equal(model.draft.petOnStartup,true);assert.equal(model.notice.value,'synthetic sync warning');assert.equal(model.appliedWorkMode.value,true);
});
test('a save response after disposal cannot publish success or erase its draft',async()=>{
 const pending=deferred();const model=createDesktopPreferences(async command=>command==='read_desktop_preferences'?preferences():pending.promise);
 await model.load();model.draft.workMode=true;const save=model.save();model.dispose();pending.resolve({preferences:preferences(true),warning:null});await save;
 assert.deepEqual(model.saved.value,preferences());assert.equal(model.draft.workMode,true);assert.equal(model.notice.value,'');
});
function environment(){
 const events=new EventTarget(),visibility=new EventTarget();visibility.hidden=false;
 const attributes=new Map();return {events,visibility,attributes,target:{setAttribute:(k,v)=>attributes.set(k,v),removeAttribute:k=>attributes.delete(k)}};
}
test('three production windows converge after initial setup without focus, then recover lost events on focus',async()=>{
 let initialized=false;const handlers=new Set(),views=[];
 for(let index=0;index<3;index++){
  const env=environment(),model=createDesktopPreferences(async command=>{
   if(command==='read_desktop_status')return {enabled:true};
   if(!initialized)throw {code:'SETUP_REQUIRED',message:'synthetic setup required'};
   return preferences(false,true);
  });
  await model.start(env.target,env.events,env.visibility,async handler=>{handlers.add(handler);return ()=>handlers.delete(handler);});views.push({model,...env});
 }
 initialized=true;for(const handler of handlers)handler();await new Promise(resolve=>setImmediate(resolve));
 for(const view of views){assert.equal(view.attributes.get('data-work-mode'),'false');assert.equal(view.model.saved.value.petOnStartup,true);}
 for(const view of views)view.model.dispose();assert.equal(handlers.size,0);assert.ok(views.every(v=>!v.attributes.has('data-work-mode')));
 const f=fixture(),env=environment();await f.model.start(env.target,env.events,env.visibility,async()=>()=>{});
 f.actual=preferences(true);env.events.dispatchEvent(new Event('focus'));await new Promise(resolve=>setImmediate(resolve));assert.equal(env.attributes.get('data-work-mode'),'true');f.model.dispose();
});
test('late subscription cleanup and the dedicated verification gate have no preference side effects',async()=>{
 const pending=deferred(),env=environment();let stops=0,reads=0;
 const model=createDesktopPreferences(async command=>{if(command==='read_desktop_status')return {enabled:true};reads++;return preferences();});
 const start=model.start(env.target,env.events,env.visibility,()=>pending.promise);await Promise.resolve();model.dispose();pending.resolve(()=>{stops++;});await start;assert.equal(stops,1);assert.equal(reads,0);assert.equal(env.attributes.size,0);
 const calls=[],special=createDesktopPreferences(async command=>{calls.push(command);return {enabled:false};});await special.start(env.target,env.events,env.visibility,async()=>{throw Error('must not subscribe');});
 assert.deepEqual(calls,['read_desktop_status']);assert.equal(env.attributes.size,0);special.dispose();
});
function panelComponent(model,shallow=false){
 const modules=new Map();
 function component(url){
  if(modules.has(url.href))return modules.get(url.href);
  const {descriptor}=parse(readFileSync(url,'utf8'),{filename:url.pathname});
  const script=compileScript(descriptor,{id:url.pathname,inlineTemplate:true});
  const code=ts.transpileModule(script.content,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const exports={};
  Function('require','exports',code)(name=>{
   if(name==='vue')return Vue;
   if(name==='tdesign-vue-next')return design;
   if(name.endsWith('/desktopPreferences'))return {useDesktopPreferences:()=>model};
   if(shallow&&name.endsWith('.vue'))return {default:{setup:(_,context)=>()=>Vue.h('section',context.slots.default?.())}};
   if(name==='./control')return controls;
   if(name.endsWith('Icon.vue'))return {default:{render:()=>Vue.h('span',{'aria-hidden':'true'})}};
   if(name.endsWith('.vue'))return {default:component(new URL(name,url))};
   throw Error(`unexpected component dependency: ${name}`);
  },exports);
  modules.set(url.href,exports.default);return exports.default;
 }
 return component(new URL('../../src/components/DesktopSettingsPanel.vue',import.meta.url));
}
function mountPanel(model){
 const node=type=>({type,children:[],parent:null});
 const renderer=Vue.createRenderer({
  patchProp(){},createElement:node,createText:()=>node('#text'),createComment:()=>node('#comment'),setText(){},setElementText(){},
  parentNode:el=>el.parent,nextSibling:()=>null,
  insert(el,parent){el.parent=parent;parent.children.push(el);},remove(el){if(el.parent)el.parent.children=el.parent.children.filter(child=>child!==el);},
 });
 const app=renderer.createApp(panelComponent(Vue.reactive(model),true));app.mount(node('root'));return app;
}
for(const outcome of ['unknown','conflict'])test(`desktop tab remount cannot reconcile ${outcome} without the explicit button`,async()=>{
 const f=fixture();await f.model.load();f.model.draft.workMode=true;
 f.failure=outcome==='unknown'?{code:'DESKTOP_UNCERTAIN',message:'synthetic unknown'}:{code:'DESKTOP_CONFLICT',message:'synthetic conflict'};
 await f.model.save();assert.equal(f.model.ready.value,false);
 const app=mountPanel(f.model);await new Promise(resolve=>setImmediate(resolve));await Vue.nextTick();app.unmount();
 assert.equal(f.model.ready.value,false);assert.match(f.model.error.value,/synthetic/);assert.equal(f.model.draft.workMode,true);
 await f.model.load();assert.equal(f.model.ready.value,true);
});
test('a dirty background read cannot advance the CAS baseline and overwrite independent settings changes',async()=>{
 const f=fixture();await f.model.load();f.model.draft.workMode=true;f.actual=preferences(false,true);
 await f.model.load(false);assert.equal(await f.model.save(),false);assert.equal(f.actual.petOnStartup,true);
 assert.equal(f.model.draft.workMode,true);assert.equal(f.model.draft.petOnStartup,false);assert.equal(f.model.ready.value,false);
 assert.equal(f.calls.filter(c=>c.command==='save_desktop_preferences').length,0);
 await f.model.load();assert.equal(f.model.ready.value,true);assert.deepEqual(f.model.saved.value,preferences(false,true));
});
test('actual desktop SFC renders defaults, busy and unknown outcomes with one object save bar',async()=>{
 const f=fixture(),model=Vue.reactive(f.model),component=panelComponent(model);
 await f.model.load();const context={};
 const initial=await renderToString(Vue.createSSRApp(component),context);
 assert.match(initial,/工作模式/);assert.match(initial,/启动时显示班班/);assert.match(initial,/role="switch"/);assert.match(initial,/aria-describedby=/);
 assert.equal((context.teleports['#settings-save-slot'].match(/class="settings-savebar"/g)||[]).length,1);
 assert.match(context.teleports['#settings-save-slot'],/保存桌面偏好/);assert.doesNotMatch(context.teleports['#settings-save-slot'],/保存设置/);
 f.model.loading.value=true;assert.match(await renderToString(Vue.createSSRApp(component)),/正在读取桌面偏好/);
 f.model.loading.value=false;f.model.ready.value=false;f.model.error.value='合成结果未知';
 const uncertain=await renderToString(Vue.createSSRApp(component));assert.match(uncertain,/合成结果未知/);assert.match(uncertain,/重新读取，保留草稿/);assert.match(uncertain,/<fieldset disabled/);
 f.model.ready.value=true;f.model.error.value='';f.model.saving.value=true;assert.match(await renderToString(Vue.createSSRApp(component)),/<fieldset disabled/);
});
