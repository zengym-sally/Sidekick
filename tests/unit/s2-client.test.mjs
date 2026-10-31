import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from 'vue';
import { createPinia,setActivePinia } from 'pinia';
import { createOrganizerModel,useOrganizer } from '../../src/stores/organizer.ts';
import { createModelSettings } from '../../src/stores/models.ts';
import { runError } from '../../src/domain/organizer.ts';
import { timeDraft,draftPoint } from '../../src/domain/time.ts';
import { todayLists,isOverdue,displayPoint } from '../../src/domain/todos.ts';
const fields={title:'合成事项',kind:'action',owner:'我',priority:'medium',tags:[],due:null,followup:null};
const batch=id=>({source:{id,rawText:'合成原文',timeZone:'Asia/Shanghai'},candidates:[],previews:[],run:null,started:false});
const run=(overrides={})=>({id:'A',sourceId:'source-a',kind:'extract',status:'running',snapshot:{},input:{},candidateId:null,candidateVersion:null,preview:null,errorCode:null,createdAtMs:1,finishedAtMs:null,...overrides});
const unknown=(overrides={})=>run({status:'failed',errorCode:'MCP_RESULT_UNKNOWN',finishedAtMs:3,snapshot:{checkpoint:'persisted unknown'},...overrides});
const imported=(value,overrides={})=>({...batch(value.sourceId),run:value,started:true,...overrides});
function deferred(){let resolve,reject;const promise=new Promise((finish,fail)=>{resolve=finish;reject=fail;});return {promise,resolve,reject};}
function fixtureApi(current,source=imported(current)){
 const fixture={current,source,overrides:{},calls:[]};
 fixture.api=async(command,args)=>{fixture.calls.push({command,args});if(fixture.overrides[command])return fixture.overrides[command](args);if(command==='list_import_batches')return [{id:fixture.source.source.id,pending:fixture.source.candidates.length}];if(command==='active_model_run')return fixture.current.id;if(command==='read_model_run')return fixture.current;if(command==='read_import_batch')return fixture.source;throw Error(command);};
 return fixture;
}
test('late source reads cannot replace the current selection',async()=>{
  const reads=[];const model=createOrganizerModel(async(command,args)=>{if(command==='list_import_batches')return new Promise(resolve=>reads.push(resolve));if(command==='active_model_run')return null;if(command==='read_import_batch')return batch(args.id);throw Error(command);});
  const old=model.select('a'),recent=model.select('b');reads[1]([{id:'b',pending:0}]);await recent;reads[0]([{id:'a',pending:0}]);await old;
  assert.equal(model.selected.value,'b');assert.equal(model.batch.value.source.id,'b');
});
test('a committed sign result survives a failed post-commit read',async()=>{
  const todo={id:'committed',data:fields,version:1};const model=createOrganizerModel(async command=>{if(command==='sign_candidates')return [todo];throw {message:'暂不可读'};});
  assert.equal((await model.sign([],'operation'))[0].id,'committed');assert.ok(model.error.value.includes('已提交'));
});
test('candidate refresh preserves a newer draft and requires explicit reload',()=>{
  const model=createOrganizerModel(async()=>{});const c={id:'c',sourceId:'s',runId:'r',status:'pending',version:1,draft:{fields,evidence:'合成',unresolved:false,warnings:[]},acceptedTodoId:null};
  model.sync(c);model.drafts.c.title='用户未保存修改';model.sync({...c,version:2});assert.equal(model.drafts.c.title,'用户未保存修改');assert.equal(model.drafts.c.stale,true);
  model.sync({...c,version:2},true);assert.equal(model.drafts.c.title,'合成事项');
});
test('saving candidate fields preserves the explicit selection and target association',()=>{
  const model=createOrganizerModel(async()=>{});const c={id:'c',sourceId:'s',runId:'r',status:'pending',version:1,draft:{fields,evidence:'合成',unresolved:false,warnings:[]},acceptedTodoId:null};
  model.sync(c);model.drafts.c.selected=false;model.drafts.c.targetId='existing';model.drafts.c.targetVersion=7;
  model.sync({...c,version:2},true);assert.equal(model.drafts.c.selected,false);assert.equal(model.drafts.c.targetId,'existing');assert.equal(model.drafts.c.targetVersion,7);
});
test('date-only editing and overdue checks preserve the original day and timezone',()=>{
  const previous=process.env.TZ;process.env.TZ='Asia/Shanghai';try{
    const point={atMs:Date.parse('2026-10-30T04:00:00Z'),timeZone:'America/New_York',localText:'周五',precision:'day'};
    const todo={id:'day',data:{...fields,due:point},status:'open'};
    assert.equal(draftPoint(timeDraft(point)),point);assert.ok(!displayPoint(point).includes('00:00'));
    assert.equal(isOverdue(todo,Date.parse('2026-10-31T03:59:00Z')),false);assert.equal(isOverdue(todo,Date.parse('2026-10-31T04:00:00Z')),true);
    assert.equal(todayLists([todo],Date.parse('2026-10-30T01:00:00Z')).action.length,1);
    const skipped={...todo,data:{...fields,due:{atMs:Date.parse('2011-12-29T10:00:00Z'),timeZone:'Pacific/Apia',localText:'2011-12-29',precision:'day'}}};
    assert.equal(isOverdue(skipped,Date.parse('2026-10-29T01:00:00Z')),true);
  }finally{if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous;}
});
test('catalog saves preserve a newer object draft and confirmed revision',async()=>{
 const config={providers:{providers:[{id:'p',name:'原服务',baseUrl:'https://example.invalid/v1',apiFormat:'openai-compatible',auth:{type:'bearer',apiKeyEnv:'FIXTURE'}}]},models:{models:[{id:'m',providerId:'p',apiModelId:'wire'}]},defaultModelId:'m',revision:'old',credentialStatus:{p:'missing'}};
 let finish;const model=createModelSettings(async command=>command==='read_model_configuration'?config:new Promise(resolve=>finish=resolve));await model.load();model.providerDraft.value.name='提交草稿';const saving=model.saveProvider();model.providerDraft.value.name='更新草稿';finish({configuration:{...config,providers:{providers:[{...config.providers.providers[0],name:'提交草稿'}]},revision:'new'},warning:null});await saving;assert.equal(model.providerDraft.value.name,'更新草稿');assert.equal(model.configuration.value.revision,'new');assert.equal(model.dirty.value,true);
});
test('saving one catalog object preserves another model draft until explicit discard',async()=>{
 let config={providers:{providers:[{id:'p',name:'原服务',baseUrl:'https://example.invalid/v1',apiFormat:'openai-compatible',auth:{type:'bearer',apiKeyEnv:'FIXTURE'},tags:['retain']}]},models:{models:[{id:'m',providerId:'p',apiModelId:'wire',custom:{retain:true}},{id:'other',providerId:'p',apiModelId:'other-wire'}]},defaultModelId:'m',revision:'old',credentialStatus:{p:'missing'}};
 const model=createModelSettings(async(command,args)=>{if(command==='read_model_configuration')return config;config={...config,providers:args.input.providers,models:args.input.models,defaultModelId:args.input.defaultModelId,revision:'new'};return {configuration:config,warning:null};});await model.load();model.editModel('other');model.modelDraft.value.apiModelId='未保存标识';model.selectProvider('p');model.providerDraft.value.name='更新服务';await model.saveProvider();assert.deepEqual(config.providers.providers[0].tags,['retain']);assert.equal(config.models.models[0].custom.retain,true);model.editModel('other');assert.equal(model.modelDraft.value.apiModelId,'未保存标识');model.discard();assert.equal(model.modelDraft.value.apiModelId,'other-wire');assert.equal(model.dirty.value,false);
});
for(const late of [
 {status:'running'},
 {status:'queued'},
 {status:'succeeded',finishedAtMs:2},
 {status:'cancelled',finishedAtMs:2},
 {status:'interrupted',finishedAtMs:2},
 {status:'failed',errorCode:'MODEL_SERVICE',finishedAtMs:2},
 {status:'failed',errorCode:'MCP_RESULT_UNKNOWN',finishedAtMs:2,snapshot:{checkpoint:'older unknown'}},
])test(`a refresh cannot replace persisted unknown in the current run, batch or preview with ${late.status}/${late.errorCode||'ordinary'}`,async()=>{
 const persisted=unknown(),preview=unknown({id:'R',kind:'revise',candidateId:'c',candidateVersion:1}),fixture=fixtureApi(persisted,imported(persisted,{previews:[preview]})),model=createOrganizerModel(fixture.api),read=deferred();
 await model.select('source-a');fixture.overrides.read_model_run=()=>read.promise;fixture.source=imported(run(late),{previews:[run({...preview,...late})]});const refreshing=model.refresh();read.resolve(run(late));await refreshing;
 assert.deepEqual(model.run.value,persisted);assert.deepEqual(model.batch.value.run,persisted);assert.deepEqual(model.batch.value.previews,[preview]);assert.equal(model.running.value,false);
});
for(const status of ['running','queued'])test(`a refresh cannot revive ordinary terminal runs or previews as ${status}`,async()=>{
 const terminal=run({status:'succeeded',finishedAtMs:2}),preview=run({id:'R',kind:'revise',status:'interrupted',finishedAtMs:2}),fixture=fixtureApi(terminal,imported(terminal,{previews:[preview]})),model=createOrganizerModel(fixture.api),read=deferred();
 await model.select('source-a');fixture.overrides.read_model_run=()=>read.promise;fixture.source=imported(run({status}),{previews:[{...preview,status,finishedAtMs:null}]});const refreshing=model.refresh();read.resolve(run({status}));await refreshing;
 assert.deepEqual(model.run.value,terminal);assert.deepEqual(model.batch.value.run,terminal);assert.deepEqual(model.batch.value.previews,[preview]);assert.equal(model.running.value,false);
});
test('batch unknown takes priority over the same running model read and suppresses its late candidates',async()=>{
 const persisted=unknown(),candidate={id:'c',sourceId:'source-a',runId:'A',status:'pending',version:1,draft:{fields,evidence:'合成',unresolved:false,warnings:[]},acceptedTodoId:null},fixture=fixtureApi(run(),imported(persisted,{candidates:[candidate]})),model=createOrganizerModel(fixture.api);
 await model.select('source-a');assert.deepEqual(model.run.value,persisted);assert.deepEqual(model.batch.value.run,persisted);assert.deepEqual(model.batch.value.candidates,[]);assert.equal(model.drafts.c,undefined);
});
test('the current unknown run also absorbs a stale successful batch response',async()=>{
 const persisted=unknown(),fixture=fixtureApi(persisted,imported(run({status:'succeeded',finishedAtMs:2}))),model=createOrganizerModel(fixture.api);
 await model.select('source-a');assert.deepEqual(model.batch.value.run,persisted);
});
test('a preview unknown takes priority over a stale current run read',async()=>{
 const persisted=unknown({id:'R',kind:'revise',candidateId:'c',candidateVersion:1}),fixture=fixtureApi(run({...persisted,status:'running',errorCode:null,finishedAtMs:null}),imported(run({id:'E',status:'succeeded',finishedAtMs:2}),{previews:[persisted]})),model=createOrganizerModel(fixture.api);
 await model.select('source-a');assert.deepEqual(model.run.value,persisted);assert.deepEqual(model.batch.value.previews,[persisted]);
});
test('a persisted unknown survives leaving and rereading the same batch',async()=>{
 const persisted=unknown(),fixture=fixtureApi(run({id:'R',kind:'revise'}),imported(persisted)),model=createOrganizerModel(fixture.api);
 await model.select('source-a');fixture.source=batch('source-b');await model.select('source-b');fixture.source=imported(run({status:'succeeded',finishedAtMs:2}));await model.select('source-a');assert.deepEqual(model.batch.value.run,persisted);
});
test('a refresh can promote an ordinary terminal run and preview to persisted unknown',async()=>{
 const persisted=unknown(),preview=unknown({id:'R',kind:'revise'}),fixture=fixtureApi(run({status:'succeeded',finishedAtMs:2}),imported(run({status:'cancelled',finishedAtMs:2}),{previews:[run({...preview,status:'interrupted',errorCode:null,finishedAtMs:2})]})),model=createOrganizerModel(fixture.api);
 await model.select('source-a');fixture.current=persisted;fixture.source=imported(persisted,{previews:[preview]});await model.refresh();assert.deepEqual(model.run.value,persisted);assert.deepEqual(model.batch.value.run,persisted);assert.deepEqual(model.batch.value.previews,[preview]);
});
test('a late cancellation cannot replace unknown reconciled by refresh',async()=>{
 const cancellation=deferred(),fixture=fixtureApi(run()),model=createOrganizerModel(fixture.api),persisted=unknown();fixture.overrides.cancel_model_run=()=>cancellation.promise;
 await model.select('source-a');const cancelling=model.cancel();fixture.current=persisted;fixture.source=imported(persisted);await model.refresh();fixture.overrides.list_import_batches=()=>{throw Error('synthetic post-cancel read unavailable');};cancellation.resolve(run({status:'cancelled',finishedAtMs:2}));await cancelling;
 assert.deepEqual(model.run.value,persisted);assert.deepEqual(model.batch.value.run,persisted);assert.equal(model.running.value,false);
});
test('a late cancellation cannot replace a newer run or restart reads for the previous source',async()=>{
 const cancellation=deferred(),newer=run({id:'B',sourceId:'source-b',createdAtMs:4}),fixture=fixtureApi(run()),model=createOrganizerModel(fixture.api);fixture.overrides.cancel_model_run=()=>cancellation.promise;fixture.overrides.organize_text=()=>{fixture.current=newer;fixture.source=imported(newer);return newer;};
 await model.select('source-a');const cancelling=model.cancel();await model.organize(null);const calls=fixture.calls.length;cancellation.resolve(run({status:'cancelled',finishedAtMs:2}));await cancelling;
 assert.deepEqual(model.run.value,newer);assert.equal(model.selected.value,'source-b');assert.equal(model.batch.value.source.id,'source-b');assert.equal(fixture.calls.length,calls);assert.equal(model.running.value,true);
});
test('a late candidate mutation preserves the current source and its newer draft',async()=>{
 const saving=deferred(),candidate={id:'c',sourceId:'source-a',runId:'A',status:'pending',version:1,draft:{fields,evidence:'合成',unresolved:false,warnings:[]},acceptedTodoId:null},fixture=fixtureApi(run(),imported(run(),{candidates:[candidate]})),model=createOrganizerModel(fixture.api);fixture.overrides.save_candidate=()=>saving.promise;
 await model.select('source-a');const committed=model.saveCandidate(candidate,fields,true,'save-operation');fixture.source=batch('source-b');await model.select('source-b');model.drafts.c.title='用户更新草稿';const calls=fixture.calls.length;saving.resolve({...candidate,version:2});assert.equal((await committed).version,2);
 assert.equal(model.selected.value,'source-b');assert.equal(model.batch.value.source.id,'source-b');assert.equal(model.drafts.c.title,'用户更新草稿');assert.equal(fixture.calls.length,calls);
});
test('a late mutation failure cannot replace the error for the current selection',async()=>{
 const cancellation=deferred(),fixture=fixtureApi(run()),model=createOrganizerModel(fixture.api);fixture.overrides.cancel_model_run=()=>cancellation.promise;
 await model.select('source-a');const cancelling=model.cancel();fixture.source=batch('source-b');await model.select('source-b');model.error.value='当前来源读取提示';cancellation.reject(Error('旧取消失败'));await assert.rejects(cancelling,/旧取消失败/);assert.equal(model.error.value,'当前来源读取提示');
});
for(const terminal of [unknown(),run({status:'interrupted',finishedAtMs:3})])test(`a late start response cannot replace the same ${terminal.errorCode||terminal.status} run`,async()=>{
 const starting=deferred(),fixture=fixtureApi(terminal),model=createOrganizerModel(fixture.api);fixture.overrides.organize_text=()=>starting.promise;
 const pending=model.organize(null);await model.refresh();fixture.overrides.list_import_batches=()=>{throw Error('synthetic post-start read unavailable');};starting.resolve(run());await pending;assert.deepEqual(model.run.value,terminal);assert.deepEqual(model.batch.value.run,terminal);assert.equal(model.running.value,false);
});
test('a late start response cannot move the current source selection',async()=>{
 const starting=deferred(),fixture=fixtureApi(run()),model=createOrganizerModel(fixture.api);fixture.overrides.organize_text=()=>starting.promise;
 const pending=model.organize(null);fixture.source=batch('source-b');await model.select('source-b');const calls=fixture.calls.length;starting.resolve(run());await pending;assert.equal(model.selected.value,'source-b');assert.equal(model.batch.value.source.id,'source-b');assert.equal(fixture.calls.length,calls);
});
test('a later start stays current when an earlier start returns last',async()=>{
 const first=deferred(),second=deferred(),newer=run({id:'B',sourceId:'source-b',createdAtMs:4}),fixture=fixtureApi(run()),model=createOrganizerModel(fixture.api);let calls=0;fixture.overrides.organize_text=()=>++calls===1?first.promise:second.promise;
 const old=model.organize(null),recent=model.organize(null);fixture.current=newer;fixture.source=imported(newer);second.resolve(newer);await recent;first.resolve(run());await old;assert.deepEqual(model.run.value,newer);assert.equal(model.selected.value,'source-b');assert.equal(model.running.value,true);
});
test('an explicit retry creates a new run after unknown and keeps the retained source input',async()=>{
 const newer=run({id:'B',createdAtMs:4}),fixture=fixtureApi(unknown()),model=createOrganizerModel(fixture.api);let requested;fixture.overrides.organize_text=args=>{requested=args;fixture.current=newer;fixture.source=imported(newer);return newer;};
 await model.select('source-a');await model.retry();assert.equal(requested.retry,true);assert.equal(requested.input.text,'合成原文');assert.deepEqual(model.run.value,newer);assert.deepEqual(model.batch.value.run,newer);assert.equal(model.running.value,true);
});
for(const createdAtMs of [1,4])test(`a stale active run created at ${createdAtMs} cannot replace the current explicit run`,async()=>{
 const newer=run({id:'B',sourceId:'source-b',createdAtMs:4}),fixture=fixtureApi(newer),model=createOrganizerModel(fixture.api);
 await model.select('source-b');fixture.current=unknown({createdAtMs});await model.refresh();assert.deepEqual(model.run.value,newer);assert.equal(model.selected.value,'source-b');assert.equal(model.batch.value.source.id,'source-b');
});
test('an explicit new run remains receivable after a refresh reconciles the old unknown',async()=>{
 const starting=deferred(),newer=run({id:'B',createdAtMs:4}),fixture=fixtureApi(unknown()),model=createOrganizerModel(fixture.api);fixture.overrides.organize_text=()=>starting.promise;
 await model.select('source-a');const pending=model.retry();await model.refresh();fixture.current=newer;fixture.source=imported(newer);starting.resolve(newer);await pending;assert.deepEqual(model.run.value,newer);assert.deepEqual(model.batch.value.run,newer);assert.equal(model.running.value,true);
});
test('formal MCP rejection messages refer to the current task',()=>{
 for(const errorCode of ['MCP_PRIVATE_OUTPUT','MCP_RESULT_INVALID']){const message=runError({errorCode});assert.match(message,/已停止本次任务/);assert.doesNotMatch(message,/试跑/);}
});
test('the process-isolated Pinia organizer keeps unknown when a Tauri cancellation response arrives late',async()=>{
 const previousWindow=Object.getOwnPropertyDescriptor(globalThis,'window'),cancellation=deferred(),fixture=fixtureApi(run()),persisted=unknown();let model;fixture.overrides.cancel_model_run=()=>cancellation.promise;
 assert.throws(()=>useOrganizer(),/no active Pinia/);
 try{
  Object.defineProperty(globalThis,'window',{configurable:true,writable:true,value:{__TAURI_INTERNALS__:{invoke:fixture.api}}});const app=createApp({});app.use(createPinia());model=app.runWithContext(()=>useOrganizer());
  await model.select('source-a');const cancelling=model.cancel();fixture.current=persisted;fixture.source=imported(persisted);await model.refresh();fixture.overrides.list_import_batches=()=>{throw Error('synthetic post-cancel read unavailable');};cancellation.resolve(run({status:'cancelled',finishedAtMs:2}));await cancelling;assert.deepEqual(model.run,persisted);assert.deepEqual(model.batch.run,persisted);assert.equal(model.running,false);
 }finally{model?.$dispose();setActivePinia(undefined);if(previousWindow)Object.defineProperty(globalThis,'window',previousWindow);else delete globalThis.window;}
 assert.throws(()=>useOrganizer(),/no active Pinia/);
});
