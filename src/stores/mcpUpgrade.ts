import {computed,ref} from 'vue';
import {defineStore} from 'pinia';
import {invoke} from '@tauri-apps/api/core';

export interface McpStorageStatus {root:string;workspaceId:string;version:number;targetVersion:number;confirmationToken:string|null}
type Backend=(command:string,args?:Record<string,unknown>)=>Promise<unknown>;
const knownRejections=new Set(['RUNTIME_BUSY','MCP_UPGRADE_CONFIRMATION','MCP_UPGRADE_STALE','MCP_SCHEMA_UNSUPPORTED','SCHEMA_TOO_NEW','MCP_DATABASE_CHANGED','MCP_PATH_CHANGED','SETUP_REQUIRED','MCP_BACKUP_FAILED']);
const reopen='升级结果未确认，请关闭并重开应用核对；不要重复提交或覆盖当前数据库。';
const code=(e:unknown)=>e&&typeof e==='object'&&'code' in e?String(e.code):'';
function validStatus(value:unknown):value is McpStorageStatus {
 if(!value||typeof value!=='object')return false;
 const s=value as McpStorageStatus;
 return typeof s.root==='string'&&!!s.root&&/^[a-f0-9]{64}$/.test(s.workspaceId)&&Number.isInteger(s.version)&&s.version>=1&&s.version<=4&&s.targetVersion===4&&(s.version===4?s.confirmationToken===null:typeof s.confirmationToken==='string'&&/^[a-f0-9]{64}$/.test(s.confirmationToken));
}
export function createMcpUpgrade(api:Backend){
 const status=ref<McpStorageStatus|null>(null),loading=ref(false),busy=ref(false),unknown=ref(false),error=ref(''),backup=ref(''),notice=ref('');
 let sequence=0,unknownWorkspace:string|null=null,hardUnknown=false;
 const enabled=computed(()=>status.value?.version===4&&!loading.value&&!busy.value&&!unknown.value);
 const canConfirm=computed(()=>!!status.value&&status.value.version<4&&!loading.value&&!busy.value&&!unknown.value);
 async function load(){
  if(busy.value)return;
  const request=++sequence;loading.value=true;error.value='';
  try{
   const next=await api('read_mcp_storage_status');if(request!==sequence)return;
   if(!validStatus(next))throw Error('Invalid storage status');
   if(unknown.value){
    if(!hardUnknown&&next.workspaceId===unknownWorkspace&&next.version===4){unknown.value=false;unknownWorkspace=null;backup.value='';notice.value='已重新读取确认诊断存储开启；没有自动连接服务。';}
    else {error.value=reopen;return;}
   }
   if(status.value?.workspaceId!==next.workspaceId||next.version<4)backup.value='';
   status.value=next;
  }catch(e){if(request===sequence){status.value=null;error.value=code(e)==='MCP_MIGRATION_UNCERTAIN'?reopen:'无法确认诊断存储状态，请重新读取；仍失败时关闭并重开应用核对。';if(code(e)==='MCP_MIGRATION_UNCERTAIN'){unknown.value=true;hardUnknown=true;}}throw e;}
  finally{if(request===sequence)loading.value=false;}
 }
 async function confirm(consent:boolean){
  if(!consent||!canConfirm.value)throw Error('请先核对工作目录并明确确认。');
  const before=status.value!,request=++sequence;busy.value=true;loading.value=false;error.value='';notice.value='';backup.value='';
  try{
   const result=await api('confirm_mcp_storage_upgrade',{input:{confirmed:true,confirmationToken:before.confirmationToken}}) as {fromVersion:number;toVersion:number;backup:string};
   if(request!==sequence)return;
   if(!result||result.fromVersion!==before.version||result.toVersion!==4||typeof result.backup!=='string'||!/^backups\/before-schema-4-\d+-\d+\.sqlite$/.test(result.backup))throw Error('Invalid upgrade receipt');
   status.value={...before,version:4,confirmationToken:null};backup.value=result.backup;notice.value='诊断存储已开启，备份已确认；不会自动连接服务。';
  }catch(e){if(request===sequence){if(knownRejections.has(code(e))){status.value=null;error.value=code(e)==='MCP_BACKUP_FAILED'?'备份未确认，未执行升级。遗留文件不能当作有效备份，请重新读取后再确认。':code(e)==='RUNTIME_BUSY'?'当前仍有任务或进程清理，请结束后重新读取并确认。':'预检或确认未通过，未执行升级；请重新读取当前工作目录后核对。';}else{unknown.value=true;unknownWorkspace=before.workspaceId;hardUnknown=code(e)==='MCP_MIGRATION_UNCERTAIN';error.value=reopen;}}throw e;}
  finally{if(request===sequence)busy.value=false;}
 }
 return {status,loading,busy,unknown,error,backup,notice,enabled,canConfirm,load,confirm};
}
export const useMcpUpgrade=defineStore('mcp-upgrade',()=>createMcpUpgrade(invoke));
