import {computed,reactive,ref} from 'vue';
import {defineStore} from 'pinia';
import {invoke} from '@tauri-apps/api/core';
import {useMcpSettings} from './mcp.ts';
export interface McpProbe {id:string;agentId:null;purpose:'mcp_probe';status:'running'|'succeeded'|'failed'|'cancelled'|'interrupted';snapshot:{serverId:string;configurationRevision:string;connectTimeoutMs:number;transport?:'stdio'|'http'};input:{serverId:string};result:{tools:{name:string;schemaSha256:string}[];catalogSha256?:string;remoteClose?:'confirmed'|'unsupported'|'unconfirmed'|'not-needed'}|null;errorCode:string|null;createdAtMs:number;finishedAtMs:number|null}
export interface McpCatalog {tools:{name:string;description?:string;inputSchema:Record<string,unknown>}[]}
interface Context {serverId:string;revision:string}
interface Row {run:McpProbe|null;catalog:McpCatalog|null;loading:boolean;error:string;sequence:number}
type Backend=(command:string,args?:Record<string,unknown>)=>Promise<unknown>;
const codes:Record<string,string>={MCP_HTTP_AUTH:'HTTP 服务认证未通过，请核对请求头引用；没有自动登录或认证重试。',MCP_HTTP_HEADER:'HTTP 请求头引用值不合法、会被规范化或超过预算，请核对完整变量值。',MCP_HTTP_REDIRECT:'HTTP 服务返回重定向，请直接配置最终地址；未向新目标转发认证信息。',MCP_HTTP_SESSION:'HTTP 会话失效或标识不合法，请重新发起诊断；旧调用不会自动重放。',MCP_HTTP_STATUS:'HTTP 服务未返回有效 MCP 响应，请核对服务后重新诊断。',MCP_HTTP_LIMIT:'HTTP 响应超过读取预算，本次未发布目录。',MCP_COMMAND_MISSING:'启动程序不可用，请检查命令和程序路径。',MCP_DIRECTORY_MISSING:'工作目录不可用，请核对目录。',MCP_ENV_MISSING:'配置的宿主变量缺失，请核对变量名与应用启动环境。',MCP_CREDENTIAL_UNAVAILABLE:'安全存储不可用或安全值读回未确认，请重新读取配置后核对。',MCP_TIMEOUT:'初始化或工具发现超时，请检查服务后重新诊断。',MCP_PROTOCOL:'服务协议或输出不合法，本次未发布工具目录。',MCP_CATALOG_INVALID:'工具目录或输入格式不受支持，本次未发布目录。',MCP_PRIVATE_OUTPUT:'目录含敏感引用值，已拒绝保存和显示。',MCP_CATALOG_SAVE:'工具目录未能保存，请检查本机文件后重新核对。',MCP_CATALOG_PATH:'目录身份或文件校验失败，未显示工具内容。',MCP_CLEANUP:'本地资源清理未确认，请重新核对诊断状态；活动任务结束前不要重复连接。',MCP_PROCESS:'诊断进程意外结束，请重新核对状态。',MCP_DEPENDENCY_MISSING:'随包运行资源不可用，请检查安装包。',MCP_SCHEMA_REQUIRED:'此工作根尚未开放诊断存储，未启动服务。请先在本页开启诊断存储。',MCP_PROBE_SAVE_UNCERTAIN:'诊断保存结果暂无法确认，请重开应用核对；不要重复诊断。',MCP_SAVE_UNCERTAIN:'配置保存结果未确认，请先重新读取配置。',RUNTIME_BUSY:'已有任务仍在运行或清理，请稍后核对。',MCP_VERSION_CONFLICT:'已保存配置已有更新，请重新读取后再诊断。',MCP_NOT_FOUND:'服务配置已不存在，请重新读取。',CANCELLED:'本次诊断已取消，未发布新目录。',INTERRUPTED:'上次诊断因应用退出中断，未自动重试。'};
export const probeMessage=(code?:string|null)=>codes[code||'']||'诊断状态暂无法确认，请重新核对。';
const errorCode=(e:unknown)=>e&&typeof e==='object'&&'code' in e?String(e.code):'';
function checkedRun(value:unknown,server?:string,id?:string):McpProbe {
 const r=value as McpProbe;
 if(!r||typeof r.id!=='string'||r.agentId!==null||r.purpose!=='mcp_probe'||!['running','succeeded','failed','cancelled','interrupted'].includes(r.status)||!r.snapshot||!r.input||r.input.serverId!==r.snapshot.serverId||(server&&r.input.serverId!==server)||(id&&r.id!==id))throw Error('Invalid diagnostic identity');
 return r;
}
export function createMcpDiagnostics(api:Backend,context:()=>Context){
 const rows=reactive<Record<string,Row>>(Object.create(null));
 const active=ref<McpProbe|null>(null),occupant=ref<McpProbe|null>(null),known=ref(false),starting=ref(false),cancelling=ref<string|null>(null),statusError=ref(''),startError=ref(''),notice=ref('');
 const error=computed(()=>[startError.value,statusError.value].filter(Boolean).join(' '));
 const uncertain=ref<(Context&{baseline:string|null})|null>(null);let activeSequence=0,startSequence=0;
 const occupied=computed(()=>starting.value||!!uncertain.value||!!occupant.value||!!active.value||!!cancelling.value);
 const row=(id:string)=>{if(!rows[id])rows[id]={run:null,catalog:null,loading:false,error:'',sequence:0};return rows[id]!;};
 function adopt(run:McpProbe){const pending=uncertain.value;if(pending&&run.id!==pending.baseline&&run.input.serverId===pending.serverId&&run.snapshot.configurationRevision===pending.revision){uncertain.value=null;active.value=occupant.value?.id===run.id?occupant.value:null;notice.value='已读回本次诊断记录，未重复启动。';startError.value='';statusError.value='';}}
 async function readLatest(serverId:string){
  const state=row(serverId),sequence=++state.sequence;state.loading=true;let candidate:McpProbe|null=null;
  try{
   const value=await api('latest_mcp_probe',{serverId});if(sequence!==state.sequence)return;
   candidate=value===null?null:checkedRun(value,serverId);let catalog:McpCatalog|null=null;
   if(candidate?.status==='succeeded'&&candidate.result?.catalogSha256){
    const value=await api('read_mcp_catalog',{id:candidate.id});if(sequence!==state.sequence)return;
    const c=value as McpCatalog|null;if(!c||!Array.isArray(c.tools)||c.tools.length>64||c.tools.length!==candidate.result.tools.length||c.tools.some((t,i)=>typeof t.name!=='string'||t.name!==candidate!.result!.tools[i]?.name||!t.inputSchema||typeof t.inputSchema!=='object'))throw {code:'MCP_CATALOG_PATH'};catalog=c;
   }
   if(sequence!==state.sequence)return;
   state.run=candidate;state.catalog=catalog;state.error='';if(candidate)adopt(candidate);
  }catch(e){if(sequence===state.sequence){state.run=candidate||state.run;state.catalog=null;state.error=probeMessage(errorCode(e));}}
  finally{if(sequence===state.sequence)state.loading=false;}
 }
 async function refreshActive(){const sequence=++activeSequence;try{
  const id=await api('active_mcp_probe') as string|null;if(sequence!==activeSequence)return;
  const run=id?checkedRun(await api('read_mcp_probe',{id}),undefined,id):null;if(sequence!==activeSequence)return;
  occupant.value=run;known.value=true;if(run)adopt(run);if(!uncertain.value)active.value=run;statusError.value='';
 }catch(e){if(sequence===activeSequence){known.value=false;statusError.value=probeMessage(errorCode(e));}}}
 async function reconcile(serverId?:string){await refreshActive();const ids=new Set([serverId,uncertain.value?.serverId,occupant.value?.input.serverId].filter((s):s is string=>!!s));await Promise.all([...ids].map(readLatest));}
 async function start(){
  if(starting.value||uncertain.value||cancelling.value)throw Error('请先核对上一诊断请求。');
  const expected=context();starting.value=true;const sequence=++startSequence;startError.value='';statusError.value='';notice.value='';let baseline:string|null=null,issued=false;
  try{
   await refreshActive();if(sequence!==startSequence)return;if(!known.value||occupant.value)throw {code:'RUNTIME_BUSY'};
   const old=await api('latest_mcp_probe',{serverId:expected.serverId});if(sequence!==startSequence)return;
   baseline=old===null?null:checkedRun(old,expected.serverId).id;
   const current=context();if(current.serverId!==expected.serverId||current.revision!==expected.revision)throw {code:'MCP_VERSION_CONFLICT'};
   const state=row(expected.serverId),rowSequence=++state.sequence,receiptActiveSequence=++activeSequence;
   state.loading=false;issued=true;
   const value=await api('start_mcp_probe',{serverId:expected.serverId,expectedRevision:expected.revision});if(sequence!==startSequence)return;
   const run=checkedRun(value,expected.serverId);if(run.snapshot.configurationRevision!==expected.revision||run.id===baseline)throw Error('Unexpected start receipt');
   if(state.sequence!==rowSequence||activeSequence!==receiptActiveSequence){known.value=false;return;}
   state.run=run;state.catalog=null;state.error='';active.value=run;occupant.value=run;known.value=true;
  }catch(e){if(sequence===startSequence){const code=errorCode(e);startError.value=probeMessage(code);const definite=['RUNTIME_BUSY','MCP_SCHEMA_REQUIRED','MCP_VERSION_CONFLICT','MCP_NOT_FOUND','SETUP_REQUIRED','MCP_CONFIG_INVALID'];if(issued&&!definite.includes(code)){uncertain.value={...expected,baseline};active.value=null;startError.value='开始请求的结果未确认。请重新核对诊断状态，暂不重复开始。';} }throw e;}
  finally{if(sequence===startSequence)starting.value=false;}
 }
 async function cancel(){const run=active.value;if(!run||uncertain.value||cancelling.value)return;startError.value='';cancelling.value=run.id;try{await api('cancel_mcp_probe',{id:run.id});if(active.value?.id===run.id)notice.value='已请求取消，正在等待进程清理和状态确认。';}catch{if(active.value?.id===run.id)statusError.value='取消请求结果暂无法确认，请重新核对状态。';}finally{if(cancelling.value===run.id)cancelling.value=null;}}
 const passed=(id:string)=>{const state=rows[id];return !!state&&!state.error&&state.run?.status==='succeeded'&&!!state.run.result?.catalogSha256&&!!state.catalog;};
 return {rows,active,occupant,known,starting,cancelling,uncertain,error,notice,occupied,readLatest,refreshActive,reconcile,start,cancel,passed};
}
export function observeMcpDiagnostics(refresh:()=>Promise<unknown>,subscribe:(fn:()=>void)=>Promise<()=>void>,clock:{setInterval:(fn:()=>void,ms:number)=>unknown;clearInterval:(id:unknown)=>void}={setInterval:(fn,ms)=>setInterval(fn,ms),clearInterval:id=>clearInterval(id as ReturnType<typeof setInterval>)},shouldPoll:()=>boolean=()=>true){
 let disposed=false,busy=false,off:(()=>void)|undefined;
 const update=()=>{if(disposed||busy)return;busy=true;void refresh().catch(()=>{}).finally(()=>{busy=false;});};
 const timer=clock.setInterval(()=>{if(shouldPoll())update();},1000);void subscribe(update).then(fn=>{if(disposed)fn();else off=fn;}).catch(()=>{});update();
 return ()=>{disposed=true;clock.clearInterval(timer);off?.();};
}
export const useMcpDiagnostics=defineStore('mcp-diagnostics',()=>{const mcp=useMcpSettings();return createMcpDiagnostics(invoke,()=>{const saved=mcp.find(mcp.selected);if(!mcp.ready||mcp.loading||mcp.saving||mcp.dirty||!saved||!mcp.configuration)throw Error('请先保存并确认服务配置。');return {serverId:saved.id,revision:mcp.configuration.revision};});});
