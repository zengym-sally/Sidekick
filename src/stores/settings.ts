import {computed,reactive,ref} from 'vue';
import {defineStore} from 'pinia';
import {getWebApiClient,type WebApiClient} from '../lib/web-api-client.ts';
import {currentZone,setApplicationZone,setApplicationZoneReady} from '../domain/todos.ts';
import {errorMessage} from './todos.ts';
interface ApplicationSettings {timeZone:string}
interface SettingsSnapshot {settings:ApplicationSettings;version:number;warning:string|null}
type SettingsClient=Pick<WebApiClient,'readApplicationSettings'|'writeApplicationSettings'>;
export function createApplicationSettings(api:SettingsClient=getWebApiClient()){
 const saved=ref<ApplicationSettings>({timeZone:currentZone()}),draft=reactive({...saved.value}),ready=ref(false),loading=ref(false),saving=ref(false),error=ref(''),notice=ref('');let generation=0;
 const savedVersion=ref(0);
 setApplicationZoneReady(false);
 const dirty=computed(()=>draft.timeZone!==saved.value.timeZone);
 async function load(){if(saving.value)return;const request=++generation,start=draft.timeZone,clean=!dirty.value;loading.value=true;setApplicationZoneReady(false);error.value='';try{const snapshot=await api.readApplicationSettings() as SettingsSnapshot;if(request!==generation)return;setApplicationZone(snapshot.settings.timeZone);saved.value=snapshot.settings;savedVersion.value=snapshot.version;if(clean&&draft.timeZone===start)Object.assign(draft,snapshot.settings);ready.value=true;}catch(e){if(request===generation){ready.value=false;setApplicationZoneReady(false);error.value=errorMessage(e);}throw e;}finally{if(request===generation)loading.value=false;}}
 async function save(){if(!ready.value||loading.value||saving.value)throw Error('请先重新读取通用设置。');++generation;saving.value=true;setApplicationZoneReady(false);error.value='';notice.value='';const start=draft.timeZone;try{new Intl.DateTimeFormat('zh-CN',{timeZone:start});const snapshot=await api.writeApplicationSettings(start,savedVersion.value) as SettingsSnapshot;saved.value=snapshot.settings;savedVersion.value=snapshot.version;setApplicationZone(snapshot.settings.timeZone);if(draft.timeZone===start)Object.assign(draft,snapshot.settings);notice.value=snapshot.warning||'通用设置已保存。';}catch(e){error.value=errorMessage(e);const code=e&&typeof e==='object'&&'code' in e?String(e.code):'';if(code!=='validation_failed')ready.value=false;throw e;}finally{saving.value=false;setApplicationZoneReady(ready.value);}}
 function discard(){if(!saving.value){Object.assign(draft,saved.value);error.value='';notice.value='';}}
 return {saved,savedVersion,draft,ready,loading,saving,error,notice,dirty,load,save,discard};
}
export const useApplicationSettings=defineStore('settings',()=>createApplicationSettings());
