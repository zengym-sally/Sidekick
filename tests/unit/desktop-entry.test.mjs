import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createQuickEntry} from '../../src/stores/quickEntry.ts';
import {createDesktopWindows} from '../../src/stores/desktop.ts';
import {desktopSurface,isLocalCaptureShortcut,observeWorkspaceChanges} from '../../src/domain/desktop.ts';

const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
test('desktop store routes fixed actions and discards old status responses',async()=>{
  const pending=deferred(),calls=[];
  const desktop=createDesktopWindows(async(command,args)=>{calls.push({command,args});if(command==='read_desktop_status')return calls.length===1?pending.promise:{enabled:true,shortcutRegistered:true};});
  const old=desktop.refreshStatus();await desktop.refreshStatus();pending.resolve({enabled:true,shortcutRegistered:false});await old;
  assert.equal(desktop.status.value.shortcutRegistered,true);await desktop.act('open_main');assert.deepEqual(calls.at(-1),{command:'desktop_window_action',args:{action:'open_main'}});
});
test('desktop action and status responses cannot publish into a disposed window',async()=>{
  const pending=deferred();let calls=0;const desktop=createDesktopWindows(async()=>{calls++;return pending.promise;});
  const read=desktop.refreshStatus();desktop.dispose();pending.resolve({enabled:true,shortcutRegistered:true});await read;
  assert.equal(desktop.status.value,null);await desktop.refreshStatus();assert.equal(await desktop.act('open_quick'),false);assert.equal(calls,1);
});
test('an older window action failure cannot replace a newer successful action',async()=>{
  const pending=deferred();let calls=0;const desktop=createDesktopWindows(async()=>++calls===1?pending.promise:undefined);
  const old=desktop.act('open_main');await desktop.act('open_quick');pending.resolve(Promise.reject(Error('old action failed')));await old;assert.equal(desktop.error.value,'');
});
function fixture(){
  const calls=[],written=new Map();let ready=true,root='/synthetic/root',zone='UTC',failure=null,hideFailure=false,serial=0;
  const api=async(command,args)=>{
    calls.push({command,args});
    if(command==='workspace_info')return {needsSetup:!ready,root:ready?root:null,defaultRoot:'/synthetic/default',pendingRoot:null};
    if(command==='read_application_settings')return {timeZone:zone};
    if(command==='desktop_window_action'){if(hideFailure)throw Error('hide failed');return;}
    if(command==='create_todo'){
      if(failure?.code==='INVALID_INPUT')throw failure;
      if(!written.has(args.operationId))written.set(args.operationId,{id:'synthetic-todo',data:args.input,source:'manual',version:1,status:'open'});
      if(failure)throw failure;
      return written.get(args.operationId);
    }
    throw Error(command);
  };
  const model=createQuickEntry(api,()=>`operation-${++serial}`);
  return {model,api,calls,written,set ready(v){ready=v;},set root(v){root=v;},set zone(v){zone=v;},set failure(v){failure=v;},set hideFailure(v){hideFailure=v;}};
}
test('production routes keep explicit S0 routes distinct and shortcut modifiers do not overlap',()=>{
  assert.equal(desktopSurface('?window=quick'),'quick');assert.equal(desktopSurface('?window=pet'),'pet');
  assert.equal(desktopSurface('?quick=1'),'probe');assert.equal(desktopSurface('?pet=1'),'probe');assert.equal(desktopSurface('?probe=1'),'probe');assert.equal(desktopSurface('?window=other'),'main');
  const key={key:'k',metaKey:true,ctrlKey:false,shiftKey:false,altKey:false,isComposing:false};
  assert.equal(isLocalCaptureShortcut(key),true);
  for(const patch of [{shiftKey:true},{altKey:true},{ctrlKey:true},{isComposing:true},{key:'x'}])assert.equal(isLocalCaptureShortcut({...key,...patch}),false);
});
test('quick entry restores readiness after main setup and never starts models or skills',async()=>{
  const f=fixture();f.ready=false;await f.model.activate();assert.equal(f.model.ready.value,false);
  f.ready=true;await f.model.activate();assert.equal(f.model.ready.value,true);
  assert.ok(f.calls.every(c=>['workspace_info','read_application_settings'].includes(c.command)));
});
test('a committed quick entry clears its draft once and visibility failure stays a saved outcome',async()=>{
  const f=fixture();await f.model.activate();f.model.form.title='合成快捷事项';f.hideFailure=true;
  assert.equal(await f.model.save(),true);assert.equal(f.written.size,1);assert.equal(f.model.form.title,'');
  assert.match(f.model.notice.value,/已保存/);assert.equal(f.model.uncertain.value,false);
  assert.equal(await f.model.save(),false);assert.equal(f.written.size,1);
});
test('unknown quick save freezes the original operation across edits and activation until idempotent replay',async()=>{
  const f=fixture();await f.model.activate();f.model.form.title='原请求';f.failure=Error('response lost');
  assert.equal(await f.model.save(),false);assert.equal(f.model.uncertain.value,true);assert.equal(f.written.size,1);
  const first=f.calls.find(c=>c.command==='create_todo');f.model.form.title='cannot bypass';f.zone='Asia/Shanghai';await f.model.activate();
  f.failure=null;assert.equal(await f.model.save(),true);
  const sent=f.calls.filter(c=>c.command==='create_todo');assert.equal(sent.length,2);assert.deepEqual(sent[1].args,first.args);assert.equal(f.written.size,1);
});
test('quick activation preserves the instant of a timed draft when current timezone changes',async()=>{
  const f=fixture();await f.model.activate();f.model.form.title='跨区合成';Object.assign(f.model.form.due,{enabled:true,raw:'2026-11-04T09:00'});
  f.zone='Asia/Shanghai';await f.model.activate();assert.equal(f.model.form.due.raw,'2026-11-04T17:00');
  assert.equal(await f.model.save(),true);assert.equal([...f.written.values()][0].data.due.atMs,Date.parse('2026-11-04T09:00Z'));
});
test('a late activation cannot overwrite a newer workspace confirmation',async()=>{
  const pending=deferred();let count=0;
  const model=createQuickEntry(async command=>command==='workspace_info'?(++count===1?pending.promise:{needsSetup:false,root:'/synthetic/root'}):{timeZone:'UTC'});
  const old=model.activate();await model.activate();pending.resolve({needsSetup:true,root:null});await old;assert.equal(model.ready.value,true);
});
test('context read failure preserves quick draft and prevents dispatch',async()=>{
  const model=createQuickEntry(async()=>{throw Error('read failed');});model.form.title='保留输入';await model.activate();
  assert.equal(await model.save(),false);assert.equal(model.form.title,'保留输入');assert.equal(model.ready.value,false);
});
test('a failed save-time context recheck revokes an earlier ready state',async()=>{
  let fail=false,writes=0;
  const model=createQuickEntry(async command=>{
    if(command==='workspace_info'){if(fail)throw Error('read unavailable');return {needsSetup:false,root:'/synthetic/root'};}
    if(command==='read_application_settings')return {timeZone:'UTC'};
    writes++;throw Error('unexpected dispatch');
  });
  await model.activate();assert.equal(model.ready.value,true);model.form.title='保留已确认草稿';fail=true;
  assert.equal(await model.save(),false);assert.equal(model.ready.value,false);assert.equal(writes,0);assert.equal(model.form.title,'保留已确认草稿');
});
test('a different root cannot receive a retained draft or unresolved original operation',async()=>{
  for(const unknown of [false,true]){
    const f=fixture();await f.model.activate();f.model.form.title='原目录输入';
    if(unknown){f.failure=Error('response lost');await f.model.save();}
    const prior=f.calls.filter(c=>c.command==='create_todo').length;f.root='/synthetic/other';await f.model.activate();
    assert.equal(await f.model.save(),false);assert.equal(f.calls.filter(c=>c.command==='create_todo').length,prior);assert.equal(f.model.form.title,'原目录输入');
  }
});
test('explicit input rejection permits correction without turning validation into an unknown result',async()=>{
  const f=fixture();await f.model.activate();f.model.form.title='可改正输入';f.failure={code:'INVALID_INPUT',message:'invalid tag'};
  assert.equal(await f.model.save(),false);assert.equal(f.model.uncertain.value,false);assert.equal(f.written.size,0);
  f.failure=null;f.model.form.tags='合成';assert.equal(await f.model.save(),true);assert.equal(f.written.size,1);
  const sent=f.calls.filter(c=>c.command==='create_todo');assert.notEqual(sent[0].args.operationId,sent[1].args.operationId);
});
test('an initially lost validation response can be resolved before correcting the draft',async()=>{
  const calls=[];let attempts=0;
  const model=createQuickEntry(async(command,args)=>{
    if(command==='workspace_info')return {needsSetup:false,root:'/synthetic/root'};
    if(command==='read_application_settings')return {timeZone:'UTC'};
    if(command==='create_todo'){calls.push(args);if(++attempts===1)throw Error('validation reply lost');if(attempts===2)throw {code:'INVALID_INPUT',message:'invalid tag'};return {id:'saved'};}
  });
  await model.activate();model.form.title='校验结果待核';await model.save();assert.equal(model.uncertain.value,true);
  await model.save();assert.equal(model.uncertain.value,false);assert.deepEqual(calls[1],calls[0]);
  model.form.tags='已改正';assert.equal(await model.save(),true);assert.notEqual(calls[2].operationId,calls[0].operationId);
});
test('parallel save clicks cannot dispatch a second mutation while the first is unresolved',async()=>{
  const pending=deferred();let writes=0;
  const model=createQuickEntry(async command=>command==='workspace_info'?{needsSetup:false,root:'/synthetic/root'}:command==='read_application_settings'?{timeZone:'UTC'}:command==='create_todo'?(writes++,pending.promise):undefined);
  await model.activate();model.form.title='一次保存';const first=model.save();assert.equal(await model.save(),false);
  await new Promise(resolve=>setImmediate(resolve));assert.equal(writes,1);pending.resolve({id:'saved'});assert.equal(await first,true);assert.equal(writes,1);
});
test('workspace observation subscribes before initial read and cannot let an older snapshot win',async()=>{
  const {createTodoModel}=await import('../../src/stores/todos.ts');const first=deferred();let changed,reads=0;
  const model=createTodoModel(async command=>command==='workspace_info'?{needsSetup:false,root:'/synthetic/root'}:++reads===1?first.promise:[{id:'new',version:1}]);
  const observer=observeWorkspaceChanges(async handler=>{changed=handler;return ()=>{};},()=>model.boot(),()=>model.refresh());
  await Promise.resolve();await Promise.resolve();await Promise.resolve();changed();await Promise.resolve();first.resolve([]);await observer.ready;
  assert.equal(model.rows.value[0].id,'new');observer.stop();
});
test('a late subscription is disposed after unmount without starting a read',async()=>{
  const pending=deferred();let reads=0,stops=0;const observer=observeWorkspaceChanges(()=>pending.promise,async()=>{reads++;},async()=>{reads++;});
  observer.stop();pending.resolve(()=>{stops++;});await observer.ready;assert.equal(stops,1);assert.equal(reads,0);
});
test('lost notifications and subscription failure can recover with an explicit focus read',async()=>{
  let value=0,current=-1;const observer=observeWorkspaceChanges(async()=>{throw Error('listener unavailable');},async()=>{current=value;},async()=>{current=value;});
  await observer.ready;assert.equal(observer.connected.value,false);value=1;assert.equal(current,0);await observer.refresh();assert.equal(current,1);observer.stop();
  value=2;await observer.refresh();assert.equal(current,1);
});
test('Workbench does not start another fact read after unmount during a focus refresh',async()=>{
  const text=readFileSync(new URL('../../src/components/Workbench.vue',import.meta.url),'utf8');
  const method=text.match(/async function readWindowFacts\(\)\{[^\n]+\}/)?.[0];assert.ok(method);
  const pending=deferred();let facts=0;
  const store={workspace:{needsSetup:false},refresh:()=>pending.promise};
  const todayAdvice={loading:false,load:async()=>{facts++;}};
  const view=Function('store','todayAdvice',`let workbenchAlive=true;${method};return {read:readWindowFacts,stop:()=>{workbenchAlive=false}};`)(store,todayAdvice);
  const read=view.read();view.stop();pending.resolve();await read;assert.equal(facts,0);
});
