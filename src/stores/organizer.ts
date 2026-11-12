import { computed,reactive,ref } from 'vue';
import {useModelSettings} from './models.ts';
import {useAgents} from './agents.ts';
import { defineStore } from 'pinia';
import { getWebApiClient } from '../lib/web-api-client.ts';
import type { WireSnapshot } from '../lib/web-api-client.ts';
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
  /// Wire generation per accepted run id (`StoreRun` carries it additively on
  /// mapped runs). Frozen web-api/1 §6: production retry keeps `taskId`/
  /// `createdAt` and bumps `version`/`attemptCount`, so the wire version —
  /// never `createdAtMs` — is the authority that separates a legitimate newer
  /// attempt from a stale response resurrecting an old state.
  const wireGenerations=new Map<string,{version:number;attemptCount:number}>();
  const wireGeneration=(next:ModelRun)=>{const version=(next as {wireVersion?:unknown}).wireVersion,attempt=(next as {wireAttemptCount?:unknown}).wireAttemptCount;return typeof version==='number'&&typeof attempt==='number'?{version,attemptCount:attempt}:null;};
  /// The last snapshot installed as the authoritative baseline (`<epoch>` plus
  /// its high-watermark). A snapshot at or before the applied cursor of the
  /// same epoch is an old async response and is dropped, never reinstalled.
  let snapshotEpoch:string|null=null,snapshotCursor=-1;
  const running=computed(()=>isRunning(run.value));const pending=computed(()=>batches.value.reduce((n,b)=>n+b.pending,0));
  function acceptRun(next:ModelRun){
    const old=knownRuns.get(next.id);const gen=wireGeneration(next);
    if(old&&gen){
      const known=wireGenerations.get(next.id);
      if(known){
        // Older wire generation than the installed baseline: a stale response
        // (late snapshot, replayed frame, out-of-order read) — never applied.
        if(gen.version<known.version)return old;
        if(gen.version===known.version){
          // Same task version with a DIFFERENT attempt id: per §3.1 the
          // version is the migration authority, so this row is stale or
          // self-contradictory — it must never overwrite the installed
          // attempt's exit evidence (V2 §3.1.1).
          const nextAttempt=(next as {wireAttemptId?:unknown}).wireAttemptId,oldAttempt=(old as {wireAttemptId?:unknown}).wireAttemptId;
          if(typeof nextAttempt==='string'&&typeof oldAttempt==='string'&&nextAttempt!==oldAttempt)return old;
          // The exit verdict only ever moves unresolved→registry_extinct
          // (§3.1.1 invariant 6, and that migration bumps the version): at an
          // unchanged version a confirmed evidence can never legitimately
          // become unresolved/absent, so such a row is stale — the newer
          // evidence stays installed.
          const knownVerdict=(old as {wireExitEvidence?:{verdict?:unknown}|null}).wireExitEvidence?.verdict;
          const nextVerdict=(next as {wireExitEvidence?:{verdict?:unknown}|null}).wireExitEvidence?.verdict;
          if(knownVerdict==='registry_extinct'&&nextVerdict!=='registry_extinct')return old;
          // Equal generation: the historical guards stay load-bearing — a
          // client-side unknown sentinel is never overwritten, and a terminal /
          // failed state is not resurrected to running without a generation bump.
          if(old.errorCode==='MCP_RESULT_UNKNOWN'||next.errorCode!=='MCP_RESULT_UNKNOWN'&&!isRunning(old)&&isRunning(next))return old;
        }
      }
      // Strictly newer generation (or first sighting after a baseline
      // replacement): the wire is authoritative, so a legitimate retry of the
      // SAME task id — non-running -> running with a bumped version/attempt —
      // is displayed instead of held back.
    }else if(old){
      // No wire generation available (preview runs, injected store seams):
      // keep the exact historical guards unchanged.
      if(old.errorCode==='MCP_RESULT_UNKNOWN'||next.errorCode!=='MCP_RESULT_UNKNOWN'&&!isRunning(old)&&isRunning(next))return old;
    }
    if(gen)wireGenerations.set(next.id,gen);
    knownRuns.set(next.id,next);return next;
  }
  /// Frozen web-api/1 §6: consume a `GET /api/snapshot` response as the
  /// authoritative task baseline. Not a GET-and-discard: the tasks are mapped
  /// runs already (the client maps them), every id enters the generation map,
  /// and the epoch/high-watermark fence drops snapshots that are older than
  /// what this store already installed.
  ///
  /// `currentEpoch` is the epoch the CALLER's sync pipeline currently treats
  /// as authoritative (the pairing store passes `syncEpoch`). The store only
  /// knows the epochs of snapshots it has installed itself, so without it the
  /// FIRST snapshot would always look cross-epoch — and its wholesale
  /// replacement would erase generations a newer task read-back had already
  /// installed. With it, a snapshot of the caller's own current epoch is a
  /// same-epoch MERGE even on first install.
  ///
  /// SAME-EPOCH install (strictly newer watermark): MERGE under per-task
  /// wire-generation authority — `acceptRun` refuses a snapshot row older
  /// than the installed generation, so a snapshot that was in flight while a
  /// newer task read-back landed can never erase the version protection or
  /// roll the installed state back, and rows the snapshot does not carry stay
  /// guarded/known. The displayed run is displaced only by a strictly newer
  /// generation of itself (via `previous`), or falls back to the newest
  /// running snapshot row when it is unknown to the merged baseline.
  ///
  /// CROSS-EPOCH: explicit whole-generation replacement — §6 forbids
  /// cross-epoch in-place merging, so the run/generation baseline is cleared
  /// and rebuilt wholesale (drafts are user content keyed by candidate id and
  /// survive), then the caller re-reads the sources/candidates the snapshot
  /// does not carry. A caller that does not know its epoch (tests, injected
  /// seams) keeps the historical compare-against-last-snapshot behavior.
  function applySnapshot(snapshot:WireSnapshot,currentEpoch:string|null=null){
    const sameEpoch=snapshot.epoch===(currentEpoch??snapshotEpoch);
    if(sameEpoch&&snapshot.highWatermark<=snapshotCursor)return;
    ++generation;++selectionGeneration;++startGeneration;
    snapshotEpoch=snapshot.epoch;snapshotCursor=snapshot.highWatermark;
    let active:ModelRun|null=null,previous:ModelRun|null=null;
    if(!sameEpoch){knownRuns.clear();wireGenerations.clear();}
    for(const next of snapshot.tasks){
      const accepted=acceptRun(next);
      if(run.value&&accepted.id===run.value.id)previous=accepted;
      if(isRunning(accepted)&&(!active||accepted.createdAtMs>active.createdAtMs))active=accepted;
    }
    run.value=sameEpoch
      ?(previous??(run.value&&knownRuns.has(run.value.id)?run.value:active))
      :(previous??active);
    error.value='';reconcileRequired.value=false;
  }
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
  return {batches,batch,selected,run,loading,saving,starting,error,phase,text,drafts,running,pending,reconcileRequired,sync,refresh,applySnapshot,select,
    organize:async(sourceAtMs:number|null,retry=false)=>start('organize_text',{input:{text:text.body,sourceAtMs,timeZone:requireApplicationZone()},retry}),
    retry:async()=>{if(!batch.value)return;const source=batch.value.source;return start('organize_text',{input:{text:source.rawText,sourceAtMs:source.sourceAtMs,timeZone:source.timeZone},retry:true});},
    revise:async(c:Candidate,instruction:string)=>start('revise_candidate',{candidateId:c.id,expectedVersion:c.version,instruction,timeZone:requireApplicationZone()}),
    testModel:(modelId?:string)=>start('test_model',{modelId:modelId||null}),
    cancel:()=>run.value?mutation<ModelRun>('cancel_model_run',{id:run.value.id}):Promise.resolve(null),
    saveCandidate:(c:Candidate,input:TodoInput,timeReviewed:boolean,operationId:string)=>mutation<Candidate>('save_candidate',{id:c.id,expectedVersion:c.version,input,timeReviewed,operationId}),
    discard:(c:Candidate,operationId:string)=>mutation<Candidate>('discard_candidate',{id:c.id,expectedVersion:c.version,operationId}),
    apply:(preview:ModelRun,operationId:string)=>mutation<Candidate>('apply_candidate_preview',{candidateId:preview.candidateId,runId:preview.id,expectedVersion:preview.candidateVersion,operationId}),
    sign:(choices:SignChoice[],operationId:string)=>mutation<Todo[]>('sign_candidates',{choices,operationId}),
  };
}
export const useOrganizer=defineStore('organizer',()=>createOrganizerModel(getWebApiClient().asBackend(),command=>{const model=useModelSettings();if(!model.ready||model.loading||model.saving)throw Error('请先在模型服务重新读取并核对配置。');if(command!=='test_model'){const role=useAgents().states.organizer;if(!role.ready||role.loading||role.saving)throw Error('请先在智能体页重新读取并核对事项整理配置。');}}));
