import assert from 'node:assert/strict';
import test from 'node:test';
import { createOrganizerModel } from '../src/stores/organizer.ts';
import { createModelSettings } from '../src/stores/models.ts';
import { timeDraft,draftPoint } from '../src/domain/time.ts';
import { todayLists,isOverdue,displayPoint } from '../src/domain/todos.ts';
const fields={title:'合成事项',kind:'action',owner:'我',priority:'medium',tags:[],due:null,followup:null};
const batch=id=>({source:{id,rawText:'合成原文',timeZone:'Asia/Shanghai'},candidates:[],previews:[],run:null,started:false});
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
test('a model save response does not clear a newer JSON draft, and JSON edits invalidate prior test success',async()=>{
  const config={providers:{providers:[{id:'p',name:'原服务',baseUrl:'https://example.invalid/v1',apiFormat:'openai-compatible',auth:{type:'bearer',apiKeyEnv:'FIXTURE'}}]},models:{models:[{id:'m',providerId:'p',apiModelId:'wire'}]},defaultModelId:'m',revision:'old',credentialStatus:{p:'missing'}};
  let finish;const model=createModelSettings(async command=>command==='read_model_configuration'?config:new Promise(resolve=>finish=resolve));
  await model.load();model.providerJson.value='{"providers":["new draft"]}';assert.equal(model.dirty.value,true);
  const save=model.saveBasic();model.providerJson.value='{"providers":["newer draft"]}';finish({configuration:{...config,revision:'new'},warning:null});await save;
  assert.equal(model.providerJson.value,'{"providers":["newer draft"]}');assert.equal(model.dirty.value,true);
});
test('basic model editing preserves imported metadata and other models without mutating the saved snapshot',async()=>{
  const original={providers:{providers:[{id:'p',name:'原服务',baseUrl:'https://example.invalid/v1',apiFormat:'openai-compatible',auth:{type:'bearer',apiKeyEnv:'FIXTURE_ENV'},tags:['retain']}]},models:{models:[{id:'logical',providerId:'p',apiModelId:'wire',pricing:{input:null}},{id:'other',providerId:'p',apiModelId:'other-wire'}]},defaultModelId:'logical',revision:'old',credentialStatus:{p:'missing'}};
  let sent;const model=createModelSettings(async(command,args)=>{if(command==='read_model_configuration')return original;sent=args.input;return {configuration:{...original,providers:args.input.providers,models:args.input.models,revision:'new'},warning:null};});
  await model.load();model.basic.apiModelId='changed-wire';await model.saveBasic();
  assert.equal(sent.models.models[0].apiModelId,'changed-wire');assert.deepEqual(sent.providers.providers[0].tags,['retain']);assert.equal(sent.models.models.length,2);assert.equal(original.models.models[0].apiModelId,'wire');
});
test('saving one model editor preserves the other editor draft until an explicit reset',async()=>{
  let config={providers:{providers:[{id:'p',name:'原服务',baseUrl:'https://example.invalid/v1',apiFormat:'openai-compatible',auth:{type:'bearer',apiKeyEnv:'FIXTURE'}}]},models:{models:[{id:'m',providerId:'p',apiModelId:'wire'}]},defaultModelId:'m',revision:'old',credentialStatus:{p:'missing'}};
  const model=createModelSettings(async(command,args)=>{if(command==='read_model_configuration')return config;config={...config,providers:args.input.providers,models:args.input.models,defaultModelId:args.input.defaultModelId,revision:'new'};return {configuration:config,warning:null};});
  await model.load();const jsonDraft=JSON.stringify({providers:[{...config.providers.providers[0],name:'JSON草稿'}]});model.providerJson.value=jsonDraft;
  model.basic.apiModelId='basic-wire';await model.saveBasic();assert.equal(model.providerJson.value,jsonDraft);assert.equal(model.dirty.value,true);
  model.resetJson();assert.equal(model.dirty.value,false);
  model.basic.name='未保存的基础草稿';model.providerJson.value=jsonDraft;await model.importPair();
  assert.equal(model.basic.name,'未保存的基础草稿');assert.equal(model.configuration.value.providers.providers[0].name,'JSON草稿');assert.equal(model.dirty.value,true);
  model.resetBasic();assert.equal(model.basic.name,'JSON草稿');assert.equal(model.dirty.value,false);
});
