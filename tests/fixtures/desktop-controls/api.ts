import {invoke as profileInvoke} from '../profile-ui/api';
export {open,getVersion} from '../profile-ui/api';
let saved={version:1,workMode:false,petOnStartup:false};
export const calls:{command:string;input?:unknown}[]=[];
export const disabledUpdates:{label:string;value:boolean}[]=[];
export const buttonEvents:string[]=[];
export const snapshot=()=>structuredClone(saved);
let uiCase='empty',releaseRead:(()=>void)|undefined;
export function setUiCase(value:string){uiCase=value;}
export function releaseUiRead(){releaseRead?.();releaseRead=undefined;}
function uiRows(){if(uiCase==='width-batch')return [{id:'synthetic-signed',data:widthFields,status:'open',version:1,source:'signed_ai',createdAtMs:0,updatedAtMs:0,completedAtMs:null,deletedAtMs:null}];return ['populated','completed','deleted'].includes(uiCase)?[{id:'ui-synthetic-todo',data:{title:'合成界面事项',kind:'action',owner:'我',priority:'medium',due:null,followup:null,tags:[]},status:uiCase==='completed'?'completed':uiCase==='deleted'?'deleted':'open',version:1,source:'manual',createdAtMs:0,updatedAtMs:0,completedAtMs:null,deletedAtMs:null}]:[];}
const widthFields={title:'合成批次布局核对事项',kind:'action',owner:'我',priority:'medium',due:null,followup:null,tags:[]};
function widthBatch(){return {source:{id:'width-batch',rawText:'合成验收：核对来源批次下拉框与候选卡片的宽度和右侧按钮位置。',sourceAtMs:null,importedAtMs:0,anchorAtMs:0,timeZone:'UTC'},run:{id:'width-run',sourceId:'width-batch',kind:'extract',status:'succeeded',snapshot:{},input:{},errorCode:null,createdAtMs:0,finishedAtMs:1},candidates:[{id:'width-candidate',sourceId:'width-batch',runId:'width-run',status:'accepted',version:1,acceptedTodoId:'synthetic-signed',draft:{fields:widthFields,evidence:'合成来源依据，仅用于布局核对。',dueExpression:null,followupExpression:null,warnings:[],unresolved:false}}],previews:[]};}
export async function invoke(command:string,args?:Record<string,unknown>){
 if(new URLSearchParams(location.search).get('surface')==='workbench'){
  calls.push({command,input:args});
  if(command==='list_todos'){
   if(uiCase==='loading')await new Promise<void>(resolve=>releaseRead=resolve);
   if(uiCase==='error')throw {code:'WORKSPACE_IO',message:'合成清单读取失败'};
   return structuredClone(uiRows());
  }
  if(command==='list_import_batches'){
   if(uiCase==='width-batch')return [{id:'width-batch',excerpt:widthBatch().source.rawText,pending:0,total:1,status:'succeeded',importedAtMs:0}];
   if(uiCase==='inbox-loading')await new Promise<void>(resolve=>releaseRead=resolve);
   if(uiCase==='inbox-error')throw {code:'WORKSPACE_IO',message:'合成批次读取失败'};
  }
  if(command==='read_import_batch'&&args?.id==='width-batch')return uiCase==='width-batch'?structuredClone(widthBatch()):null;
  if(command==='read_model_run'&&args?.id==='width-run')return structuredClone(widthBatch().run);
  if(['organize_text','test_model','start_agent_trial','start_today_advice','sign_candidates'].includes(command))throw Error('Business calls are disabled in the UI fixture');
  return profileInvoke(command,args);
 }
 if(command==='read_desktop_preferences')return snapshot();
 if(command==='save_desktop_preferences'){
  const input=args?.input as {expected:typeof saved;preferences:typeof saved};
  if(JSON.stringify(input.expected)!==JSON.stringify(saved))throw {code:'DESKTOP_CONFLICT',message:'合成配置冲突'};
  calls.push({command,input:structuredClone(input)});saved=structuredClone(input.preferences);return {preferences:snapshot(),warning:null};
 }
 throw Error('Unsupported synthetic desktop command');
}
export async function listen(){return ()=>{};}
