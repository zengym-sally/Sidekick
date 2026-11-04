import {computed,reactive,ref,watch} from 'vue';
import {defineStore} from 'pinia';
import {invoke} from '@tauri-apps/api/core';
import {listen} from '@tauri-apps/api/event';
import {observeWorkspaceChanges} from '../domain/desktop.ts';
import {errorMessage} from './todos.ts';

interface DesktopPreferences {version:number;workMode:boolean;petOnStartup:boolean}
type Backend=(command:string,args?:Record<string,unknown>)=>Promise<unknown>;
type Subscribe=(changed:()=>void)=>Promise<()=>void>;
const defaults=():DesktopPreferences=>({version:1,workMode:false,petOnStartup:false});
const same=(a:DesktopPreferences,b:DesktopPreferences)=>a.version===b.version&&a.workMode===b.workMode&&a.petOnStartup===b.petOnStartup;
const preferenceEvents:Subscribe=changed=>listen('desktop-preferences-changed',changed);

export function createDesktopPreferences(api:Backend=invoke){
 const saved=ref(defaults()),draft=reactive(defaults()),ready=ref(false),loading=ref(false),saving=ref(false),error=ref(''),notice=ref(''),appliedWorkMode=ref(true);
 const dirty=computed(()=>!same(draft,saved.value));
 let alive=true,generation=0,reconcileRequired=false,started=false,cleanup:(()=>void)|undefined;
 async function load(explicit=true){
  if(!alive||saving.value)return;
  const request=++generation,start={...draft},clean=!dirty.value;
  loading.value=true;if(explicit||!reconcileRequired)error.value='';
  try{
   const result=await api('read_desktop_preferences') as DesktopPreferences;
   if(!alive||request!==generation)return;
   appliedWorkMode.value=result.workMode;
   if(!explicit&&dirty.value&&!same(result,saved.value)){
    ready.value=false;reconcileRequired=true;
    if(!error.value)error.value='桌面偏好已有更新，草稿已保留，请重新读取核对。';
    return;
   }
   saved.value=result;
   if((explicit||!reconcileRequired)&&clean&&same(draft,start))Object.assign(draft,result);
   if(explicit){reconcileRequired=false;error.value='';notice.value='';}
   ready.value=!reconcileRequired;
  }catch(e){if(alive&&request===generation){ready.value=false;reconcileRequired=true;error.value=errorMessage(e);}}
  finally{if(alive&&request===generation)loading.value=false;}
 }
 async function save(){
  if(!alive||!ready.value||loading.value||saving.value||!dirty.value)return false;
  const request=++generation,start={...draft},input={preferences:{...draft},expected:{...saved.value}};
  saving.value=true;error.value='';notice.value='';
  try{
   const result=await api('save_desktop_preferences',{input}) as {preferences:DesktopPreferences;warning:string|null};
   if(!alive||request!==generation)return false;
   saved.value=result.preferences;appliedWorkMode.value=result.preferences.workMode;
   if(same(draft,start))Object.assign(draft,result.preferences);
   notice.value=result.warning||'桌面偏好已保存。';return true;
  }catch(e){if(alive&&request===generation){ready.value=false;reconcileRequired=true;error.value=errorMessage(e);}return false;}
  finally{if(alive&&request===generation)saving.value=false;}
 }
 function discard(){if(alive&&!saving.value){Object.assign(draft,saved.value);notice.value='';}}
 async function start(target:Pick<HTMLElement,'setAttribute'|'removeAttribute'>,events:EventTarget=window,visibility:EventTarget&{hidden:boolean}=document,subscribe:Subscribe=preferenceEvents){
  if(started||!alive)return;started=true;
  try{
   const status=await api('read_desktop_status') as {enabled:boolean};
   if(!alive||!status.enabled)return;
   const stopEffect=watch(appliedWorkMode,value=>target.setAttribute('data-work-mode',String(value)),{immediate:true,flush:'sync'});
   const observer=observeWorkspaceChanges(subscribe,()=>load(false),()=>load(false));
   const focus=()=>{void observer.refresh();},visible=()=>{if(!visibility.hidden)focus();};
   events.addEventListener('focus',focus);visibility.addEventListener('visibilitychange',visible);
   cleanup=()=>{observer.stop();stopEffect();events.removeEventListener('focus',focus);visibility.removeEventListener('visibilitychange',visible);target.removeAttribute('data-work-mode');};
   await observer.ready;
  }catch(e){if(alive)error.value=errorMessage(e);}
 }
 function dispose(){alive=false;++generation;cleanup?.();cleanup=undefined;}
 return {saved,draft,ready,loading,saving,error,notice,appliedWorkMode,dirty,load,save,discard,start,dispose};
}
export const useDesktopPreferences=defineStore('desktopPreferences',()=>createDesktopPreferences());
