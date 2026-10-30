import test from 'node:test';
import assert from 'node:assert/strict';
import {createMcpSettings} from '../src/stores/mcp.ts';

const clone=v=>JSON.parse(JSON.stringify(v));
const entry=(id='a')=>({id,name:'合成服务',transport:'stdio',enabled:true,command:'/synthetic/not-executed',args:[],cwd:null,env:[{name:'TOKEN',source:'keychain',value:''}],connectTimeoutMs:10000,toolTimeoutMs:30000});
function fixture(){
 let config={version:1,revision:'r1',servers:[entry()],secureStorageAvailable:true,credentialStatus:{a:{TOKEN:'stored'}}},counter=1;
 let lose=false,commit=true,complete;
 const calls=[];
 const api=async(command,args)=>{
  if(command==='read_mcp_configuration')return clone(config);
  calls.push({command,args:clone(args)});
  if(command!=='save_mcp_secrets')throw Error('Unexpected command');
  const {edit,operationId}=args.input;
  if(commit)config={...config,revision:'r'+(++counter),servers:[{...clone(edit.server),id:'a',lastSecretOperation:operationId}]};
  if(lose)throw {code:'MCP_SAVE_UNCERTAIN',message:'合成响应丢失'};
  if(complete)return new Promise(resolve=>{complete=()=>resolve({configuration:clone(config),serverId:'a',warning:null});});
  return {configuration:clone(config),serverId:'a',warning:null};
 };
 return {api,calls,configuration:()=>config,lose:()=>{lose=true;},noCommit:()=>{commit=false;},delay:()=>{complete=()=>{};},finish:()=>complete()};
}
test('secure input uses a dedicated command and never sends a persisted credential reference',async()=>{
 const f=fixture(),m=createMcpSettings(f.api);await m.load();m.setSecret('TOKEN','synthetic-private-value-A');assert.equal(m.dirty.value,true);await m.save();
 assert.equal(f.calls[0].command,'save_mcp_secrets');assert.equal(f.calls[0].args.input.edit.server.env[0].value,'');assert.equal(f.calls[0].args.input.values.TOKEN,'synthetic-private-value-A');assert.match(f.calls[0].args.input.operationId,/^op-/);assert.equal(m.secretDrafts.a?.TOKEN,undefined);assert.equal(m.dirty.value,false);
});
test('secret response loss requires the exact durable operation receipt rather than matching empty fields',async()=>{
 const f=fixture(),m=createMcpSettings(f.api);await m.load();m.setSecret('TOKEN','synthetic-private-value-B');f.lose();f.noCommit();await assert.rejects(m.save());await m.load();assert.equal(m.secretDrafts.a.TOKEN,'synthetic-private-value-B');assert.equal(m.dirty.value,true);assert.equal(f.calls.length,1);
});
test('a committed secret response loss clears only the confirmed input after reread',async()=>{
 const f=fixture(),m=createMcpSettings(f.api);await m.load();m.setSecret('TOKEN','synthetic-private-value-C');f.lose();await assert.rejects(m.save());assert.equal(m.ready.value,false);await m.load();assert.equal(m.secretDrafts.a?.TOKEN,undefined);assert.equal(m.dirty.value,false);assert.equal(f.calls.length,1);
});
test('a late secret save does not clear newer secret or ordinary drafts',async()=>{
 const f=fixture(),m=createMcpSettings(f.api);await m.load();m.setSecret('TOKEN','synthetic-old-input');f.delay();const pending=m.save();await Promise.resolve();m.setSecret('TOKEN','synthetic-new-input');m.current.value.name='较新草稿';f.finish();await pending;assert.equal(m.secretDrafts.a.TOKEN,'synthetic-new-input');assert.equal(m.current.value.name,'较新草稿');assert.equal(m.dirty.value,true);
});
test('the default unavailable backend blocks secure submissions without issuing a write',async()=>{
 const f=fixture(),m=createMcpSettings(async(c,a)=>{if(c==='read_mcp_configuration')return {...clone(f.configuration()),secureStorageAvailable:false};return f.api(c,a);});await m.load();m.setSecret('TOKEN','synthetic-blocked-input');await assert.rejects(m.save());assert.equal(f.calls.length,0);
});
test('a foreign secret operation on reread cannot acknowledge the pending input',async()=>{
 const f=fixture(),m=createMcpSettings(f.api);await m.load();m.setSecret('TOKEN','synthetic-unconfirmed-input');f.lose();await assert.rejects(m.save());f.configuration().servers[0].lastSecretOperation='op-foreign';await assert.rejects(m.load());assert.equal(m.ready.value,false);assert.equal(m.secretDrafts.a.TOKEN,'synthetic-unconfirmed-input');
});

test('legal __proto__ secret names are submitted and confirmed for existing and new services',async()=>{
 for(const fresh of [false,true]){
  const f=fixture();f.configuration().servers[0].env[0].name='__proto__';
  if(fresh)f.configuration().servers=[];
  const m=createMcpSettings(f.api);await m.load();
  if(fresh){m.add();Object.assign(m.current.value,entry());delete m.current.value.id;m.current.value.env[0].name='__proto__';}
  const key=m.selected.value;m.setSecret('__proto__','synthetic-prototype-safe');
  assert.equal(m.dirty.value,true);await m.save();
  assert.equal(f.calls[0].command,'save_mcp_secrets');assert.equal(Object.hasOwn(f.calls[0].args.input.values,'__proto__'),true);
  assert.equal(f.calls[0].args.input.values.__proto__,'synthetic-prototype-safe');
  assert.equal(Object.hasOwn(m.secretDrafts[key]||{},'__proto__'),false);assert.equal(m.dirty.value,false);
 }
});
