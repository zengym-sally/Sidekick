import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectMcpJson,formatMcpJson} from '../src/domain/mcpJson.ts';
import {mcpDraft} from '../src/domain/mcp.ts';
import {createMcpSettings} from '../src/stores/mcp.ts';

const sample={type:'stdio',command:'node',args:['one argument','','目录/文件'],env:{REGION:'cn',TOKEN:'${HOST_TOKEN}'},enabled:false,startup_timeout_sec:12,tool_timeout_sec:45};
function parsed(value,name='fallback'){
 const result=inspectMcpJson(typeof value==='string'?value:JSON.stringify(value),name);
 assert.equal(result.error,'');assert.equal(result.entries.length,1);assert.equal(result.entries[0].error,'');return result.entries[0].draft;
}
function rejected(value,pattern){
 const r=inspectMcpJson(typeof value==='string'?value:JSON.stringify(value),'fallback');
 const message=r.error||r.entries[0]?.error;assert.ok(message);if(pattern)assert.match(message,pattern);return message;
}
test('JSON recognizes five client shapes and preserves argument boundaries',()=>{
 for(const value of [sample,{demo:sample},{mcpServers:{demo:sample}},{mcp_servers:{demo:sample}},{servers:{demo:sample}}]){
  const d=parsed(value);assert.deepEqual(d.args,sample.args);assert.equal(d.enabled,false);assert.equal(d.connectTimeoutMs,12000);assert.equal(d.toolTimeoutMs,45000);
  assert.deepEqual(d.env,[{name:'REGION',source:'literal',value:'cn'},{name:'TOKEN',source:'environment',value:'HOST_TOKEN'}]);
 }
});
test('JSON maps Pi seconds, explicit milliseconds and Codex environment references',()=>{
 assert.equal(parsed({command:'node',timeout:50}).toolTimeoutMs,50000);
 assert.equal(parsed({command:'node',timeoutMs:25000}).connectTimeoutMs,25000);
 const d=parsed({command:'node',env_vars:['HOME'],env:{OTHER:'${env:SOURCE}'},connectTimeoutMs:11000,toolTimeoutMs:22000});
 assert.deepEqual(d.env,[{name:'OTHER',source:'environment',value:'SOURCE'},{name:'HOME',source:'environment',value:'HOME'}]);
 assert.equal(d.connectTimeoutMs,11000);assert.equal(d.toolTimeoutMs,22000);
});
test('JSON roundtrips each representable field, empty argument and literal',()=>{
 const d=parsed({mcpServers:{demo:{...sample,cwd:'/tmp/path with space',env:{EMPTY:'',REGION:'cn',TOKEN:'${HOST_TOKEN}'}}}});
 assert.deepEqual(parsed(formatMcpJson(d)),d);
});
test('JSON roundtrips exact integer milliseconds including floating-point decimal boundaries',()=>{
 for(const ms of [1001,1003,1999,10001,29999]){
  const d={...mcpDraft(),name:'demo',command:'node',connectTimeoutMs:ms,toolTimeoutMs:ms};assert.deepEqual(parsed(formatMcpJson(d)),d);
 }
 rejected({command:'node',startup_timeout_sec:1.0001});
});
test('JSON export refuses duplicate unfinished form variables rather than dropping an item',()=>{
 const d={...mcpDraft(),name:'demo',command:'node',env:[{name:'REGION',source:'literal',value:'one'},{name:'REGION',source:'literal',value:'two'}]};assert.throws(()=>formatMcpJson(d));assert.equal(d.env.length,2);
});
test('JSON blocks secret export and ambiguous existing literals without changing the draft',()=>{
 for(const env of [[{name:'TOKEN',source:'keychain',value:''}],[{name:'HOME_TEXT',source:'literal',value:'${HOME}'}],[{name:'TEXT',source:'literal',value:'${HOME}/logs'}],[{name:'TEXT',source:'literal',value:'!command'}],[{name:'API_KEY',source:'literal',value:'synthetic-private'}]]){
  const d={...mcpDraft(),name:'demo',command:'node',env},before=structuredClone(d);assert.throws(()=>formatMcpJson(d));assert.deepEqual(d,before);
 }
});
test('JSON detects remote transports without making them executable or dropping headers',()=>{
 for(const entry of [{type:'http',url:'https://example.invalid/mcp',headers:{Authorization:'synthetic-private'}},{url:'https://example.invalid/mcp'},{type:'streamable-http',url:'https://example.invalid/mcp'},{type:'sse',url:'https://example.invalid/sse'}]){
  const r=inspectMcpJson(JSON.stringify({remote:entry}));assert.equal(r.entries[0].draft,undefined);assert.match(r.entries[0].error,/尚未接入/);assert.equal(JSON.stringify(r).includes('synthetic-private'),false);
 }
});
test('JSON isolates valid and unsupported entries for explicit single selection',()=>{
 const r=inspectMcpJson(JSON.stringify({mcpServers:{local:{command:'node'},remote:{url:'https://example.invalid'}}}));
 assert.equal(r.entries.length,2);assert.ok(r.entries[0].draft);assert.equal(r.entries[1].draft,undefined);
});
test('JSON rejects duplicate keys, ambiguous wrappers and oversized inputs',()=>{
 rejected('{"mcpServers":{"a":{"command":"node","command":"other"}}}',/重复/);
 rejected('{"mcpServers":{"a":{"command":"node","env":{"A":"1","\\u0041":"2"}}}}',/重复/);
 rejected({mcpServers:{a:{command:'node'}},servers:{b:{command:'node'}}});
 rejected({mcpServers:Object.fromEntries(Array.from({length:21},(_,i)=>['s'+i,{command:'node'}]))});
 rejected(' '.repeat(262145),/256/);
});
test('JSON rejects unsupported fields, coercions, partial expansion and command evaluation',()=>{
 for(const entry of [{command:'node',args:'-y pkg'},{command:'node',type:42},{command:'node',enabled:'false'},{command:'node',cwd:'~/tmp'},{command:'node',exposure:'direct'},{type:'stdio',command:'node',url:'https://example.invalid'},{command:'node',timeout:60,tool_timeout_sec:30},{command:'node',timeoutMs:60000},{command:'node',startup_timeout_sec:0}])rejected(entry);
 for(const value of ['${HOME}/logs','${input:token}','{env:TOKEN}','!echo secret'])rejected({command:'node',env:{VALUE:value}},/动态/);
 rejected({command:'node',env:{API_KEY:'synthetic-private'}},/引用/);
 rejected({command:'node',env:{A:'one'},env_vars:['A']});
});
test('JSON syntax errors and validation errors never echo raw secret text',()=>{
 for(const text of ['{"API_KEY":"synthetic-private",',JSON.stringify({command:'node',args:['--token','synthetic-private']}),JSON.stringify({command:'node',env:{TOKEN:'synthetic-private'}})]){
  const r=inspectMcpJson(text);assert.equal(JSON.stringify(r).includes('synthetic-private'),false);assert.ok(r.error||r.entries[0]?.error);
 }
});
test('JSON unknown transport previews contain only a fixed label, never the supplied type',()=>{
 const r=inspectMcpJson(JSON.stringify({safe:{command:'node'},bad:{type:'synthetic-private-type',command:'node'}}));assert.equal(r.entries[1].transport,'未知');assert.equal(JSON.stringify(r).includes('synthetic-private-type'),false);
});

function fixture(){
 let config={version:1,revision:'r1',servers:['a','b'].map(id=>({...mcpDraft(),id,name:id,command:'node'}))},afterWrite=()=>{},counter=1;
 const calls=[];
 const api=async(command,args)=>{
  if(command==='read_mcp_configuration')return structuredClone(config);
  calls.push({command,args:structuredClone(args)});assert.equal(command,'save_mcp_server');
  if(args.input.expectedRevision!==config.revision)throw {code:'MCP_VERSION_CONFLICT'};
  const id=args.input.id||'mcp-new';config={...config,revision:'r'+(++counter),servers:[...config.servers.filter(s=>s.id!==id),{...structuredClone(args.input.server),id}]};
  await afterWrite();return {configuration:structuredClone(config),serverId:id,warning:null};
 };
 return {api,calls,config:()=>config,after:fn=>{afterWrite=fn;}};
}
test('JSON editing and service switches retain independent memory-only drafts without IPC',async()=>{
 const f=fixture(),m=createMcpSettings(f.api);await m.load();m.setMode('json');m.setJsonText('{broken');m.select('b');m.setMode('json');m.setJsonText(JSON.stringify({b:{command:'other'}}));m.select('a');
 assert.equal(m.currentMode.value,'json');assert.equal(m.jsonText.value,'{broken');assert.equal(m.dirty.value,true);assert.equal(f.calls.length,0);
 assert.throws(()=>m.setMode('form'));assert.equal(m.currentMode.value,'json');assert.equal(m.jsonText.value,'{broken');
});
test('JSON saves only the selected entry to the stable current ID and never diagnoses',async()=>{
 const f=fixture(),m=createMcpSettings(f.api);await m.load();m.setMode('json');m.setJsonText(JSON.stringify({mcpServers:{first:{command:'first'},second:{command:'second'}}}));m.selectJsonEntry(1);await m.save();
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].args.input.id,'a');assert.equal(f.config().servers.length,2);assert.equal(m.current.value.name,'second');assert.equal(m.dirty.value,false);
 const reopened=createMcpSettings(f.api);await reopened.load();assert.equal(reopened.find('a').command,'second');assert.equal(reopened.find('b').command,'node');
});
test('JSON invalid or remote input cannot save or mutate the structured draft',async()=>{
 const f=fixture(),m=createMcpSettings(f.api);await m.load();const original=JSON.parse(JSON.stringify(m.current.value));m.setMode('json');m.setJsonText('{broken');await assert.rejects(m.save());assert.deepEqual(m.current.value,original);
 m.setJsonText('{"remote":{"url":"https://example.invalid"}}');await assert.rejects(m.save());assert.equal(f.calls.length,0);assert.deepEqual(m.current.value,original);
});
test('JSON unknown save preserves raw input and reconciles by existing receipt semantics',async()=>{
 const f=fixture(),m=createMcpSettings(f.api);await m.load();m.setMode('json');const text='{"changed": {"command": "node", "args": ["one argument", ""]}}';m.setJsonText(text);f.after(()=>{throw {code:'MCP_SAVE_UNCERTAIN'};});await assert.rejects(m.save());
 assert.equal(m.jsonText.value,text);assert.equal(m.ready.value,false);await m.load();assert.equal(m.dirty.value,false);assert.equal(m.jsonText.value,text);assert.equal(f.calls.length,1);
});
test('JSON late save and readback preserve newer raw edits rather than acknowledging them',async()=>{
 const f=fixture(),m=createMcpSettings(f.api);await m.load();let finish;f.after(()=>new Promise(resolve=>{finish=resolve;}));m.setMode('json');m.setJsonText('{"old":{"command":"node"}}');const saving=m.save();await Promise.resolve();await Promise.resolve();m.setJsonText('{"new":{"command":"other"}}');finish();await saving;
 assert.equal(m.jsonText.value,'{"new":{"command":"other"}}');assert.equal(m.dirty.value,true);await m.load();assert.equal(m.dirty.value,true);m.setMode('form');assert.equal(m.current.value.command,'other');
});
test('JSON mode refuses existing keychain fields',async()=>{
 const f=fixture();f.config().servers[0].env=[{name:'TOKEN',source:'keychain',value:''}];const m=createMcpSettings(f.api);await m.load();assert.throws(()=>m.setMode('json'));assert.equal(m.currentMode.value,'form');assert.equal(f.calls.length,0);
});
test('JSON lost-response readback cannot clear newer invalid raw input',async()=>{
 const f=fixture(),m=createMcpSettings(f.api);await m.load();m.setMode('json');m.setJsonText('{"old":{"command":"node"}}');f.after(()=>{throw {code:'MCP_SAVE_UNCERTAIN'};});await assert.rejects(m.save());m.setJsonText('{new-invalid');await m.load();
 assert.equal(m.jsonText.value,'{new-invalid');assert.equal(m.dirty.value,true);assert.equal(f.calls.length,1);
});
test('JSON conflicts preserve raw drafts and require reread before any retry',async()=>{
 const f=fixture();let writes=0;const m=createMcpSettings(async(c,a)=>{if(c==='save_mcp_server'){writes++;throw {code:'MCP_VERSION_CONFLICT'};}return f.api(c,a);});await m.load();m.setMode('json');m.setJsonText('{"changed":{"command":"other"}}');await assert.rejects(m.save());await assert.rejects(m.save());assert.equal(writes,1);assert.equal(m.ready.value,false);await m.load();assert.equal(m.jsonText.value,'{"changed":{"command":"other"}}');assert.equal(m.dirty.value,true);
});
test('JSON cannot reinterpret an existing literal placeholder on a mode switch',async()=>{
 const f=fixture();f.config().servers[0].env=[{name:'TEXT',source:'literal',value:'${HOME}'}];const m=createMcpSettings(f.api);await m.load();m.current.value.name='edited';assert.throws(()=>m.setMode('json'));assert.equal(m.currentMode.value,'form');assert.equal(m.current.value.env[0].source,'literal');assert.equal(m.current.value.name,'edited');assert.equal(f.calls.length,0);
});
test('JSON duplicate form variables cannot switch modes or issue a write',async()=>{
 const f=fixture(),m=createMcpSettings(f.api);await m.load();m.current.value.env=[{name:'REGION',source:'literal',value:'one'},{name:'REGION',source:'literal',value:'two'}];assert.throws(()=>m.setMode('json'));assert.equal(m.currentMode.value,'form');assert.equal(m.current.value.env.length,2);assert.equal(f.calls.length,0);
});
test('JSON unnamed single entry works from the real fresh-draft path and has a visible editable name',async()=>{
 const f=fixture(),m=createMcpSettings(f.api);await m.load();m.add();m.setMode('json');m.setJsonText('{"command":"node","args":["service.mjs"]}');assert.equal(m.jsonPreview.value.entries[0].draft?.name,'new-server');m.setMode('form');assert.equal(m.current.value.name,'new-server');m.current.value.name='my-service';await m.save();assert.equal(m.find('mcp-new').name,'my-service');assert.equal(f.calls[0].args.input.id,null);
});
test('discarding JSON affects only the current service and equivalent JSON needs no write',async()=>{
 const f=fixture(),m=createMcpSettings(f.api);await m.load();m.setMode('json');m.setJsonText(m.jsonText.value+'\n');await m.save();assert.equal(m.dirty.value,false);assert.equal(f.calls.length,0);
 m.setJsonText('{broken-a');m.select('b');m.setMode('json');m.setJsonText('{broken-b');m.discard();m.select('a');assert.equal(m.jsonText.value,'{broken-a');assert.equal(m.dirty.value,true);
});
