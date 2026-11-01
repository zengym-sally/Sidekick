import {computed,reactive,ref} from 'vue';
import {defineStore} from 'pinia';
import {invoke} from '@tauri-apps/api/core';
import {mcpClone,mcpDraft,normalizedMcp,type McpConfiguration,type McpServerDraft,type McpConfigSave} from '../domain/mcp.ts';
import {formatMcpJson,inspectMcpJson} from '../domain/mcpJson.ts';
import {errorMessage} from './todos.ts';

type Backend=(command:string,args?:Record<string,unknown>)=>Promise<unknown>;
interface Draft {value:McpServerDraft;base:McpServerDraft|null;baseline:string;mode?:'form'|'json';json?:{text:string;baseline:string;selection:number;baselineSelection:number}}
interface Pending {kind:'save'|'remove';key:string;id:string|null;requested:McpServerDraft|null;beforeIds:string[];revision:string;operationId?:string;values?:Record<string,string>}
const signature=(value:unknown)=>JSON.stringify(value);
export function createMcpSettings(api:Backend){
 const configuration=ref<McpConfiguration|null>(null),selected=ref(''),ready=ref(false),loading=ref(false),saving=ref(false),error=ref(''),notice=ref('');
 const drafts=reactive<Record<string,Draft>>({}),secretDrafts=reactive<Record<string,Record<string,string>>>({});let generation=0,pending:Pending|null=null;
 const find=(id:string)=>configuration.value?.servers.find(s=>s.id===id);
 function ensure(id:string){if(!drafts[id]){const server=find(id);if(!server)throw Error('服务已不存在，请重新读取后核对。');const value=mcpDraft(server);drafts[id]={value,base:mcpClone(value),baseline:signature(value)};}return drafts[id];}
 const current=computed(()=>selected.value?ensure(selected.value).value:null);
 const currentMode=computed(()=>selected.value?ensure(selected.value).mode||'form':'form');
 const jsonText=computed(()=>selected.value?ensure(selected.value).json?.text||'':'');
 const jsonSelection=computed(()=>selected.value?ensure(selected.value).json?.selection||0:0);
 const jsonPreview=computed(()=>inspectMcpJson(jsonText.value,current.value?.name||''));
 const jsonChanged=(d:Draft)=>!!d.json&&(d.json.text!==d.json.baseline||d.json.selection!==d.json.baselineSelection);
 function jsonValue(d:Draft){const preview=inspectMcpJson(d.json!.text,d.value.name),entry=preview.entries[d.json!.selection];if(preview.error||!entry?.draft)throw Error(preview.error||entry?.error||'请选择一项可保存的 stdio 服务。');return entry.draft;}
 function applyJson(d:Draft){d.value=mcpClone(jsonValue(d));}
 function setMode(mode:'form'|'json'){
  guard();if(!selected.value)return;const d=ensure(selected.value);if(mode===(d.mode||'form'))return;
  if(mode==='json'){if(Object.keys(activeSecrets(selected.value)).length)throw Error('请先保存或放弃安全值输入，再切换编辑方式。');const text=formatMcpJson(d.value);d.json={text,baseline:text,selection:0,baselineSelection:0};}
  else{if(d.json&&jsonChanged(d))applyJson(d);delete d.json;}
  d.mode=mode;error.value='';notice.value='';
 }
 function setJsonText(text:string){if(!selected.value)return;const d=ensure(selected.value);if(!d.json)throw Error('请先进入 JSON 模式。');d.json.text=text;d.json.selection=0;error.value='';notice.value='';}
 function selectJsonEntry(index:number){if(!selected.value)return;const d=ensure(selected.value);if(d.json&&Number.isInteger(index)&&index>=0&&index<jsonPreview.value.entries.length)d.json.selection=index;}
 function activeSecrets(id:string){const d=drafts[id],values:Record<string,string>=Object.create(null);for(const item of d?.value.env||[])if(item.source==='keychain'&&secretDrafts[id]?.[item.name])values[item.name]=secretDrafts[id][item.name];return values;}
 const dirty=computed(()=>{if(!selected.value)return false;const d=ensure(selected.value);return !d.base||signature(d.value)!==d.baseline||jsonChanged(d)||Object.keys(activeSecrets(selected.value)).length>0;});
 const entries=computed(()=>[...(configuration.value?.servers||[]).map(s=>({id:s.id,name:drafts[s.id]?.value.name||s.name,enabled:s.enabled,unsaved:!!drafts[s.id]&&(signature(drafts[s.id].value)!==drafts[s.id].baseline||jsonChanged(drafts[s.id])||Object.keys(activeSecrets(s.id)).length>0)})),...Object.entries(drafts).filter(([id])=>!find(id)).map(([id,d])=>({id,name:d.value.name||'新服务',enabled:d.value.enabled,unsaved:true}))]);
 function select(id:string){if(saving.value)return;ensure(id);selected.value=id;error.value='';notice.value='';}
 function add(){if(!ready.value||loading.value||saving.value||pending)throw Error('请先重新读取并核对 MCP 配置。');const id='draft-'+crypto.randomUUID();drafts[id]={value:mcpDraft(),base:null,baseline:''};selected.value=id;error.value='';notice.value='';}
 function setSecret(name:string,value:string){if(!selected.value||!ensure(selected.value).value.env.some(item=>item.name===name&&item.source==='keychain'))throw Error('请选择需要安全值的环境项。');(secretDrafts[selected.value]||=(Object.create(null) as Record<string,string>))[name]=value;}
 function clearSecret(name:string){if(secretDrafts[selected.value])delete secretDrafts[selected.value][name];}
 function acknowledge(key:string,id:string,requested:McpServerDraft,submitted?:Record<string,string>){
  const actual=find(id);if(!actual)throw Error('保存结果不完整，请重新读取并核对。');const d=ensure(key),value=mcpDraft(actual);
  const unchanged=signature(normalizedMcp(d.value))===signature(requested);d.base=mcpClone(value);d.baseline=signature(value);if(unchanged)d.value=value;
  if(d.json){try{if(signature(normalizedMcp(jsonValue(d)))===signature(requested)){d.json.baseline=d.json.text;d.json.baselineSelection=d.json.selection;}}catch{}}
  for(const [name,value] of Object.entries(submitted||{}))if(secretDrafts[key]?.[name]===value)delete secretDrafts[key][name];
  if(key!==id){drafts[id]=d;delete drafts[key];if(secretDrafts[key]){secretDrafts[id]=secretDrafts[key];delete secretDrafts[key];}if(selected.value===key)selected.value=id;}
 }
 function install(value:McpConfiguration){
  configuration.value=value;
  for(const [id,d] of Object.entries(drafts)){const actual=find(id);if(actual&&d.base&&signature(d.value)===d.baseline&&!jsonChanged(d)&&pending?.key!==id&&!Object.keys(activeSecrets(id)).length){d.value=mcpDraft(actual);d.base=mcpClone(d.value);d.baseline=signature(d.value);if(d.json){try{const text=formatMcpJson(d.value);d.json={text,baseline:text,selection:0,baselineSelection:0};}catch{delete d.json;d.mode='form';}}}}
  if(pending){
   const p=pending;
   if(p.kind==='remove'){
    if(!find(p.id!)){delete drafts[p.key];if(selected.value===p.key)selected.value='';}
    pending=null;
   }else if(p.operationId){
    const actual=value.servers.find(s=>s.lastSecretOperation===p.operationId&&(p.id?s.id===p.id:!p.beforeIds.includes(s.id)));
    if(actual){acknowledge(p.key,actual.id,p.requested!,p.values);pending=null;}
    else if(value.revision===p.revision)pending=null;
    else throw Error('安全值保存结果仍待核对；未找到本次操作记录，输入已保留，请勿重复保存。');
   }else if(p.id){
    const actual=find(p.id);if(actual&&signature(mcpDraft(actual))===signature(p.requested))acknowledge(p.key,p.id,p.requested!);pending=null;
   }else{
    const matches=value.servers.filter(s=>!p.beforeIds.includes(s.id)&&signature(mcpDraft(s))===signature(p.requested));
    if(matches.length===1){acknowledge(p.key,matches[0].id,p.requested!);pending=null;}
    else if(value.revision===p.revision)pending=null;
    else throw Error('新增服务的保存结果仍待核对。请核对已保存列表，再放弃这份新增草稿；不要重复保存。');
   }
  }
  if(!selected.value||(!drafts[selected.value]&&!find(selected.value)))selected.value=value.servers[0]?.id||Object.keys(drafts)[0]||'';
 }
 async function load(){if(saving.value)return;const request=++generation;loading.value=true;error.value='';try{const value=await api('read_mcp_configuration') as McpConfiguration;if(request!==generation)return;install(value);notice.value=value.warning||'';ready.value=true;}catch(e){if(request===generation){ready.value=false;error.value=errorMessage(e);}throw e;}finally{if(request===generation)loading.value=false;}}
 function guard(){if(!ready.value||loading.value||saving.value||pending)throw Error('请先重新读取并核对 MCP 配置。');}
 async function persist(operation:Pending){
  guard();saving.value=true;++generation;error.value='';notice.value='';const input=operation.kind==='save'?{id:operation.id,expectedRevision:configuration.value!.revision,server:operation.requested}:{id:operation.id,expectedRevision:configuration.value!.revision};
  try{
   const result=await api(operation.kind==='save'?(operation.operationId?'save_mcp_secrets':'save_mcp_server'):'remove_mcp_server',{input:operation.operationId?{edit:input,operationId:operation.operationId,values:operation.values}:input}) as McpConfigSave;
   configuration.value=result.configuration;
   if(operation.kind==='save'){if(!result.serverId||(operation.operationId&&find(result.serverId)?.lastSecretOperation!==operation.operationId))throw Error('保存结果不完整，请重新读取。');acknowledge(operation.key,result.serverId,operation.requested!,operation.values);}
   else{delete drafts[operation.key];delete secretDrafts[operation.key];if(selected.value===operation.key)selected.value=result.configuration.servers[0]?.id||Object.keys(drafts)[0]||'';}
   notice.value=result.warning||'服务配置已保存。';
  }catch(e){
   error.value=errorMessage(e);const code=e&&typeof e==='object'&&'code' in e?String(e.code):'';
   if(!['MCP_CONFIG_INVALID','MCP_PLAIN_CREDENTIAL','MCP_LIMIT','MCP_CREDENTIAL_MISSING','MCP_CREDENTIAL_UNAVAILABLE','WORKSPACE_IO'].includes(code))ready.value=false;
   if(!code||code==='MCP_SAVE_UNCERTAIN')pending=operation;
   throw e;
  }finally{saving.value=false;}
 }
 async function save(){
  try{guard();if(!selected.value||!dirty.value)throw Error('没有待保存的服务配置。');const key=selected.value,d=ensure(key),actual=find(key);
   if(d.mode==='json'){applyJson(d);if(actual&&signature(normalizedMcp(d.value))===signature(mcpDraft(actual))&&signature(d.base)===signature(mcpDraft(actual))){d.json!.baseline=d.json!.text;d.json!.baselineSelection=d.json!.selection;notice.value='JSON 与已保存配置一致，无需重复保存。';return;}}
   if(signature(d.base)!==signature(actual?mcpDraft(actual):null))throw Error('这项服务已有更新，草稿已保留；请放弃当前草稿后重新编辑。');
   const values=activeSecrets(key);if(Object.keys(values).length&&configuration.value?.secureStorageAvailable!==true)throw Error('真实安全存储尚未启用，未发送安全保存请求。');
   await persist({kind:'save',key,id:actual?.id||null,requested:normalizedMcp(d.value),beforeIds:configuration.value!.servers.map(s=>s.id),revision:configuration.value!.revision,...(Object.keys(values).length?{operationId:'op-'+crypto.randomUUID(),values:mcpClone(values)}:{})});
  }catch(e){if(!error.value)error.value=errorMessage(e);throw e;}
 }
 async function remove(){try{guard();const key=selected.value,actual=find(key);if(!actual)throw Error('请先保存服务，或使用放弃修改移除新增草稿。');if(dirty.value)throw Error('请先保存或放弃当前修改，再移除服务。');await persist({kind:'remove',key,id:actual.id,requested:null,beforeIds:[],revision:configuration.value!.revision});}catch(e){if(!error.value)error.value=errorMessage(e);throw e;}}
 function discard(){
  if(saving.value||!selected.value)return;const id=selected.value;delete drafts[id];delete secretDrafts[id];if(pending?.key===id)pending=null;
  if(!find(id))selected.value=configuration.value?.servers[0]?.id||Object.keys(drafts)[0]||'';error.value='';notice.value='';
 }
 return {configuration,selected,ready,loading,saving,error,notice,current,dirty,entries,drafts,secretDrafts,setSecret,clearSecret,load,select,add,save,remove,discard,find,currentMode,jsonText,jsonSelection,jsonPreview,setMode,setJsonText,selectJsonEntry};
}
export const useMcpSettings=defineStore('mcp',()=>createMcpSettings(invoke));
