import type {McpProbe,McpCatalog} from '../../../src/stores/mcpDiagnostics';
import type {McpConfiguration,McpServerDraft} from '../../../src/domain/mcp';
const key='sidekick-mcp-ui-fixture';
const parameters=new URLSearchParams(location.search);
const clone=<T>(value:T):T=>JSON.parse(JSON.stringify(value));
let configuration:McpConfiguration=JSON.parse(localStorage.getItem(key)||'null')||{version:1,revision:'',servers:[]};
let uncertain=parameters.has('mcpUncertain'),conflict=parameters.has('mcpConflict');
const secureAvailable=!parameters.has('mcpStorageUnavailable');
const secureValues=new Map<string,string>();
const probeKey='sidekick-mcp-diagnostic-fixture';
const probes:Record<string,McpProbe>=JSON.parse(localStorage.getItem(probeKey)||'{}');let active:string|null=null,startUncertain=parameters.has('mcpStartUncertain'),latestReads=0,refusalPending=false;
const persistProbes=()=>localStorage.setItem(probeKey,JSON.stringify(probes));
for(const p of Object.values(probes))if(p.status==='running'){p.status='interrupted';p.errorCode='INTERRUPTED';p.finishedAtMs=Date.now();}persistProbes();
function fixtureCatalog():McpCatalog{return {tools:Array.from({length:parameters.has('mcpMany')?64:2},(_,i)=>({name:i===0?'controlled_lookup':i===1?'controlled_search':`controlled_tool_${i}_长工具名称_便于核对换行`,description:i===0?'界面验收合成资料，没有启动真实服务；这段说明只按文本显示。':i===1?'<img src=x onerror=alert(1)> 仅为普通文字':'合成目录 · 只读工具输入格式',inputSchema:{type:'object',properties:Object.fromEntries(Array.from({length:parameters.has('mcpMany')?30:2},(_,n)=>[`query_${n}`,{type:'string',description:'合成参数说明，不执行工具。'}])),required:['query_0']}}))};}
function diagnosticFixture(command:string,args?:Record<string,unknown>):unknown{
 const serverId=String(args?.serverId||'');
 if(command==='active_mcp_probe')return refusalPending?new Promise(resolve=>setTimeout(()=>resolve(active),2500)):active;
 if(command==='latest_mcp_probe'){const value=clone(Object.values(probes).filter(p=>p.input.serverId===serverId).at(-1)||null);return parameters.has('mcpDelayInitialHistory')&&++latestReads===1?new Promise(resolve=>setTimeout(()=>resolve(value),8000)):value;}
 if(command==='read_mcp_probe')return clone(probes[String(args?.id)]);
 if(command==='read_mcp_catalog')return clone(fixtureCatalog());
 if(command==='cancel_mcp_probe'){const id=String(args?.id);if(id===active){probes[id]={...probes[id]!,status:'cancelled',errorCode:'CANCELLED',finishedAtMs:Date.now()};active=null;persistProbes();}return null;}
 if(command!=='start_mcp_probe')return undefined;
 if(parameters.has('mcpRaceDefiniteRefusal')){refusalPending=true;return new Promise((_resolve,reject)=>setTimeout(()=>{refusalPending=false;reject({code:'MCP_SCHEMA_REQUIRED'});},1500));}
 if(parameters.has('mcpSchemaRequired'))throw {code:'MCP_SCHEMA_REQUIRED'};
 if(active)throw {code:'RUNTIME_BUSY'};
 const service=configuration.servers.find(s=>s.id===serverId);if(!service||args?.expectedRevision!==configuration.revision)throw {code:'MCP_VERSION_CONFLICT'};
 const id='probe-'+crypto.randomUUID();const failed=service.command.includes('missing');const p:McpProbe={id,agentId:null,purpose:'mcp_probe',status:failed?'failed':'running',snapshot:{serverId,configurationRevision:configuration.revision,connectTimeoutMs:service.connectTimeoutMs},input:{serverId},result:null,errorCode:failed?'MCP_COMMAND_MISSING':null,createdAtMs:Date.now(),finishedAtMs:failed?Date.now():null};probes[id]=p;active=failed?null:id;persistProbes();
 if(!failed&&!service.args.includes('wait-list'))setTimeout(()=>{if(active!==id)return;probes[id]={...p,status:'succeeded',result:{tools:fixtureCatalog().tools.map(t=>({name:t.name,schemaSha256:'a'.repeat(64)})),catalogSha256:'b'.repeat(64)},finishedAtMs:Date.now()};active=null;persistProbes();},350);
 if(startUncertain){startUncertain=false;throw Error('synthetic lost start response');}return parameters.has('mcpDelayStartReceipt')?new Promise(resolve=>setTimeout(()=>resolve(clone(p)),4000)):clone(p);
}
function view(){const result=clone(configuration);result.secureStorageAvailable=secureAvailable;result.credentialStatus={};for(const service of result.servers){for(const item of service.env){if(item.source==='keychain'){(result.credentialStatus[service.id]||=Object.create(null))[item.name]=secureAvailable?(secureValues.has(service.id+'/'+item.name)?'stored':'missing'):'unavailable';item.value='';}}}return result;}
export function mcpFixture(command:string,args?:Record<string,unknown>){
 const diagnostic=diagnosticFixture(command,args);if(diagnostic!==undefined)return diagnostic;
 if(command==='read_mcp_configuration'){
  if(parameters.has('mcpReadError'))throw {code:'MCP_CONFIG_INVALID',message:'合成场景：配置无法读取，原文件未覆盖。'};
  return view();
 }
 if(command!=='save_mcp_server'&&command!=='save_mcp_secrets'&&command!=='remove_mcp_server')return undefined;
 const secure=args?.input as {edit:{id:string|null;expectedRevision:string;server:McpServerDraft};operationId:string;values:Record<string,string>};
 const input=(command==='save_mcp_secrets'?secure.edit:args?.input) as {id:string|null;expectedRevision:string;server:McpServerDraft};
 if(command==='save_mcp_secrets'&&!secureAvailable)throw {code:'MCP_CREDENTIAL_UNAVAILABLE',message:'合成场景：安全存储未启用。'};
 if(conflict||input.expectedRevision!==configuration.revision){conflict=false;throw {code:'MCP_VERSION_CONFLICT',message:'合成场景：配置已有更新，请重新读取后核对。'};}
 if(parameters.has('mcpSaveError'))throw {code:'WORKSPACE_IO',message:'合成场景：保存失败，草稿已保留。'};
 const id=input.id||'mcp-'+crypto.randomUUID();
 if(command==='save_mcp_server'||command==='save_mcp_secrets'){
  const service={...clone(input.server),id,...(command==='save_mcp_secrets'?{lastSecretOperation:secure.operationId}:configuration.servers.find(s=>s.id===id)?.lastSecretOperation?{lastSecretOperation:configuration.servers.find(s=>s.id===id)!.lastSecretOperation}:{})};
  if(command==='save_mcp_secrets')for(const [name,value] of Object.entries(secure.values))secureValues.set(id+'/'+name,value);
  configuration.servers=input.id?configuration.servers.map(s=>s.id===id?service:s):[...configuration.servers,service];
 }
 else configuration.servers=configuration.servers.filter(s=>s.id!==id);
 configuration={...configuration,revision:'fixture-'+crypto.randomUUID()};
 localStorage.setItem(key,JSON.stringify(configuration));
 if(uncertain){uncertain=false;throw {code:'MCP_SAVE_UNCERTAIN',message:'合成场景：响应丢失，请重新读取并核对服务列表。'};}
 return {configuration:view(),serverId:command!=='remove_mcp_server'?id:null,warning:null};
}
