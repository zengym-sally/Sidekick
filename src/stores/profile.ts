import { reactive, ref } from 'vue';
import { defineStore } from 'pinia';
import { invoke } from '@tauri-apps/api/core';

export interface UserProfile {version:number;name:string;address:string}
interface ProfileSave {profile:UserProfile;warning:string|null}
type Backend=(command:string,args?:Record<string,unknown>)=>Promise<unknown>;
export const DEFAULT_NICKNAME='小明同学';
const defaults=():UserProfile=>({version:1,name:DEFAULT_NICKNAME,address:'BOSS'});
const message=(error:unknown)=>error&&typeof error==='object'&&'message' in error&&typeof error.message==='string'?error.message:'个人信息操作暂未完成，请重试。';
export function createProfileModel(api:Backend){
  const saved=ref(defaults()),draft=reactive({name:DEFAULT_NICKNAME,address:'BOSS'}),ready=ref(false),loading=ref(false),saving=ref(false),loadError=ref(''),saveError=ref(''),warning=ref('');
  let generation=0;
  const snapshot=()=>JSON.stringify({name:draft.name,address:draft.address});
  async function load(){
    if(saving.value)return;
    const request=++generation,start=snapshot(),clean=draft.name===saved.value.name&&draft.address===saved.value.address;
    loading.value=true;loadError.value='';
    try{
      const result=await api('read_profile') as UserProfile;if(request!==generation)return;
      saved.value=result;if(clean&&snapshot()===start)Object.assign(draft,{name:result.name,address:result.address});
      ready.value=true;warning.value='';saveError.value='';
    }catch(error){if(request!==generation)return;ready.value=false;loadError.value=message(error);}
    finally{if(request===generation)loading.value=false;}
  }
  async function save(){
    if(!ready.value||loadError.value||saving.value)throw new Error('请先读取个人信息后再保存。');
    ++generation;loading.value=false;saving.value=true;saveError.value='';warning.value='';
    const start=snapshot(),input={name:draft.name,address:draft.address};
    try{
      const result=await api('save_profile',{input}) as ProfileSave;
      saved.value=result.profile;if(snapshot()===start)Object.assign(draft,{name:result.profile.name,address:result.profile.address});
      warning.value=result.warning||'';loadError.value='';return result;
    }catch(error){saveError.value=message(error);if(error&&typeof error==='object'&&'code' in error&&error.code==='PROFILE_SAVE_UNCERTAIN'){ready.value=false;loadError.value=saveError.value;}throw error;}
    finally{saving.value=false;}
  }
  function useNickname(){if(!ready.value||loading.value||saving.value||loadError.value)return;draft.address=draft.name.trim()||DEFAULT_NICKNAME;}
  function discard(){if(!saving.value){Object.assign(draft,{name:saved.value.name,address:saved.value.address});saveError.value='';warning.value='';}}
  return {saved,draft,ready,loading,saving,loadError,saveError,warning,load,save,useNickname,discard};
}
export const useProfile=defineStore('profile',()=>createProfileModel(invoke));
