import {ref,computed} from 'vue';
import {defineStore} from 'pinia';
import {invoke} from '@tauri-apps/api/core';
import {errorMessage} from './todos.ts';
export interface SkillDiagnostic {code:string;path:string;message:string}
export interface SkillPackage {relativePath:string;name?:string;description?:string;hash?:string;fileCount?:number;bytes?:number;builtinId?:string|null;modified?:boolean;installationConflict?:boolean;builtinFiles?:string[];diagnostics:SkillDiagnostic[]}
export interface SkillsCatalog {version:1;revision:string;scannedAtMs:number;root:string;skills:{name:string;description:string;relativePath:string;hash:string}[];packages:SkillPackage[];diagnostics:SkillDiagnostic[]}
type Backend=(command:string,args?:Record<string,unknown>)=>Promise<unknown>;
export function createSkills(api:Backend){
 const catalog=ref<SkillsCatalog|null>(null),loading=ref(false),restoring=ref(false),ready=ref(false),error=ref(''),notice=ref(''),selected=ref('');let generation=0;
 const current=computed(()=>catalog.value?.packages.find(p=>p.relativePath===selected.value)||null);
 function publish(value:SkillsCatalog){catalog.value=value;ready.value=true;if(!value.packages.some(p=>p.relativePath===selected.value))selected.value=value.packages[0]?.relativePath||'';}
 async function scan(){if(loading.value||restoring.value)return;const request=++generation;loading.value=true;error.value='';notice.value='';try{const value=await api('skills_catalog') as SkillsCatalog;if(request===generation)publish(value);}catch(e){if(request===generation){ready.value=false;error.value=errorMessage(e);}throw e;}finally{if(request===generation)loading.value=false;}}
 async function restore(){const item=current.value;if(!ready.value||loading.value||restoring.value||!item?.builtinId||!item.hash)throw Error('请先重新扫描并选择可恢复的内置技能。');const request=++generation;restoring.value=true;error.value='';notice.value='';try{const result=await api('restore_builtin_skill',{id:item.builtinId,expectedHash:item.hash}) as {catalog:SkillsCatalog;backupPath:string|null};if(request===generation){publish(result.catalog);notice.value=result.backupPath?`已恢复内置版本，原目录备份在：${result.backupPath}`:'内置技能已恢复。';}}catch(e){if(request===generation){ready.value=false;error.value=errorMessage(e);}throw e;}finally{if(request===generation)restoring.value=false;}}
 async function openDirectory(){try{await api('open_skills_directory');}catch(e){error.value=errorMessage(e);}}
 return {catalog,loading,restoring,ready,error,notice,selected,current,scan,restore,openDirectory};
}
export const useSkills=defineStore('skills',()=>createSkills(invoke));
