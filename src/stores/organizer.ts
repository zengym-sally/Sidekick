import { computed,reactive,ref } from 'vue';
import {useModelSettings} from './models.ts';
import {useAgents} from './agents.ts';
import { defineStore } from 'pinia';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage } from './todos.ts';
import { currentZone,requireApplicationZone,type TodoInput,type Todo } from '../domain/todos.ts';
import { candidateState,editorSignature,type CandidateEditorState } from '../domain/candidate.ts';
import { isRunning,type ImportBatch,type BatchSummary,type ModelRun,type Candidate,type SignChoice } from '../domain/organizer.ts';
type Backend=(command:string,args?:Record<string,unknown>)=>Promise<unknown>;
export function createOrganizerModel(api:Backend,guard:(command:string)=>void=()=>{}){
  const batches=ref<BatchSummary[]>([]),batch=ref<ImportBatch|null>(null),selected=ref(''),run=ref<ModelRun|null>(null),loading=ref(false),saving=ref(false),starting=ref(false),error=ref(''),phase=ref('');
  const text=reactive({body:'',sourceTime:'',timeZone:currentZone(),sourceChoice:null as number|null});
  const reconcileRequired=ref(false);
  const drafts=reactive<Record<string,CandidateEditorState>>({});let generation=0,selectionGeneration=0,startGeneration=0;
  const knownRuns=new Map<string,ModelRun>();
  const running=computed(()=>isRunning(run.value));const pending=computed(()=>batches.value.reduce((n,b)=>n+b.pending,0));
  function acceptRun(next:ModelRun){const old=knownRuns.get(next.id);if(old&&(old.errorCode==='MCP_RESULT_UNKNOWN'||next.errorCode!=='MCP_RESULT_UNKNOWN'&&!isRunning(old)&&isRunning(next)))return old;knownRuns.set(next.id,next);return next;}
  function sync(c:Candidate,force=false){
    const previous=drafts[c.id];
    function reset(){const next=candidateState(c);if(previous&&c.status==='pending'){next.selected=previous.selected;next.targetId=previous.targetId;next.targetVersion=previous.targetVersion;next.instruction=previous.instruction;}drafts[c.id]=next;}
    if(!previous||force||c.status!=='pending')reset();else if(previous.version!==c.version){if(editorSignature(previous)===previous.baseline)reset();else previous.stale=true;}
  }
  async function refresh(){
    const request=++generation;loading.value=true;
    try{
      const summaries=await api('list_import_batches') as BatchSummary[];if(request!==generation)return;
      const active=await api('active_model_run') as string|null;if(request!==generation)return;
      const current=active||run.value?.id;const nextRun=current?await api('read_model_run',{id:current}) as ModelRun:null;if(request!==generation)return;
      const id=selected.value||summaries.find(b=>b.pending)?.id||summaries[0]?.id;
      const next=id?await api('read_import_batch',{id}) as ImportBatch:null;if(request!==generation)return;
      if(nextRun)acceptRun(nextRun);if(next?.run)acceptRun(next.run);next?.previews.forEach(acceptRun);
      const accepted=nextRun?acceptRun(nextRun):null;
      batches.value=summaries;if(!run.value||!accepted||run.value.id===accepted.id||accepted.createdAtMs>run.value.createdAtMs)run.value=accepted;selected.value=id||'';
      batch.value=next?{...next,run:next.run?acceptRun(next.run):null,previews:next.previews.map(acceptRun),candidates:next.candidates.filter(c=>knownRuns.get(c.runId)?.errorCode!=='MCP_RESULT_UNKNOWN')}:null;
      batch.value?.candidates.forEach(c=>sync(c));error.value='';reconcileRequired.value=false;
    }catch(e){if(request!==generation)return;error.value=errorMessage(e);throw e;}
    finally{if(request===generation)loading.value=false;}
  }
  async function select(id:string){++selectionGeneration;++generation;selected.value=id;batch.value=null;await refresh();}
  async function start(command:string,args?:Record<string,unknown>){const request=++startGeneration,selection=selectionGeneration;starting.value=true;error.value='';++generation;
    try{guard(command);const next=await api(command,args) as ModelRun;if(request!==startGeneration||selection!==selectionGeneration||run.value&&run.value.id!==next.id&&run.value.createdAtMs>next.createdAtMs)return next;++generation;run.value=acceptRun(next);if(next.sourceId)selected.value=next.sourceId;try{await refresh();}catch{if(request===startGeneration&&selection===selectionGeneration)error.value='请求已受理，但状态暂时无法刷新，请重新读取核对。';}return next;}
    catch(e){if(request===startGeneration&&selection===selectionGeneration)error.value=errorMessage(e);throw e;}finally{if(request===startGeneration)starting.value=false;}
  }
  async function mutation<T>(command:string,args:Record<string,unknown>):Promise<T>{const request=++generation;saving.value=true;error.value='';
    try{const result=await api(command,args) as T;if(request!==generation)return result;++generation;
      if(command==='save_candidate'||command==='apply_candidate_preview')sync(result as Candidate,true);
      if(command==='cancel_model_run'&&run.value?.id===args.id&&(result as ModelRun).id===args.id)run.value=acceptRun(result as ModelRun);
      try{await refresh();}catch{reconcileRequired.value=true;error.value='操作已提交，但候选清单暂时无法刷新，请重读核对。';}return result;
    }catch(e){if(request===generation)error.value=errorMessage(e);throw e;}finally{saving.value=false;}
  }
  return {batches,batch,selected,run,loading,saving,starting,error,phase,text,drafts,running,pending,reconcileRequired,sync,refresh,select,
    organize:async(sourceAtMs:number|null,retry=false)=>start('organize_text',{input:{text:text.body,sourceAtMs,timeZone:requireApplicationZone()},retry}),
    retry:async()=>{if(!batch.value)return;const source=batch.value.source;return start('organize_text',{input:{text:source.rawText,sourceAtMs:source.sourceAtMs,timeZone:source.timeZone},retry:true});},
    revise:async(c:Candidate,instruction:string)=>start('revise_candidate',{candidateId:c.id,expectedVersion:c.version,instruction,timeZone:requireApplicationZone()}),
    testModel:(modelId?:string)=>start('test_model',{modelId:modelId||null}),
    cancel:()=>run.value?mutation<ModelRun>('cancel_model_run',{id:run.value.id}):Promise.resolve(null),
    saveCandidate:(c:Candidate,input:TodoInput,timeReviewed:boolean,operationId:string)=>mutation<Candidate>('save_candidate',{id:c.id,expectedVersion:c.version,input,timeReviewed,operationId}),
    discard:(c:Candidate,operationId:string)=>mutation<Candidate>('discard_candidate',{id:c.id,expectedVersion:c.version,operationId}),
    apply:(preview:ModelRun,operationId:string)=>mutation<Candidate>('apply_candidate_preview',{runId:preview.id,expectedVersion:preview.candidateVersion,operationId}),
    sign:(choices:SignChoice[],operationId:string)=>mutation<Todo[]>('sign_candidates',{choices,operationId}),
  };
}
export const useOrganizer=defineStore('organizer',()=>createOrganizerModel(invoke,command=>{const model=useModelSettings();if(!model.ready||model.loading||model.saving)throw Error('请先在模型服务重新读取并核对配置。');if(command!=='test_model'){const role=useAgents().states.organizer;if(!role.ready||role.loading||role.saving)throw Error('请先在智能体页重新读取并核对事项整理配置。');}}));
