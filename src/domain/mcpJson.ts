import {mcpDraft,normalizedMcp,type McpServerDraft,type McpHttpDraft} from './mcp.ts';

export interface McpJsonEntry {name:string;transport:string;draft?:McpServerDraft;error:string}
export interface McpJsonPreview {format:string;entries:McpJsonEntry[];error:string}
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const variable=/^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const control=/[\u0000-\u001f\u007f-\u009f]/u;
const credential=/(?:token|secret|password|passwd|api_?key|authorization|credential|private_?key)/i;
const dynamic=(value:string)=>value.includes('${')||value.includes('{env:')||value.startsWith('!');
const bytes=(value:string)=>new TextEncoder().encode(value).length;
function fail(message:string):never {throw Error(message);}
function message(error:unknown){return error instanceof Error?error.message:'配置无法识别，请核对格式。';}
function text(value:unknown,label:string,max=4096){
 if(typeof value!=='string'||bytes(value)>max||value.includes('\0'))fail(`${label}必须是长度合规的字符串。`);
 return value;
}
function rejectDuplicates(input:string){
 const tokens=[...input.matchAll(/"(?:\\[\s\S]|[^"\\])*"|[{}\[\]:,]/g)].map(match=>match[0]);
 const stack:(Set<string>|null)[]=[];
 for(let i=0;i<tokens.length;i++){
  const token=tokens[i];
  if(token==='{')stack.push(new Set());else if(token==='[')stack.push(null);
  else if(token==='}'||token===']')stack.pop();
  else if(token.startsWith('"')&&tokens[i+1]===':'){
   const keys=stack.at(-1),key=JSON.parse(token) as string;
   if(keys?.has(key))fail('JSON 含重复字段或重复服务名称，请合并后重试。');keys?.add(key);
  }
 }
}
function timeout(source:Record<string,unknown>,fields:[string,number][],fallback:number,max:number){
 const values=fields.filter(([key])=>Object.hasOwn(source,key)).map(([key,scale])=>{
  const value=source[key];if(typeof value!=='number'||!Number.isFinite(value))fail('超时必须是数字，请按字段标明的秒或毫秒填写。');
  const scaled=value*scale,ms=Math.round(scaled);
  if(Math.abs(scaled-ms)>Number.EPSILON*Math.max(1,Math.abs(scaled))*4||ms<1000||ms>max)fail('连接超时需为 1–30 秒，工具超时需为 1–60 秒，精度为毫秒，不会自动截断。');return ms;
 });
 if(new Set(values).size>1)fail('同一超时存在不同单位或数值的重复设置，请只保留一种。');return values[0]??fallback;
}
function stdio(value:Record<string,unknown>,name:string):McpServerDraft {
 const allowed=['name','type','command','args','cwd','env','env_vars','enabled','timeout','timeoutMs','connectTimeoutMs','toolTimeoutMs','startup_timeout_sec','tool_timeout_sec'];
 if(Object.keys(value).some(key=>!allowed.includes(key)))fail('配置含当前未支持的字段，请按下方兼容范围核对；不会忽略字段后保存。');
 const result=mcpDraft();result.name=text(value.name??name,'服务名称').trim();
 if(!result.name||Array.from(result.name).length>100||control.test(result.name))fail('请填写不超过 100 字的服务名称。');
 if(value.name!==undefined&&name&&value.name!==name)fail('对象内名称与服务名不一致，请只保留一致的名称。');
 result.command=text(value.command,'启动命令').trim();if(!result.command||control.test(result.command))fail('请填写一个有效的启动程序；参数放入 args 数组。');
 if(value.args!==undefined&&!Array.isArray(value.args))fail('args 必须是字符串数组，不能按空格猜测拆分。');
 const args=(value.args??[]) as unknown[];if(args.length>128)fail('参数最多 128 项。');result.args=args.map(arg=>text(arg,'参数'));
 const secretFlags=['--api-key','--apikey','--token','--access-token','--password','--secret','--client-secret','--authorization'];
 if(result.args.some(arg=>secretFlags.includes(arg.split('=')[0].toLowerCase())))fail('认证参数请改为环境变量引用，不要放入命令参数。');
 if(value.enabled!==undefined&&typeof value.enabled!=='boolean')fail('enabled 必须为 true 或 false。');result.enabled=(value.enabled??true) as boolean;
 if(value.cwd!==undefined&&value.cwd!==null){const cwd=text(value.cwd,'工作目录');if(!cwd.startsWith('/'))fail('工作目录需使用绝对路径，或省略 cwd 使用任务目录。');result.cwd=cwd;}
 result.connectTimeoutMs=timeout(value,[['startup_timeout_sec',1000],['connectTimeoutMs',1],['timeoutMs',1]],10000,30000);
 result.toolTimeoutMs=timeout(value,[['timeout',1000],['tool_timeout_sec',1000],['toolTimeoutMs',1],['timeoutMs',1]],30000,60000);
 if(value.env!==undefined&&!object(value.env))fail('env 必须是变量名与字符串值组成的对象。');
 for(const [name,raw] of Object.entries(value.env??{})){
  if(!variable.test(name))fail('环境变量名需以字母或下划线开头，只含字母、数字和下划线。');
  const v=text(raw,'环境值'),reference=/^\$\{(?:env:)?([A-Za-z_][A-Za-z0-9_]{0,127})\}$/.exec(v);
  if(reference)result.env.push({name,source:'environment',value:reference[1]});
  else{
   if(dynamic(v))fail('当前不支持该动态表达；只支持整值 ${NAME} 环境引用，不执行命令或交互输入。');
   if(credential.test(name))fail('认证环境项请使用 ${HOST_VARIABLE} 引用；当前安全存储尚未启用，不导入明文凭据。');
   result.env.push({name,source:'literal',value:v});
  }
 }
 if(value.env_vars!==undefined){
  if(!Array.isArray(value.env_vars))fail('env_vars 必须是宿主变量名字符串数组。');
  for(const name of value.env_vars){if(typeof name!=='string'||!variable.test(name)||result.env.some(item=>item.name===name))fail('env_vars 含无效或重复变量，请与 env 核对。');result.env.push({name,source:'environment',value:name});}
 }
 if(result.env.length>64)fail('环境项最多 64 项。');return result;
}
export function inspectMcpJson(input:string,fallbackName=''):McpJsonPreview {
 try{
  if(bytes(input)>256*1024)fail('JSON 超过 256 KiB，请只粘贴需要的服务配置。');
  let value:unknown;try{value=JSON.parse(input);}catch{fail('JSON 语法不正确，请检查双引号、逗号和括号；不支持 TOML 或注释。');}
  rejectDuplicates(input);if(!object(value))fail('请粘贴 JSON 对象，不是数组或单个字符串。');
  const wrappers=['mcpServers','mcp_servers','servers'].filter(key=>Object.hasOwn(value,key));
  let format='服务名映射',items:[string,unknown][];
  if(wrappers.length){
   if(wrappers.length!==1||Object.keys(value).length!==1||!object(value[wrappers[0]]))fail('服务包裹格式有歧义或含额外字段，请只保留一个服务集合。');
   const wrapped=value[wrappers[0]];if(!object(wrapped))fail('服务集合必须是 JSON 对象。');
   format=wrappers[0]==='mcp_servers'?'Codex 字段的 JSON 表达':wrappers[0]==='servers'?'VS Code servers':'mcpServers';items=Object.entries(wrapped);
  }else if(['command','url','type'].some(key=>typeof value[key]==='string')){format='单个服务对象';items=[[typeof value.name==='string'?value.name:fallbackName||'new-server',value]];}
  else items=Object.entries(value);
  if(!items.length||items.length>20)fail('一次可识别 1–20 项服务，请缩小配置范围。');
  const entries=items.map(([name,raw]):McpJsonEntry=>{
   let transport='未知';
   try{
    if(!object(raw))fail('每项服务都必须是 JSON 对象。');
    const hasCommand=Object.hasOwn(raw,'command'),hasUrl=Object.hasOwn(raw,'url');
    if(hasCommand&&hasUrl||hasCommand&&['http','streamable-http','streamable_http','sse'].includes(String(raw.type))||hasUrl&&raw.type==='stdio')fail('命令、URL 与传输类型冲突，请保留一种连接方式。');
    if(raw.type!==undefined&&typeof raw.type!=='string')fail('type 必须是传输类型字符串。');
    const type=typeof raw.type==='string'?raw.type:hasUrl?'http':'stdio';
    transport=['stdio','http','streamable-http','streamable_http','sse'].includes(type)?type:'未知';
    if(transport==='sse')fail('旧 HTTP＋SSE 传输尚未接入；请使用 Streamable HTTP 或 stdio。');
    if(['http','streamable-http','streamable_http'].includes(transport))return {name,transport:'http',draft:http(raw,name),error:''};
    if(transport!=='stdio')fail('当前只支持 stdio 传输；请核对 type。');
    return {name,transport,draft:stdio(raw,name),error:''};
   }catch(error){return {name,transport,error:message(error)};}
  });
  return {format,entries,error:''};
 }catch(error){return {format:'',entries:[],error:message(error)};}
}
function http(value:Record<string,unknown>,name:string):McpHttpDraft {
 const allowed=['name','type','url','headers','enabled','timeout','timeoutMs','connectTimeoutMs','toolTimeoutMs','startup_timeout_sec','tool_timeout_sec'];
 if(Object.keys(value).some(key=>!allowed.includes(key)))fail('HTTP 配置含未知或 stdio 字段，未忽略后保存。');
 const result=mcpDraft(undefined,'http');result.name=text(value.name??name,'服务名称').trim();
 if(!result.name||Array.from(result.name).length>100||control.test(result.name))fail('请填写不超过 100 字的服务名称。');
 if(value.name!==undefined&&name&&value.name!==name)fail('对象内名称与服务名不一致，请只保留一致的名称。');
 result.url=text(value.url,'HTTP 服务地址');
 if(value.enabled!==undefined&&typeof value.enabled!=='boolean')fail('enabled 必须为 true 或 false。');result.enabled=(value.enabled??true) as boolean;
 result.connectTimeoutMs=timeout(value,[['startup_timeout_sec',1000],['connectTimeoutMs',1],['timeoutMs',1]],10000,30000);
 result.toolTimeoutMs=timeout(value,[['timeout',1000],['tool_timeout_sec',1000],['toolTimeoutMs',1],['timeoutMs',1]],30000,60000);
 if(value.headers!==undefined&&!object(value.headers))fail('HTTP 请求头需为名称与整值宿主引用组成的对象。');
 for(const [name,raw] of Object.entries(value.headers??{})){
  const reference=typeof raw==='string'&&/^\$\{(?:env:)?([A-Za-z_][A-Za-z0-9_]{0,127})\}$/.exec(raw);
  if(!reference)fail('HTTP 请求头仅接受整值 ${HOST_VARIABLE} 引用；完整头值由变量提供，不导入明文或内插。');
  result.headers.push({name,source:'environment',value:reference[1]});
 }
 return normalizedMcp(result) as McpHttpDraft;
}
export function formatMcpJson(draft:McpServerDraft):string {
 if(draft.transport==='http'){
  const value=normalizedMcp(draft) as McpHttpDraft,headers=Object.fromEntries(value.headers.map(h=>[h.name,`\${${h.value}}`]));
  return JSON.stringify({mcpServers:{[value.name||'new-server']:{type:'http',url:value.url,...(value.headers.length?{headers}:{}),enabled:value.enabled,startup_timeout_sec:value.connectTimeoutMs/1000,tool_timeout_sec:value.toolTimeoutMs/1000}}},null,2);
 }
 const env:Record<string,string>=Object.create(null);
 for(const item of draft.env){
  if(Object.hasOwn(env,item.name))fail('环境项名称重复，请先在表单中合并，再切换 JSON。');
  if(item.source==='keychain')fail('这项服务含安全值，请继续使用表单；JSON 不回读或导出安全值。');
  if(item.source==='literal'&&(dynamic(item.value)||credential.test(item.name)))fail('这项服务含无法无损转为通用 JSON 的普通值，请继续使用表单。');
  env[item.name]=item.source==='environment'?`\${${item.value}}`:item.value;
 }
 return JSON.stringify({mcpServers:{[draft.name||'new-server']:{type:'stdio',command:draft.command,args:draft.args,...(draft.cwd?{cwd:draft.cwd}:{}),...(draft.env.length?{env}:{}),enabled:draft.enabled,startup_timeout_sec:draft.connectTimeoutMs/1000,tool_timeout_sec:draft.toolTimeoutMs/1000}}},null,2);
}
