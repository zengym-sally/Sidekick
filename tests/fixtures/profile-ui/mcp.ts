import type {McpConfiguration,McpServerDraft} from '../../../src/domain/mcp';
const key='sidekick-mcp-ui-fixture';
const parameters=new URLSearchParams(location.search);
const clone=<T>(value:T):T=>JSON.parse(JSON.stringify(value));
let configuration:McpConfiguration=JSON.parse(localStorage.getItem(key)||'null')||{version:1,revision:'',servers:[]};
let uncertain=parameters.has('mcpUncertain'),conflict=parameters.has('mcpConflict');
const secureAvailable=!parameters.has('mcpStorageUnavailable');
const secureValues=new Map<string,string>();
function view(){const result=clone(configuration);result.secureStorageAvailable=secureAvailable;result.credentialStatus={};for(const service of result.servers){for(const item of service.env){if(item.source==='keychain'){(result.credentialStatus[service.id]||=Object.create(null))[item.name]=secureAvailable?(secureValues.has(service.id+'/'+item.name)?'stored':'missing'):'unavailable';item.value='';}}}return result;}
export function mcpFixture(command:string,args?:Record<string,unknown>){
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
