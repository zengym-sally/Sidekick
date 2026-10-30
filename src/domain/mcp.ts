export interface McpEnvironment {name:string;source:'literal'|'environment'|'keychain';value:string}
export interface McpServerDraft {name:string;transport:'stdio';enabled:boolean;command:string;args:string[];cwd:string|null;env:McpEnvironment[];connectTimeoutMs:number;toolTimeoutMs:number}
export interface McpServer extends McpServerDraft {id:string;lastSecretOperation?:string|null}
export interface McpConfiguration {version:1;revision:string;servers:McpServer[];secureStorageAvailable?:boolean;credentialStatus?:Record<string,Record<string,string>>;warning?:string|null}
export interface McpConfigSave {configuration:McpConfiguration;serverId:string|null;warning:string|null}
export const mcpClone=<T>(value:T):T=>JSON.parse(JSON.stringify(value));
export function mcpDraft(server?:McpServer):McpServerDraft {
 if(!server)return {name:'',transport:'stdio',enabled:true,command:'',args:[],cwd:null,env:[],connectTimeoutMs:10000,toolTimeoutMs:30000};
 const {id:_,lastSecretOperation:_operation,...settings}=server;return mcpClone(settings);
}
export function normalizedMcp(draft:McpServerDraft):McpServerDraft {
 const value=mcpClone(draft);value.name=value.name.trim();value.command=value.command.trim();if(!value.cwd?.trim())value.cwd=null;return value;
}
