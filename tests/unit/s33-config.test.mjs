import test from 'node:test';
import assert from 'node:assert/strict';
import {createMcpSettings} from '../../src/stores/mcp.ts';

const clone=value=>structuredClone(value);
const server=(id,name=id)=>({id,name,transport:'stdio',enabled:true,command:'/synthetic/not-executed',args:['one argument',''],cwd:null,env:[],connectTimeoutMs:10000,toolTimeoutMs:30000});
function backend(initial=[]){
 let configuration={version:1,revision:initial.length?'r1':'',servers:initial},revision=1;const calls=[];
 const api=async(command,args)=>{
  calls.push({command,args:clone(args)});
  if(command==='read_mcp_configuration')return clone(configuration);
  const input=args.input;
  if(input.expectedRevision!==configuration.revision)throw {code:'MCP_VERSION_CONFLICT',message:'合成冲突'};
  if(command==='save_mcp_server'){
   const id=input.id||`mcp-${++revision}`,value={...clone(input.server),id};
   configuration={version:1,revision:`r${++revision}`,servers:[...configuration.servers.filter(s=>s.id!==id),value]};
   return {configuration:clone(configuration),serverId:id,warning:null};
  }
  if(command==='remove_mcp_server'){
   configuration={...configuration,revision:`r${++revision}`,servers:configuration.servers.filter(s=>s.id!==input.id)};
   return {configuration:clone(configuration),serverId:null,warning:null};
  }
  throw Error(command);
 };
 return {api,calls,configuration:()=>clone(configuration)};
}

test('MCP configuration creates, renames, disables, removes and reopens without execution',async()=>{
 const host=backend(),model=createMcpSettings(host.api);await model.load();model.add();model.current.value.name='本机合成服务';model.current.value.command='/synthetic/not-executed';model.current.value.args=['space remains one argument',''];
 await model.save();const id=model.selected.value;assert.ok(id.startsWith('mcp-'));assert.equal(model.dirty.value,false);
 model.current.value.name='改名';model.current.value.enabled=false;await model.save();assert.equal(model.selected.value,id);
 const reopened=createMcpSettings(host.api);await reopened.load();assert.equal(reopened.current.value.name,'改名');assert.equal(reopened.current.value.enabled,false);assert.deepEqual(reopened.current.value.args,['space remains one argument','']);
 await reopened.remove();assert.equal(host.configuration().servers.length,0);
 assert.deepEqual([...new Set(host.calls.map(c=>c.command))].sort(),['read_mcp_configuration','remove_mcp_server','save_mcp_server']);
});
test('MCP drafts survive switching services, reread and saving another service',async()=>{
 const host=backend([server('a'),server('b')]),model=createMcpSettings(host.api);await model.load();model.current.value.name='A草稿';model.select('b');model.current.value.name='B已保存';await model.save();model.select('a');assert.equal(model.current.value.name,'A草稿');await model.load();assert.equal(model.current.value.name,'A草稿');assert.equal(model.dirty.value,true);model.discard();assert.equal(model.current.value.name,'a');
});
test('MCP late reads do not replace newer reads or edits made while reading',async()=>{
 let resolveFirst,resolveSecond;let calls=0;const model=createMcpSettings(()=>new Promise(resolve=>{if(++calls===1)resolveFirst=resolve;else resolveSecond=resolve;}));
 const first=model.load(),second=model.load();resolveSecond({version:1,revision:'new',servers:[server('a','新版')]});await second;model.current.value.name='编辑中';resolveFirst({version:1,revision:'old',servers:[server('a','旧版')]});await first;assert.equal(model.configuration.value.revision,'new');assert.equal(model.current.value.name,'编辑中');
});
test('MCP unknown save and conflict keep drafts and block writes until reread',async()=>{
 for(const code of ['MCP_SAVE_UNCERTAIN','MCP_VERSION_CONFLICT']){
  let writes=0;const host=backend([server('a')]),model=createMcpSettings(async(command,args)=>{if(command==='read_mcp_configuration')return host.api(command,args);writes++;throw {code,message:'请读回'};});
  await model.load();model.current.value.name='保留草稿';await assert.rejects(model.save());assert.equal(model.ready.value,false);await assert.rejects(model.save());assert.equal(writes,1);await model.load();assert.equal(model.current.value.name,'保留草稿');assert.equal(model.ready.value,true);
 }
});
test('MCP response loss is reconciled by reread without duplicating a new server',async()=>{
 const host=backend();let lose=true;const model=createMcpSettings(async(command,args)=>{const result=await host.api(command,args);if(command==='save_mcp_server'&&lose){lose=false;throw {code:'MCP_SAVE_UNCERTAIN',message:'合成响应丢失'};}return result;});
 await model.load();model.add();model.current.value.name='新服务';model.current.value.command='/synthetic/not-executed';await assert.rejects(model.save());assert.equal(model.ready.value,false);await model.load();assert.equal(model.dirty.value,false);assert.equal(model.configuration.value.servers.length,1);assert.ok(model.selected.value.startsWith('mcp-'));await assert.rejects(model.save());assert.equal(host.configuration().servers.length,1);
});
test('MCP readback after an uncertain edit preserves a newer draft',async()=>{
 const host=backend([server('a')]);let rejectSave;const model=createMcpSettings(async(command,args)=>{if(command==='save_mcp_server'){await host.api(command,args);return new Promise((_resolve,reject)=>{rejectSave=reject;});}return host.api(command,args);});
 await model.load();model.current.value.name='正在保存';const saved=model.save();await Promise.resolve();await Promise.resolve();model.current.value.name='更新草稿';rejectSave({code:'MCP_SAVE_UNCERTAIN',message:'合成响应丢失'});await assert.rejects(saved);await model.load();assert.equal(model.current.value.name,'更新草稿');assert.equal(model.dirty.value,true);
});
test('MCP removal response loss rereads history state without removing another service',async()=>{
 const host=backend([server('a'),server('b')]);const model=createMcpSettings(async(command,args)=>{const result=await host.api(command,args);if(command==='remove_mcp_server')throw {code:'MCP_SAVE_UNCERTAIN',message:'合成响应丢失'};return result;});
 await model.load();await assert.rejects(model.remove());await model.load();assert.deepEqual(model.configuration.value.servers.map(s=>s.id),['b']);assert.equal(model.selected.value,'b');
});
test('MCP failed read cannot fabricate an empty ready configuration',async()=>{
 const model=createMcpSettings(async()=>{throw {code:'MCP_CONFIG_INVALID',message:'配置损坏'};});await assert.rejects(model.load());assert.equal(model.ready.value,false);assert.equal(model.configuration.value,null);assert.throws(()=>model.add());
});
test('MCP discarding an uncertain draft does not skip the required reread',async()=>{
 const host=backend(),model=createMcpSettings(async(command,args)=>{const result=await host.api(command,args);if(command==='save_mcp_server')throw {code:'MCP_SAVE_UNCERTAIN',message:'合成响应丢失'};return result;});
 await model.load();model.add();model.current.value.name='已保存但未确认';model.current.value.command='/synthetic/not-executed';await assert.rejects(model.save());model.discard();assert.equal(model.ready.value,false);assert.throws(()=>model.add());await model.load();assert.equal(model.configuration.value.servers.length,1);assert.equal(model.ready.value,true);
});
