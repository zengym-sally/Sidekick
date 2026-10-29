import { computed,reactive,ref } from 'vue';
import { defineStore } from 'pinia';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage } from './todos.ts';
import { currentZone,type TodoInput,type Todo } from '../domain/todos.ts';
import { candidateState,editorSignature,type CandidateEditorState } from '../domain/candidate.ts';
import { isRunning,type ImportBatch,type BatchSummary,type ModelRun,type Candidate,type SignChoice } from '../domain/organizer.ts';
type Backend=(command:string,args?:Record<string,unknown>)=>Promise<unknown>;
export function createOrganizerModel(api:Backend){
  const batches=ref<BatchSummary[]>([]),batch=ref<ImportBatch|null>(null),selected=ref(''),run=ref<ModelRun|null>(null),loading=ref(false),saving=ref(false),starting=ref(false),error=ref(''),phase=ref('');
  const text=reactive({body:'',sourceTime:'',timeZone:currentZone(),sourceChoice:null as number|null});
  const reconcileRequired=ref(false);
  const drafts=reactive<Record<string,CandidateEditorState>>({});let generation=0;
  const running=computed(()=>isRunning(run.value));const pending=computed(()=>batches.value.reduce((n,b)=>n+b.pending,0));
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
      batches.value=summaries;run.value=nextRun;selected.value=id||'';batch.value=next;
      next?.candidates.forEach(c=>sync(c));error.value='';reconcileRequired.value=false;
    }catch(e){if(request!==generation)return;error.value=errorMessage(e);throw e;}
    finally{if(request===generation)loading.value=false;}
  }
  async function select(id:string){++generation;selected.value=id;batch.value=null;await refresh();}
  async function start(command:string,args?:Record<string,unknown>){starting.value=true;error.value='';++generation;
    try{const next=await api(command,args) as ModelRun;++generation;run.value=next;if(next.sourceId)selected.value=next.sourceId;try{await refresh();}catch{error.value='请求已受理，但状态暂时无法刷新，请重新读取核对。';}return next;}
    catch(e){error.value=errorMessage(e);throw e;}finally{starting.value=false;}
  }
  async function mutation<T>(command:string,args:Record<string,unknown>):Promise<T>{saving.value=true;error.value='';++generation;
    try{const result=await api(command,args) as T;++generation;
      if(command==='save_candidate'||command==='apply_candidate_preview')sync(result as Candidate,true);
      if(command==='cancel_model_run')run.value=result as ModelRun;
      try{await refresh();}catch{reconcileRequired.value=true;error.value='操作已提交，但候选清单暂时无法刷新，请重读核对。';}return result;
    }catch(e){error.value=errorMessage(e);throw e;}finally{saving.value=false;}
  }
  return {batches,batch,selected,run,loading,saving,starting,error,phase,text,drafts,running,pending,reconcileRequired,sync,refresh,select,
    organize:(sourceAtMs:number|null,retry=false)=>start('organize_text',{input:{text:text.body,sourceAtMs,timeZone:text.timeZone},retry}),
    retry:async()=>{if(!batch.value)return;const source=batch.value.source;return start('organize_text',{input:{text:source.rawText,sourceAtMs:source.sourceAtMs,timeZone:source.timeZone},retry:true});},
    revise:(c:Candidate,instruction:string)=>start('revise_candidate',{candidateId:c.id,expectedVersion:c.version,instruction,timeZone:currentZone()}),
    testModel:()=>start('test_model'),
    cancel:()=>run.value?mutation<ModelRun>('cancel_model_run',{id:run.value.id}):Promise.resolve(null),
    saveCandidate:(c:Candidate,input:TodoInput,timeReviewed:boolean,operationId:string)=>mutation<Candidate>('save_candidate',{id:c.id,expectedVersion:c.version,input,timeReviewed,operationId}),
    discard:(c:Candidate,operationId:string)=>mutation<Candidate>('discard_candidate',{id:c.id,expectedVersion:c.version,operationId}),
    apply:(preview:ModelRun,operationId:string)=>mutation<Candidate>('apply_candidate_preview',{runId:preview.id,expectedVersion:preview.candidateVersion,operationId}),
    sign:(choices:SignChoice[],operationId:string)=>mutation<Todo[]>('sign_candidates',{choices,operationId}),
  };
}
export const useOrganizer=defineStore('organizer',()=>createOrganizerModel(invoke));
