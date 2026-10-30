const epoch=Date.parse('2026-10-29T02:00:00Z');
const seed={providers:{providers:[{id:'company',name:'公司模型网关',apiFormat:'openai-compatible',baseUrl:'https://gateway.example.invalid/v1',enabled:true,auth:{type:'bearer',apiKeyRef:'synthetic-ref'},network:{timeoutMs:60000,retry:{maxRetries:2}}},{id:'personal',name:'个人模型服务',apiFormat:'openai-compatible',baseUrl:'https://personal.example.invalid/v1',enabled:true,auth:{type:'bearer',apiKeyRef:'synthetic-ref'}}]},models:{models:[{id:'main',name:'团队主力',providerId:'company',apiModelId:'team-chat',limits:{maxInputTokens:64000,maxOutputTokens:4096},capabilities:{toolCall:true}},{id:'fast',name:'轻量快模',providerId:'company',apiModelId:'team-fast',limits:{maxInputTokens:32000,maxOutputTokens:4096},capabilities:{toolCall:true}},{id:'reasoner',name:'个人推理模型',providerId:'personal',apiModelId:'personal-reasoner',limits:{maxInputTokens:64000,maxOutputTokens:4096},reasoning:{supported:true,defaultEffort:'medium'},capabilities:{toolCall:true}}]},defaultModelId:'main',revision:'fixture-seed',credentialStatus:{company:'stored',personal:'stored'}};
let config:any=new URLSearchParams(location.search).has('catalog')?structuredClone(seed):null;let modelConflict=false;let counter=0;const batches:any[]=[];const runs=new Map<string,any>();const operations=new Map<string,any>();const links=new Map<string,any[]>();
const id=(prefix:string)=>`${prefix}-${++counter}`;
function run(kind:string,sourceId:string|null,candidate:any=null){const r={id:id('run'),sourceId,kind,status:'succeeded',snapshot:{revision:config?.revision||'fixture'},input:{},candidateId:candidate?.id||null,candidateVersion:candidate?.version||null,preview:null,errorCode:null,createdAtMs:epoch,finishedAtMs:epoch};runs.set(r.id,r);return r;}
export function organizerFixture(command:string,args:any,rows:any[]):unknown {
  if(command==='read_model_configuration')return config;
  if(command==='save_model_configuration'){
    if(new URLSearchParams(location.search).has('modelConflict')&&!modelConflict){modelConflict=true;if(config)config.revision='remote-change';throw {code:'MODEL_VERSION_CONFLICT',message:'合成场景：模型配置已有更新，请读回核对。'};}
    if(new URLSearchParams(location.search).has('modelSaveError'))throw {code:'WORKSPACE_IO',message:'合成场景：模型配置暂时无法保存。'};
    const input=structuredClone(args.input);for(const p of input.providers.providers){if(input.apiKeys[p.id])p.auth={type:'bearer',apiKeyRef:'fixture-ref'};}
    config={providers:input.providers,models:input.models,defaultModelId:input.defaultModelId,revision:id('config'),credentialStatus:Object.fromEntries(input.providers.providers.map((p:any)=>[p.id,'stored']))};return {configuration:config,warning:null};
  }
  if(command==='active_model_run')return null;
  if(command==='read_model_run')return runs.get(args.id);
  if(command==='test_model'){const r=run('test',null),m=config?.models.models.find((m:any)=>m.id===(args?.modelId||config.defaultModelId));r.snapshot={revision:config?.revision,modelId:m?.id,model:m,provider:config?.providers.providers.find((p:any)=>p.id===m?.providerId)};return r;}
  if(command==='list_import_batches')return batches.map(b=>({id:b.source.id,excerpt:b.source.rawText.slice(0,160),importedAtMs:epoch,pending:b.candidates.filter((c:any)=>c.status==='pending').length,total:b.candidates.length,status:b.run.status}));
  if(command==='read_import_batch')return batches.find(b=>b.source.id===args.id);
  if(command==='organize_text'){
    const prior=batches.find(b=>b.source.rawText===args.input.text);if(prior&&!args.retry)return prior.run;
    const source={id:id('source'),rawText:args.input.text,sourceAtMs:args.input.sourceAtMs,importedAtMs:epoch,anchorAtMs:args.input.sourceAtMs??epoch,timeZone:args.input.timeZone,succeededRunId:null as string|null};
    const r=run('extract',source.id);if(!config){r.status='failed';r.errorCode='MODEL_NOT_CONFIGURED';}
    const clauses=args.input.text.split('\n').filter((s:string)=>s.trim());
    const candidates=config?[0,1,2].map((n:number)=>({id:id('candidate'),sourceId:source.id,runId:r.id,status:'pending',version:1,acceptedTodoId:null,draft:{fields:{title:['整理模型网关接入清单','跟进SDK鉴权修复','确认试用名单'][n],kind:n===1?'followup':'action',owner:n===1?'林川':'我',priority:'medium',tags:['界面样本'],due:n<2?{atMs:Date.parse('2026-10-30T09:00:00Z'),timeZone:source.timeZone,localText:'周五17点前'}:null,followup:n===1?{atMs:Date.parse('2026-10-29T07:00:00Z'),timeZone:source.timeZone,localText:'今天15点'}:null},evidence:clauses[n]||args.input.text,dueExpression:n<2?'周五17点前':null,followupExpression:n===1?'今天15点':null,warnings:[],unresolved:false}})):[];
    const batch={source,run:r,candidates,previews:[],started:true};source.succeededRunId=config?r.id:null;batches.unshift(batch);return r;
  }
  const findCandidate=(cid:string)=>batches.flatMap(b=>b.candidates).find(c=>c.id===cid);
  if(command==='save_candidate'){const c=findCandidate(args.id);c.draft.fields=args.input;c.version++;c.draft.unresolved=!args.timeReviewed&&c.draft.unresolved;return c;}
  if(command==='discard_candidate'){const c=findCandidate(args.id);c.status='discarded';c.version++;return c;}
  if(command==='revise_candidate'){
    const c=findCandidate(args.candidateId);const r=run('revise',c.sourceId,c);r.preview=structuredClone(c.draft);r.preview.fields.title='补充模型网关接入说明';r.input={instruction:args.instruction};batches.find(b=>b.source.id===c.sourceId).previews.unshift(r);return r;
  }
  if(command==='apply_candidate_preview'){const r=runs.get(args.runId),c=findCandidate(r.candidateId);c.draft=structuredClone(r.preview);c.version++;return c;}
  if(command==='sign_candidates'){
    if(operations.has(args.operationId))return operations.get(args.operationId).map((tid:string)=>rows.find(t=>t.id===tid));
    const result=[];for(const choice of args.choices){const c=findCandidate(choice.candidateId);let todo=rows.find(t=>t.id===choice.target?.id);if(todo){todo.version++;}else{todo={id:id('todo'),data:choice.fields,source:'signed_ai',status:'open',version:1,createdAtMs:epoch,updatedAtMs:epoch,completedAtMs:null,deletedAtMs:null};rows.push(todo);}c.status='accepted';c.acceptedTodoId=todo.id;c.version++;result.push(todo.id);links.set(todo.id,[...(links.get(todo.id)||[]),{sourceId:c.sourceId,evidence:c.draft.evidence,association:choice.target?'manual_link':'new',createdAtMs:epoch}]);}operations.set(args.operationId,result);return result.map(tid=>rows.find(t=>t.id===tid));
  }
  if(command==='todo_source_links')return links.get(args.id)||[];
  if(command==='todo_history')return [];
  if(command==='set_todo_completed'){const t=rows.find(t=>t.id===args.id);t.status=args.completed?'completed':'open';t.version++;return t;}
  if(command==='cancel_model_run'){const r=runs.get(args.id);r.status='cancelled';return r;}
  return undefined;
}
