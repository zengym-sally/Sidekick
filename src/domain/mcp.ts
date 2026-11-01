export interface McpEnvironment {name:string;source:'literal'|'environment'|'keychain';value:string}
interface McpCommon {name:string;enabled:boolean;connectTimeoutMs:number;toolTimeoutMs:number}
export interface McpStdioDraft extends McpCommon {transport:'stdio';command:string;args:string[];cwd:string|null;env:McpEnvironment[]}
export interface McpHeader {name:string;source:'environment';value:string}
export interface McpHttpDraft extends McpCommon {transport:'http';url:string;headers:McpHeader[]}
export type McpServerDraft=McpStdioDraft|McpHttpDraft;
export type McpServer=McpServerDraft&{id:string;lastSecretOperation?:string|null};
export interface McpConfiguration {version:1|2;revision:string;servers:McpServer[];secureStorageAvailable?:boolean;credentialStatus?:Record<string,Record<string,string>>;warning?:string|null}
export interface McpConfigSave {configuration:McpConfiguration;serverId:string|null;warning:string|null}
export const mcpClone=<T>(value:T):T=>JSON.parse(JSON.stringify(value));
export function mcpDraft():McpStdioDraft;
export function mcpDraft(server:undefined,transport:'http'):McpHttpDraft;
export function mcpDraft(server?:McpServer,transport?:'stdio'|'http'):McpServerDraft;
export function mcpDraft(server?:McpServer,transport:'stdio'|'http'='stdio'):McpServerDraft {
 if(!server)return transport==='stdio'?{name:'',transport:'stdio',enabled:true,command:'',args:[],cwd:null,env:[],connectTimeoutMs:10000,toolTimeoutMs:30000}:{name:'',transport:'http',enabled:true,url:'',headers:[],connectTimeoutMs:10000,toolTimeoutMs:30000};
 const {id:_,lastSecretOperation:_operation,...settings}=server;return mcpClone(settings as McpServerDraft);
}
export function normalizedMcp(draft:McpServerDraft):McpServerDraft {
 const value=mcpClone(draft);value.name=value.name.trim();
 if(value.transport==='http'){
  if(Object.keys(value).some(key=>!['name','transport','enabled','url','headers','connectTimeoutMs','toolTimeoutMs'].includes(key)))throw Error('HTTP 配置不能混入 stdio 或未知字段。');
  let url:URL;try{url=new URL(value.url.trim());}catch{throw Error('请填写有效的 HTTP 服务地址。');}
  if(value.url.includes('#')||!['http:','https:'].includes(url.protocol)||url.username||url.password||url.href.length>4096||/\p{Cc}/u.test(value.url)||url.protocol==='http:'&&!['127.0.0.1','[::1]'].includes(url.hostname))throw Error('HTTP 服务地址仅允许 HTTPS 或数字本机回环 HTTP；不能含用户名、密码或片段。');
  for(const key of url.searchParams.keys()){const name=key.toLowerCase().replace(/[-_]/g,'');if(/token|secret|password|passwd|authorization|credential|apikey|signature/.test(name)||['auth','key','sig','jwt'].includes(name))throw Error('HTTP 认证信息请使用请求头的宿主变量引用，不能放在地址中。');}
  value.url=url.href;const names=new Set<string>(),blocked=['host','accept','content-type','content-length','connection','transfer-encoding','origin','cookie','set-cookie','proxy-authorization','mcp-session-id','mcp-protocol-version','last-event-id'];
  if(!Array.isArray(value.headers)||value.headers.length>64)throw Error('HTTP 请求头最多64项。');
  for(const item of value.headers){const name=item?.name?.toLowerCase();if(!item||Object.keys(item).some(key=>!['name','source','value'].includes(key))||typeof item.name!=='string'||item.name.length>128||!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(item.name)||blocked.includes(name)||names.has(name)||item.source!=='environment'||typeof item.value!=='string'||!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(item.value))throw Error('HTTP 请求头需使用不重复的合法名称及完整宿主变量名；协议头由应用管理。');names.add(name);}
  return value;
 }
 value.command=value.command.trim();if(!value.cwd?.trim())value.cwd=null;return value;
}
