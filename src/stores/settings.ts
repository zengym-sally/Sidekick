import {computed,reactive,ref} from 'vue';
import {defineStore} from 'pinia';
import {getWebApiClient} from '../lib/web-api-client.ts';
import {currentZone,setApplicationZone,setApplicationZoneReady} from '../domain/todos.ts';
import {errorMessage} from './todos.ts';
interface ApplicationSettings {timeZone:string}
type Backend=(command:string,args?:Record<string,unknown>)=>Promise<unknown>;
export function createApplicationSettings(api:Backend=getWebApiClient().asBackend()){
 const saved=ref<ApplicationSettings>({timeZone:currentZone()}),draft=reactive({...saved.value}),ready=ref(false),loading=ref(false),saving=ref(false),error=ref(''),notice=ref('');let generation=0;
 const savedVersion=ref(0);
 setApplicationZoneReady(false);
 const dirty=computed(()=>draft.timeZone!==saved.value.timeZone);
 async function load(){if(saving.value)return;const request=++generation,start=draft.timeZone,clean=!dirty.value;loading.value=true;setApplicationZoneReady(false);error.value='';try{const value=await api('read_application_settings') as ApplicationSettings&{version?:number};if(request!==generation)return;setApplicationZone(value.timeZone);saved.value={timeZone:value.timeZone};savedVersion.value=value.version??0;if(clean&&draft.timeZone===start)Object.assign(draft,saved.value);ready.value=true;}catch(e){if(request===generation){ready.value=false;setApplicationZoneReady(false);error.value=errorMessage(e);}throw e;}finally{if(request===generation)loading.value=false;}}
 async function save(){if(!ready.value||loading.value||saving.value)throw Error('请先重新读取通用设置。');++generation;saving.value=true;setApplicationZoneReady(false);error.value='';notice.value='';const start=draft.timeZone;try{new Intl.DateTimeFormat('zh-CN',{timeZone:start});const result=await api('save_application_settings',{input:{timeZone:start,expectedVersion:savedVersion.value,expectedTimeZone:saved.value.timeZone}}) as {settings:ApplicationSettings;version:number;warning:string|null};saved.value=result.settings;savedVersion.value=result.version;setApplicationZone(result.settings.timeZone);if(draft.timeZone===start)Object.assign(draft,result.settings);notice.value=result.warning||'通用设置已保存。';}catch(e){error.value=errorMessage(e);const code=e&&typeof e==='object'&&'code' in e?String(e.code):'';if(!['WORKSPACE_IO','validation_failed'].includes(code))ready.value=false;throw e;}finally{saving.value=false;setApplicationZoneReady(ready.value);}}
 function discard(){if(!saving.value){Object.assign(draft,saved.value);error.value='';notice.value='';}}
 return {saved,savedVersion,draft,ready,loading,saving,error,notice,dirty,load,save,discard};
}
export const useApplicationSettings=defineStore('settings',()=>createApplicationSettings());
