import {reactive,ref} from 'vue';
import {invoke} from '@tauri-apps/api/core';
import {draftPoint,rezoneDraft,timeDraft} from '../domain/time.ts';
import {setApplicationZone,setApplicationZoneReady,type TodoInput,type WorkspaceInfo} from '../domain/todos.ts';
import {errorMessage} from './todos.ts';

type Backend=(command:string,args?:Record<string,unknown>)=>Promise<unknown>;
interface Context {workspace:WorkspaceInfo;timeZone:string|null}
export function createQuickEntry(api:Backend=invoke,operation:()=>string=()=>crypto.randomUUID()){
 const form=reactive({title:'',kind:'action' as TodoInput['kind'],owner:'我',priority:'medium' as TodoInput['priority'],due:timeDraft(null),followup:timeDraft(null),tags:''});
 const workspace=ref<WorkspaceInfo|null>(null),ready=ref(false),loading=ref(false),saving=ref(false),uncertain=ref(false),error=ref(''),notice=ref('');
 let generation=0,alive=true,boundRoot:string|null=null,pending:{root:string;operationId:string;input:TodoInput}|null=null;
 setApplicationZoneReady(false);
 async function context():Promise<Context>{
  const before=await api('workspace_info') as WorkspaceInfo;
  if(before.needsSetup)return {workspace:before,timeZone:null};
  const settings=await api('read_application_settings') as {timeZone:string};
  const after=await api('workspace_info') as WorkspaceInfo;
  if(!before.root||after.needsSetup||after.root!==before.root)throw Error('工作目录已有变化，请先在工作台核对；原输入已保留。');
  if(typeof settings.timeZone!=='string'||!settings.timeZone)throw Error('日期规则无法确认，请重新读取。');
  new Intl.DateTimeFormat('zh-CN',{timeZone:settings.timeZone});
  return {workspace:after,timeZone:settings.timeZone};
 }
 function accept(value:Context){
  workspace.value=value.workspace;ready.value=false;
  if(value.workspace.needsSetup||!value.workspace.root){setApplicationZoneReady(false);return;}
  if(boundRoot&&boundRoot!==value.workspace.root&&(pending||form.title||form.tags||form.due.enabled||form.followup.enabled||form.owner!=='我'||form.kind!=='action'||form.priority!=='medium'))throw Error('工作目录已有变化，请先在工作台核对；原输入已保留。');
  if(!uncertain.value){setApplicationZone(value.timeZone);rezoneDraft(form.due);rezoneDraft(form.followup);}
  boundRoot=value.workspace.root;ready.value=true;
 }
 async function activate(){
  if(saving.value)return;
  const request=++generation;loading.value=true;ready.value=false;
  try{const value=await context();if(alive&&request===generation){accept(value);if(!uncertain.value)error.value='';}}
  catch(e){if(alive&&request===generation){ready.value=false;error.value=errorMessage(e);}}
  finally{if(alive&&request===generation)loading.value=false;}
 }
 function clear(){Object.assign(form,{title:'',kind:'action',owner:'我',priority:'medium',due:timeDraft(null),followup:timeDraft(null),tags:''});}
 function input():TodoInput{
  if(!form.title.trim()||!form.owner.trim())throw Error('请填写标题和负责人，再保存事项。');
  return {title:form.title.trim(),kind:form.kind,owner:form.owner.trim(),priority:form.priority,due:draftPoint(form.due),followup:form.kind==='followup'?draftPoint(form.followup):null,tags:[...new Set(form.tags.split(/[，,]/).map(tag=>tag.trim()).filter(Boolean))]};
 }
 async function save(){
  if(saving.value||loading.value)return false;
  const request=++generation;saving.value=true;ready.value=false;error.value='';notice.value='';let dispatched=false;
  try{
   const value=await context();if(!alive||request!==generation)return false;
   accept(value);
   if(!ready.value||!value.workspace.root)throw Error('请先在工作台选择工作目录，再回来保存。');
   if(!pending)pending={root:value.workspace.root,operationId:operation(),input:JSON.parse(JSON.stringify(input()))};
   if(pending.root!==value.workspace.root)throw Error('请先恢复原工作目录，再核对这次保存。');
   dispatched=true;
   await api('create_todo',{input:pending.input,operationId:pending.operationId});
   if(!alive||request!==generation)return true;
   pending=null;uncertain.value=false;clear();notice.value='事项已保存。';
   try{await api('desktop_window_action',{action:'hide_quick'});}catch{if(alive&&request===generation)notice.value='事项已保存，快捷窗暂未收起；可继续使用工作台。';}
   return true;
  }catch(e){
   if(alive&&request===generation){
    const code=e&&typeof e==='object'&&'code' in e?String(e.code):'';
    if(dispatched&&code!=='INVALID_INPUT'){uncertain.value=true;error.value='保存结果尚未确认，原请求已保留。请重试原保存，确认前不创建新事项。';}
    else{if(dispatched){pending=null;uncertain.value=false;}error.value=errorMessage(e);}
   }
   return false;
  }finally{if(alive&&request===generation)saving.value=false;}
 }
 function dispose(){alive=false;++generation;}
 return {form,workspace,ready,loading,saving,uncertain,error,notice,activate,save,dispose};
}
