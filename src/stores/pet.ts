import {computed,ref} from 'vue';
import {invoke} from '@tauri-apps/api/core';
import {listen} from '@tauri-apps/api/event';
import {petBasePose,petCanAnimate,petCanClaimFeedback,petFeedbackBudget,type PetPose,type PetFeedbackNotice,type PetFeedbackGrant,type PetPlaybackView} from '../domain/pet.ts';
import {errorMessage} from './todos.ts';

export interface PetNativeView {
 clientEpoch:number;sequence:number;playEpoch:number;maskSequence:number;policySequence:number;
 visible:boolean;edge:'free'|'left'|'right';collapsed:boolean;dragging:boolean;menuOpen:boolean;workMode:boolean;
 artworkLeft:number;artworkTop:number;error?:string|null;
}
export interface PetSnapshot {
 workspaceEpoch:string;stateRevision:number;factsKnown:boolean;pendingCandidateCount:number|null;warning:string|null;view:PetNativeView;
}
export interface PetPolicy {reducedMotion:boolean;pageVisible:boolean;keyboardFocused?:boolean}
export interface PetRenderer {mask:(pose:PetPose)=>Promise<number[]>;paint:(signal?:AbortSignal)=>Promise<void>}
type Backend=(command:string,args?:Record<string,unknown>)=>Promise<unknown>;
type Subscribe=(name:string,changed:(payload:unknown)=>void|Promise<void>)=>Promise<()=>void>;
const petEvents:Subscribe=(name,changed)=>listen(name,event=>{void changed(event.payload);});
const initialView=():PetNativeView=>({clientEpoch:0,sequence:0,playEpoch:0,maskSequence:0,policySequence:0,visible:false,edge:'free',collapsed:false,dragging:false,menuOpen:false,workMode:true,artworkLeft:40,artworkTop:30});

export function createPetWindow(api:Backend=invoke,subscribe:Subscribe=petEvents,now:()=>number=()=>performance.now()){
 const snapshot=ref<PetSnapshot|null>(null),view=ref(initialView()),pose=ref<PetPose>('idle'),connected=ref(false),ready=ref(false),presentationReady=ref(false);
 const readError=ref(''),actionError=ref(''),menuPending=ref(false),dragPending=ref(false),policyPending=ref(true);
 const policy=ref({reducedMotion:true,pageVisible:false});
 const action=ref<{notice:PetFeedbackNotice;grant:PetFeedbackGrant;requestAt:number;playing:boolean}|null>(null);
 let alive=true,started=false,clientEpoch=0,readSequence=0,connectSequence=0,interactionSequence=0,feedbackSequence=0,presentationSequence=0,paintSequence=0;
 let maskSequence=0,policySequence=0,renderer:PetRenderer|undefined,unlisten:Array<()=>void>=[],feedbackTimer:ReturnType<typeof setTimeout>|undefined,poll:ReturnType<typeof setInterval>|undefined;
 let presentationAbort:AbortController|undefined,paintAbort:AbortController|undefined,pendingPose:PetPose|undefined,pendingPresentation:Promise<boolean>|undefined;
 let pendingFeedbackId:string|undefined;
 const consumed=new Set<string>();
 const hasPending=computed(()=>Boolean(snapshot.value?.pendingCandidateCount));
 const error=computed(()=>actionError.value||view.value.error||readError.value);
 const playbackView=():PetPlaybackView=>({workspaceEpoch:snapshot.value?.workspaceEpoch||'',stateRevision:snapshot.value?.stateRevision||0,playEpoch:view.value.playEpoch,visible:view.value.visible,collapsed:view.value.collapsed,dragging:view.value.dragging||dragPending.value,menuOpen:view.value.menuOpen||menuPending.value,workMode:view.value.workMode,reducedMotion:policy.value.reducedMotion,pageVisible:policy.value.pageVisible});
 const eligible=()=>alive&&ready.value&&connected.value&&!policyPending.value&&Boolean(snapshot.value?.factsKnown)&&petCanAnimate(playbackView());
 const motion=computed<'none'|'idle'|'found'|'done'>(()=>eligible()&&presentationReady.value?action.value?.playing?action.value.notice.kind:'idle':'none');
 function cancelAction(){
  ++feedbackSequence;pendingFeedbackId=undefined;
  if(feedbackTimer!==undefined){clearTimeout(feedbackTimer);feedbackTimer=undefined;}
  if(action.value){action.value=null;++presentationSequence;presentationAbort?.abort();pendingPose=undefined;pendingPresentation=undefined;}
 }
 function syncPolling(){
  const active=alive&&ready.value&&view.value.visible&&policy.value.pageVisible;
  if(active&&poll===undefined)poll=setInterval(()=>{void refresh();},30000);
  if(!active&&poll!==undefined){clearInterval(poll);poll=undefined;}
 }
 async function acknowledgeView(){
  if(!alive||!clientEpoch||!renderer)return;
  const ticket=++paintSequence,sequence=view.value.sequence;paintAbort?.abort();const abort=new AbortController();paintAbort=abort;
  try{
   await renderer.paint(abort.signal);
   if(!alive||ticket!==paintSequence||abort.signal.aborted||sequence!==view.value.sequence)return;
   const result=await api('confirm_pet_presentation',{request:{clientEpoch,viewSequence:sequence,maskSequence:presentationReady.value?view.value.maskSequence:0}}) as PetNativeView;
   if(!alive||ticket!==paintSequence)return;
   await applyView(result,false);
  }catch(e){if(alive&&ticket===paintSequence&&!abort.signal.aborted)actionError.value=errorMessage(e);}
 }
 async function applyView(next:PetNativeView,acknowledge=true){
  if(!alive||!clientEpoch||next.clientEpoch!==clientEpoch||next.sequence<view.value.sequence)return;
  const old=view.value,changed=next.sequence!==old.sequence;
  if(next.maskSequence<old.maskSequence||next.policySequence<old.policySequence)return;
  view.value=next;maskSequence=Math.max(maskSequence,next.maskSequence);
  if(next.playEpoch!==old.playEpoch||!next.visible||next.collapsed||next.dragging||next.menuOpen)cancelAction();
  syncPolling();
  if(changed&&acknowledge)await acknowledgeView();
  if(!alive)return;
  if(next.visible&&!next.collapsed&&(!old.visible||old.collapsed)&&ready.value)void refresh();
  if(!view.value.dragging&&!view.value.menuOpen&&!dragPending.value&&!menuPending.value)void reconcile();
 }
 async function present(next:PetPose):Promise<boolean>{
  if(!alive||!renderer||!clientEpoch)return false;
  if(pose.value===next&&presentationReady.value)return true;
  if(pendingPose===next&&pendingPresentation)return pendingPresentation;
  const ticket=++presentationSequence;presentationAbort?.abort();const abort=new AbortController();presentationAbort=abort;pendingPose=next;
  const task=(async()=>{
   try{
    const mask=await renderer!.mask(next);
    if(!alive||ticket!==presentationSequence||abort.signal.aborted)return false;
    const sequence=++maskSequence;presentationReady.value=false;
    const native=await api('set_pet_hit_mask',{request:{clientEpoch,sequence,mask}}) as PetNativeView;
    if(!alive||ticket!==presentationSequence)return false;
    await applyView(native,false);
    if(!alive||ticket!==presentationSequence)return false;
    pose.value=next;await renderer!.paint(abort.signal);
    if(!alive||ticket!==presentationSequence||abort.signal.aborted)return false;
    const applied=await api('confirm_pet_presentation',{request:{clientEpoch,viewSequence:view.value.sequence,maskSequence:sequence}}) as PetNativeView;
    if(!alive||ticket!==presentationSequence)return false;
    await applyView(applied,false);
    if(!alive||ticket!==presentationSequence)return false;
    presentationReady.value=true;return true;
   }catch(e){if(alive&&ticket===presentationSequence&&!abort.signal.aborted)actionError.value=errorMessage(e);return false;}
   finally{if(ticket===presentationSequence){pendingPose=undefined;pendingPresentation=undefined;}}
  })();
  pendingPresentation=task;return task;
 }
 async function reconcile(force=false){
  if(!alive||!clientEpoch||!renderer)return false;
  if(!force&&(view.value.dragging||view.value.menuOpen||dragPending.value||menuPending.value))return false;
  return present(action.value?.notice.kind||petBasePose(snapshot.value?.pendingCandidateCount??0));
 }
 async function refresh(){
  if(!alive)return false;const request=++readSequence;
  try{
   const result=await api('read_pet_state') as PetSnapshot;
   if(!alive||request!==readSequence)return false;
   const old=snapshot.value;
   if(old&&result.workspaceEpoch===old.workspaceEpoch&&result.stateRevision<old.stateRevision)return false;
   if(old&&result.workspaceEpoch!==old.workspaceEpoch){cancelAction();consumed.clear();}
   snapshot.value=result;readError.value=result.warning||'';
   await applyView(result.view);
   if(!alive||request!==readSequence)return false;
   await reconcile();return true;
  }catch(e){if(alive&&request===readSequence){cancelAction();readError.value=errorMessage(e);}return false;}
 }
 async function receiveFeedback(value:unknown){
  if(!value||typeof value!=='object'||!eligible())return;
  const notice=value as PetFeedbackNotice;
  if(!petCanClaimFeedback(notice,playbackView(),consumed))return;
  consumed.add(notice.feedbackId);if(consumed.size>256){const first=consumed.values().next().value;if(first!==undefined)consumed.delete(first);}
  cancelAction();pendingFeedbackId=notice.feedbackId;const request=feedbackSequence,requestedEpoch=clientEpoch,requestAt=now();
  try{
   const grant=await api('claim_pet_feedback',{request:{clientEpoch,feedbackId:notice.feedbackId,workspaceEpoch:notice.workspaceEpoch,playEpoch:notice.playEpoch}}) as PetFeedbackGrant|null;
   if(!alive||request!==feedbackSequence||clientEpoch!==requestedEpoch||!grant||!eligible()||!petFeedbackBudget(notice,grant,playbackView(),now()-requestAt))return;
   action.value={notice,grant,requestAt,playing:false};
   feedbackTimer=setTimeout(()=>{if(alive&&request===feedbackSequence){cancelAction();void reconcile();}},petFeedbackBudget(notice,grant,playbackView(),now()-requestAt));
   if(!await present(notice.kind)||!alive||request!==feedbackSequence||!eligible()){
    if(alive&&request===feedbackSequence){cancelAction();void reconcile();}return;
   }
   const remaining=petFeedbackBudget(notice,grant,playbackView(),now()-requestAt);
   if(!remaining){cancelAction();void reconcile();return;}
   action.value={notice,grant,requestAt,playing:true};
   if(feedbackTimer!==undefined)clearTimeout(feedbackTimer);
   feedbackTimer=setTimeout(()=>{if(alive&&request===feedbackSequence){cancelAction();void reconcile();}},remaining);
  }catch{if(alive&&request===feedbackSequence){cancelAction();void reconcile();}}
  finally{if(request===feedbackSequence)pendingFeedbackId=undefined;}
 }
 async function connect(){
  const request=++connectSequence;for(const stop of unlisten.splice(0))stop();
  const handlers:Record<string,(value:unknown)=>void|Promise<void>>={
   'pet-view-changed':value=>applyView(value as PetNativeView),
   'pet-state-changed':async value=>{if(!alive)return;const data=value as {workspaceEpoch?:string;invalidatedFeedbackId?:string};if(data?.workspaceEpoch!==snapshot.value?.workspaceEpoch||Boolean(data?.invalidatedFeedbackId&&(data.invalidatedFeedbackId===action.value?.notice.feedbackId||data.invalidatedFeedbackId===pendingFeedbackId))){cancelAction();void reconcile();}await refresh();},
   'pet-feedback':receiveFeedback,
  };
  const results=await Promise.allSettled(Object.entries(handlers).map(async([name,handler])=>{
   const stop=await subscribe(name,value=>alive&&request===connectSequence?handler(value):undefined);
   if(!alive||request!==connectSequence)stop();else unlisten.push(stop);
  }));
  if(!alive||request!==connectSequence)return false;
  connected.value=results.every(result=>result.status==='fulfilled');
  if(!connected.value)readError.value='班班连接暂不可确认，请重新显示或重开应用。';
  return connected.value;
 }
 async function setPolicy(next:PetPolicy){
  policy.value=next;policyPending.value=true;cancelAction();syncPolling();
  if(!alive||!clientEpoch)return false;
  const sequence=++policySequence;
  try{
   const native=await api('set_pet_policy',{request:{clientEpoch,sequence,clientReady:connected.value,...next}}) as PetNativeView;
   if(!alive||sequence!==policySequence)return false;
   await applyView(native);
   if(!alive||sequence!==policySequence)return false;
   policyPending.value=false;await reconcile();return true;
  }catch(e){if(alive&&sequence===policySequence)actionError.value=errorMessage(e);return false;}
 }
 async function start(tools:PetRenderer,initialPolicy:PetPolicy){
  if(started||!alive)return false;started=true;renderer=tools;policy.value=initialPolicy;
  await connect();if(!alive)return false;
  try{
   let observed=await api('read_pet_state') as PetSnapshot;if(!alive)return false;
   for(let attempt=0;attempt<4;attempt++){
    const attached=await api('attach_pet_client',{expectedClientEpoch:observed.view.clientEpoch}) as {attached:boolean;snapshot:PetSnapshot};
    if(!alive)return false;observed=attached.snapshot;
    if(!attached.attached)continue;
    clientEpoch=observed.view.clientEpoch;maskSequence=0;policySequence=0;view.value=observed.view;
    await refresh();if(!alive)return false;
    await reconcile();if(!alive)return false;
    ready.value=true;await setPolicy(policy.value);syncPolling();return true;
   }
   readError.value='班班正在重新连接，请稍后重开应用。';
  }catch(e){if(alive)readError.value=errorMessage(e);}
  return false;
 }
 async function reconnect(){
  if(!alive||!clientEpoch)return false;
  await connect();if(!alive)return false;
  await setPolicy(policy.value);if(!alive)return false;
  await refresh();return connected.value;
 }
 async function openMenu(keyboard=false){
  if(!alive||!clientEpoch||!view.value.visible)return false;
  const request=++interactionSequence;menuPending.value=true;actionError.value='';cancelAction();
  try{
   const prepared=await api('prepare_pet_menu',{request:{clientEpoch,keyboard}}) as {token:number;view:PetNativeView};
   if(!alive||request!==interactionSequence)return false;
   await applyView(prepared.view);if(!alive||request!==interactionSequence)return false;
   await reconcile(true);await acknowledgeView();
   if(!alive||request!==interactionSequence)return false;
   const closed=await api('popup_pet_menu',{request:{clientEpoch,token:prepared.token}}) as PetNativeView;
   if(!alive||request!==interactionSequence)return false;
   await applyView(closed);return true;
  }catch(e){if(alive&&request===interactionSequence)actionError.value=errorMessage(e);return false;}
  finally{if(alive&&request===interactionSequence){menuPending.value=false;void refresh();void reconcile();}}
 }
 async function startDrag(){
  if(!alive||!clientEpoch||!view.value.visible)return false;
  const request=++interactionSequence;dragPending.value=true;actionError.value='';cancelAction();
  try{
   const prepared=await api('prepare_pet_drag',{request:{clientEpoch}}) as {token:number;view:PetNativeView};
   if(!alive||request!==interactionSequence)return false;
   await applyView(prepared.view);await reconcile(true);await acknowledgeView();
   if(!alive||request!==interactionSequence)return false;
   const native=await api('start_pet_drag',{request:{clientEpoch,token:prepared.token}}) as PetNativeView;
   if(!alive||request!==interactionSequence)return false;
   await applyView(native);return true;
  }catch(e){if(alive&&request===interactionSequence&&!(e&&typeof e==='object'&&'code' in e&&e.code==='PET_DRAG_RELEASED'))actionError.value=errorMessage(e);return false;}
  finally{if(alive&&request===interactionSequence){dragPending.value=false;void reconcile();}}
 }
 function dispose(){
  if(!alive)return;alive=false;++readSequence;++connectSequence;++interactionSequence;++presentationSequence;++paintSequence;
  cancelAction();presentationAbort?.abort();paintAbort?.abort();for(const stop of unlisten.splice(0))stop();
  if(poll!==undefined){clearInterval(poll);poll=undefined;}
  if(clientEpoch)void api('set_pet_policy',{request:{clientEpoch,sequence:++policySequence,clientReady:false,reducedMotion:true,pageVisible:false}}).catch(()=>{});
 }
 return {snapshot,view,pose,motion,hasPending,error,connected,ready,presentationReady,start,refresh,reconnect,setPolicy,openMenu,startDrag,dispose};
}
