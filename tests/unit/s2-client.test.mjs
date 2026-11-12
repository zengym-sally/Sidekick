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
test('the process-isolated Pinia organizer keeps the newer authoritative state when a cancellation response arrives late',async()=>{
 // The store is built on the WEB pipe (`useOrganizer` -> `asBackend()` -> `fetch`),
 // so this case drives that real chain instead of the retired Tauri `invoke` seam.
 //
 // Every task row below is the serialization the frozen HTTP surface actually
 // emits for this scenario — generated in the preparation phase by the REAL
 // `rowToInternal`/`wireFrom` (its `visibleFailure`/`visibleResult`/
 // `recoveryFor`) and `sourceWire` of candidate I `cd08588` (record `56cf3db`),
 // raw rows mirroring the quoted transition SQL, with the outputs and their
 // provenance attached to the dispatch record. The facts that matter here:
 //   * a cancellable run starts from the REAL `running` row — claimNext moved
 //     it to v2 with `attempt_exit_state='active'` and `cancel_intent` 0. The
 //     `cancelling` row would also map to `running`, so the wire facts are
 //     pinned explicitly (see `wireReads`) instead of trusting the mapper;
 //   * cancelling a running task answers HTTP 202 with the REAL post-cancel
 //     row (v3, `cancelIntent` true, `attemptExitState` 'exiting') — nothing
 //     else answers 202; a terminal or `needs_review` task is refused with
 //     409 `state_conflict`;
 //   * the exit-unknown review row is REAL end to end: the transition keeps
 //     `cancel_intent` 1 (`needs_review` is not a `TERMINAL_STATES` member),
 //     the frozen 001 CHECK forces `terminal_at` NULL, `visibleFailure`
 //     publishes NOTHING for `exited_unknown` (wire `failure: null` — the
 //     internally stored `worker_lost`/`exit_unconfirmed` envelope stays
 //     invisible), and the recovery item carries `exit_unconfirmed` with
 //     `itemVersion` 1;
 //   * the source detail's `run` is the source's SUCCEEDED run only
 //     (text-intake `getSource`) — a source whose extract never succeeded
 //     answers `run: null`.
 const previousWindow=Object.getOwnPropertyDescriptor(globalThis,'window'),previousFetch=globalThis.fetch;
 const cancellation=deferred();const cancelArrived=deferred();
 // The wire facts of every task row the client actually consumed, in order.
 const wireReads=[];
 // Real wire rows (versions from the real transition chain submit v1 -> claim
 // v2 -> cancel v3 -> exit-unknown v4; timestamps on the same 1/2/3/4 ms line).
 const wireInputRef={configRevision:'r1',snapshot:null,sourceId:'source-a',anchorAtMs:1773981065250,
   source:{text:'合成原文',timeZone:'Asia/Shanghai',
     sourceAt:{at:'2026-03-20T04:31:05.250Z',timeZone:'Asia/Shanghai',localText:'2026-03-20 12:31',precision:'minute'}}};
 const unresolvedEvidence=()=>({verdict:'unresolved',workerExited:true,groupAbsent:false,
  registry:{total:1,confirmedExtinct:0,unobservable:1,survivors:[]},
  argvScan:null,
  veto:{triggered:true,reason:'insufficient_evidence',detail:null},
  residual:{treeExtinctProven:false,scope:'registry_domain',strayLedger:null},
  confirmedAt:null});
 const taskRow=(state,version,exit,cancelIntent,updatedAtMs)=>({contractVersion:'web-api/2',taskId:'A',operationId:'op-1',type:'extract',role:'organizer',
   state,version,createdAt:'1970-01-01T00:00:00.001Z',updatedAt:updatedAtMs,terminalAt:null,
   submitSeq:1,queuePosition:null,attemptCount:1,attemptId:'att-1',attemptExitState:exit,attemptExitEvidence:exit==='exited_unknown'?unresolvedEvidence():null,cancelIntent,
   configRevision:'r1',originalConfigRevision:'r1',inputRef:wireInputRef,
   progress:null,result:null,resultPendingExit:false,failure:null,
   recovery:state==='needs_review'
     ?{cause:'exit_unconfirmed',sideEffectKnown:false,autoResume:false,reason:null,receipts:[],itemVersion:1,stagedResult:false}
     :null});
 const runningTask=()=>taskRow('running',2,'active',false,'1970-01-01T00:00:00.002Z');
 const cancellingTask=()=>taskRow('cancelling',3,'exiting',true,'1970-01-01T00:00:00.003Z');
 const needsReviewTask=()=>taskRow('needs_review',4,'exited_unknown',true,'1970-01-01T00:00:00.004Z');
 const sourceRow=()=>({sourceId:'source-a',fingerprint:'1830d737b436a39e380ee5bf02b1c862d3211269dabd4be77a3f8e60aa44b293',kind:'text',rawText:'合成原文',
   sourceAt:{at:'2026-03-20T04:31:05.250Z',timeZone:'Asia/Shanghai',localText:'2026-03-20 12:31',precision:'minute'},
   importedAtMs:1,anchorAtMs:1773981065250,timeZone:'Asia/Shanghai',succeededRunId:null});
 // The authoritative row, as the backend holds it right now. Starts REAL
 // `running` (the state the cancel is issued from) and moves to REAL
 // `needs_review` while the cancellation response is still in flight.
 let authoritative=runningTask;
 // When set, the source-list read fails — the disclosed way to stop the
 // post-cancel refresh from masking the assignment's outcome.
 let readOutage=false;
 const calls=[];
 globalThis.fetch=async(url,init={})=>{
  const path=String(url).replace(/^https?:\/\/[^/]+/,'');
  calls.push({path,method:init.method??'GET'});
  const json=(status,body)=>({status,ok:status>=200&&status<300,text:async()=>JSON.stringify(body&&typeof body==='object'&&!Array.isArray(body)?{contractVersion:'web-api/2',...body}:body)});
  // The list only ever reports ACTIVE tasks, so it reflects the authoritative
  // row too — never a task the backend has already parked.
  if(path==='/api/text-sources?limit=200'){
   if(readOutage)throw Error('synthetic post-cancel read unavailable');
   return json(200,{sources:[sourceRow()],nextCursor:null});
  }
  if(path==='/api/text-sources/source-a/candidates?status=pending&limit=200')return json(200,{candidates:[],nextCursor:null});
  if(path==='/api/text-sources/source-a/candidates?limit=200')return json(200,{candidates:[],nextCursor:null});
  if(path==='/api/text-sources/source-a'){
   // The real detail line: `run` is the source's succeeded run — none here.
   return json(200,{source:sourceRow(),run:null,candidates:[],previews:[]});
  }
  if(path==='/api/tasks?limit=200'){const task=authoritative();wireReads.push({via:'list',state:task.state,version:task.version});return json(200,{tasks:[task],nextCursor:null});}
  if(path==='/api/tasks/A'){const task=authoritative();wireReads.push({via:'detail',state:task.state,version:task.version});return json(200,{task});}
  if(path==='/api/tasks/A/cancel'){
   // The request has arrived; the frozen 202 answer is held back until the
   // test releases it.
   cancelArrived.resolve();
   return cancellation.promise.then(task=>{wireReads.push({via:'cancel-response',status:202,state:task.state,version:task.version});return json(202,{task});});
  }
  throw Error(`unexpected path ${path}`);
 };
 let model;
 assert.throws(()=>useOrganizer(),/no active Pinia/);
 try{
  Object.defineProperty(globalThis,'window',{configurable:true,writable:true,value:{location:{host:'127.0.0.1:8787',origin:'http://127.0.0.1:8787'}}});
  const app=createApp({});app.use(createPinia());model=app.runWithContext(()=>useOrganizer());
  await model.select('source-a');
  assert.equal(model.run?.id,'A','the run is loaded before the cancel');
  assert.equal(model.run?.status,'running','the run starts from a cancellable running state');
  assert.equal(model.run?.errorCode,null,'the real running row publishes no failure');
  assert.equal(model.run?.finishedAtMs,null,'the real running row has no terminal time');
  // The wire facts prove the initial read consumed the REAL running row — a
  // `cancelling` row (which the mapper also folds to `running`) could not
  // produce them.
  assert.deepEqual(wireReads,[{via:'list',state:'running',version:2},{via:'detail',state:'running',version:2}]);
  // Issue the cancel. The server answers the frozen 202 `cancelling` row, but
  // the response is held back so it lands AFTER the newer authoritative state.
  const cancelling=model.cancel();
  // The POST reached the backend before anything else moves.
  await cancelArrived.promise;
  // While that response is in flight the worker's exit cannot be confirmed: the
  // backend parks the task for review, and a refresh observes the REAL
  // `needs_review` row.
  authoritative=needsReviewTask;
  await model.refresh();
  assert.equal(model.run?.status,'interrupted','the refresh adopts the newer needs_review state');
  assert.equal(model.run?.errorCode,null,'needs_review publishes failure:null on the wire (visibleFailure returns null for exited_unknown)');
  assert.equal(model.run?.finishedAtMs,null,'the frozen 001 CHECK keeps terminal_at NULL for needs_review');
  assert.equal(model.batch?.run,null,'the real source detail answers run:null until an extract succeeds');
  assert.ok(wireReads.some(r=>r.via==='detail'&&r.state==='needs_review'&&r.version===4),'the refresh consumed the real needs_review row');
  // Now the held-back response lands: the frozen 202 `cancelling` row that the
  // server answered at request time — an older, weaker response that must not
  // drag the store back off the newer authoritative state.
  //
  // The post-cancel refresh is made to fail (the disclosed read outage),
  // because otherwise it would simply re-read the authoritative `needs_review`
  // row and paper over whatever the assignment decided — masking the very
  // thing this case names. With the read unavailable, whatever the store still
  // holds after the response is exactly what the assignment produced.
  readOutage=true;
  cancellation.resolve(cancellingTask());
  await cancelling;
  assert.deepEqual(wireReads.find(r=>r.via==='cancel-response'),{via:'cancel-response',status:202,state:'cancelling',version:3},'the consumed cancel response was the frozen 202 cancelling row');
  assert.equal(model.run?.id,'A','the run identity is preserved');
  assert.equal(model.run?.status,'interrupted','the late cancellation response must not overwrite the newer authoritative state');
  assert.equal(model.run?.errorCode,null,'the newer state keeps its real wire shape');
  assert.equal(model.batch?.run,null,'no batch run is fabricated by the late response');
  assert.equal(model.running,false,'no run is reported active');
  // The real HTTP pipe was exercised: the cancel went out as a real POST.
  assert.ok(calls.some(c=>c.path==='/api/tasks/A/cancel'&&c.method==='POST'),'the cancel must be a real POST');
 }finally{model?.$dispose();setActivePinia(undefined);
  if(previousWindow)Object.defineProperty(globalThis,'window',previousWindow);else delete globalThis.window;
  if(previousFetch===undefined)delete globalThis.fetch;else globalThis.fetch=previousFetch;}
 assert.throws(()=>useOrganizer(),/no active Pinia/);
});