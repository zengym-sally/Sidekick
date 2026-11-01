import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline';
import { controlledHttp } from '../fixtures/mcp-http.mjs';

const binary=resolve('src-tauri/target/debug/examples/s33-mcp-host'),assets=resolve('build/s0-runtime');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function host(t,app,nonce,reopen=false){
 const child=spawn(binary,[app,nonce,assets,...(reopen?['--reopen']:[])],{env:{PATH:'/usr/bin:/bin',TMPDIR:'/tmp',TEST_MCP_REF:'synthetic-private-marker-271828',SYNTHETIC_MODEL_KEY:'must-not-inherit'},stdio:['pipe','pipe','pipe']});
 const lines=[],queue=[];let stderr='';child.stdin.on('error',()=>{});child.stderr.on('data',c=>{stderr+=c;});
 createInterface({input:child.stdout}).on('line',line=>{const value=JSON.parse(line),next=queue.shift();if(next)next(value);else lines.push(value);});
 const receive=()=>lines.length?Promise.resolve(lines.shift()):Promise.race([new Promise(r=>queue.push(r)),new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('controlled host timeout')),10000);timer.unref();})]);
 const stop=async()=>{if(child.exitCode!==null||child.signalCode!==null)return;child.stdin.end();await new Promise(r=>child.once('exit',r));};t.after(stop);
 const ready=await receive();assert.equal(ready.ready,true,stderr);
 return{child,root:ready.root,stop,request:async value=>{child.stdin.write(JSON.stringify(value)+'\n');return receive();}};
}
async function fixture(t,mode='json',options={}){
 const service=await controlledHttp({mode,...options});t.after(()=>service.close());
 const base=await mkdtemp('/tmp/sidekick-http-host-'),app=join(base,'app'),nonce=randomBytes(24).toString('hex'),h=await host(t,app,nonce);
 const configuration=(await h.request({op:'config'})).ok;
 const server={name:'合成HTTP诊断',transport:'http',enabled:false,url:service.url,headers:options.references||[],connectTimeoutMs:1000,toolTimeoutMs:1000};
 const saved=await h.request({op:'save',input:{expectedRevision:configuration.revision,server}});assert.ok(saved.ok,JSON.stringify(saved));
 return{service,base,app,nonce,h,id:saved.ok.serverId,revision:saved.ok.configuration.revision};
}
async function finish(f,id){
 for(let i=0;i<300;i++){const result=await f.h.request({op:'read',id});assert.ok(result.ok,JSON.stringify(result));if(result.ok.status!=='running')return result.ok;await pause(20);}throw Error('controlled diagnostic did not finish');
}
function counts(root){return JSON.parse(execFileSync('python3',['-c',"import sqlite3,json,sys; c=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True); print(json.dumps({t:c.execute('select count(*) from '+t).fetchone()[0] for t in ['sources','candidates','todos','todo_events','tool_calls']}))",join(root,'data/sidekick.sqlite')],{encoding:'utf8'}));}
for(const mode of ['json','sse-all'])test(`actual Rust/Pi HTTP ${mode} discovers without tool calls and reopens its catalog`,async t=>{
 const f=await fixture(t,mode),before=counts(f.h.root);const start=await f.h.request({op:'start',server:f.id,revision:f.revision});assert.ok(start.ok,JSON.stringify(start));
 const result=await finish(f,start.ok.id);assert.equal(result.status,'succeeded',JSON.stringify(result));assert.equal(result.snapshot.transport,'http');assert.equal(result.result.remoteClose,'confirmed');
 const catalog=await f.h.request({op:'catalog',id:result.id});assert.deepEqual(catalog.ok.tools.map(t=>t.name),['lookup']);assert.equal(f.service.calls(),0);assert.deepEqual(counts(f.h.root),before);
 assert.equal((await f.h.request({op:'status'})).ok.process,null);assert.equal((await readFile(join(f.app,'signal-audit.jsonl'),'utf8')).trim(),'');
 if(mode==='sse-all')assert.ok(f.service.requests.filter(r=>r.message?.id!==undefined).every(r=>r.responseType==='text/event-stream'));
 await f.h.stop();const reopened=await host(t,f.app,f.nonce,true);assert.deepEqual((await reopened.request({op:'catalog',id:result.id})).ok,catalog.ok);
});
test('HTTP host resolves only the declared synthetic header and never publishes its value',async t=>{
 const value='synthetic-private-marker-271828',f=await fixture(t,'json',{headers:{'X-Auth':value},references:[{name:'X-Auth',source:'environment',value:'TEST_MCP_REF'}]});
 const start=await f.h.request({op:'start',server:f.id,revision:f.revision});assert.ok(start.ok,JSON.stringify(start));const result=await finish(f,start.ok.id);assert.equal(result.status,'succeeded',JSON.stringify(result));
 assert.ok(f.service.requests.every(r=>r.headers['x-auth']===value&&!r.headers['synthetic-model-key']));assert.equal(JSON.stringify(result).includes(value),false);assert.equal((await readFile(join(f.app,'workspace/mcp/servers.json'),'utf8')).includes(value),false);assert.equal(f.service.calls(),0);
});
test('missing HTTP host reference fails before every network request',async t=>{
 const f=await fixture(t,'json',{references:[{name:'X-Auth',source:'environment',value:'SIDEKICK_HTTP_SYNTH_ABSENT'}]});const start=await f.h.request({op:'start',server:f.id,revision:f.revision});assert.ok(start.ok,JSON.stringify(start));const result=await finish(f,start.ok.id);
 assert.equal(result.status,'failed');assert.equal(result.errorCode,'MCP_ENV_MISSING');assert.equal(f.service.requests.length,0);assert.equal((await f.h.request({op:'status'})).ok.process,null);
});
test('HTTP 401 is a bounded diagnostic failure with no catalog and no auth retry',async t=>{
 const f=await fixture(t,'auth'),start=await f.h.request({op:'start',server:f.id,revision:f.revision});assert.ok(start.ok,JSON.stringify(start));const result=await finish(f,start.ok.id);
 assert.equal(result.status,'failed');assert.equal(result.errorCode,'MCP_HTTP_AUTH');assert.equal((await f.h.request({op:'catalog',id:result.id})).ok,null);assert.equal(f.service.requests.filter(r=>r.method==='POST').length,1);assert.equal(f.service.calls(),0);
});
for(const [mode,close]of[['delete-unsupported','unsupported'],['delete-error','unconfirmed']])test(`HTTP diagnostic ${mode} records local close separately`,async t=>{
 const f=await fixture(t,mode),start=await f.h.request({op:'start',server:f.id,revision:f.revision});assert.ok(start.ok,JSON.stringify(start));const result=await finish(f,start.ok.id);
 assert.equal(result.status,'succeeded',JSON.stringify(result));assert.equal(result.result.remoteClose,close);assert.equal((await f.h.request({op:'status'})).ok.active,null);assert.equal(f.service.calls(),0);
});
test('HTTP cancellation closes a real GET/POST without a stdio owner',async t=>{
 const f=await fixture(t,'wait-list'),start=await f.h.request({op:'start',server:f.id,revision:f.revision});assert.ok(start.ok,JSON.stringify(start));
 for(let i=0;i<100&&!f.service.requests.some(r=>r.method==='GET');i++)await pause(5);assert.ok(f.service.requests.some(r=>r.method==='GET'));
 const status=(await f.h.request({op:'status'})).ok;assert.equal(status.process.owner,null);assert.equal(status.process.intent,null);assert.ok(status.process.pid>1);
 await f.h.request({op:'cancel',id:start.ok.id});const result=await finish(f,start.ok.id);assert.equal(result.status,'cancelled');assert.equal(f.service.calls(),0);assert.equal((await f.h.request({op:'status'})).ok.process,null);
});
for(const [closeDelay,expected] of [[800,'confirmed'],[null,'unconfirmed']])test(`HTTP cancellation preserves close state with DELETE delay ${closeDelay}`,async t=>{
 const f=await fixture(t,'wait-list',{closeDelay}),start=await f.h.request({op:'start',server:f.id,revision:f.revision});assert.ok(start.ok,JSON.stringify(start));
 for(let i=0;i<100&&!f.service.requests.some(r=>r.method==='GET');i++)await pause(5);assert.ok(f.service.requests.some(r=>r.method==='GET'));
 await f.h.request({op:'cancel',id:start.ok.id});const result=await finish(f,start.ok.id);assert.equal(result.status,'cancelled');
 assert.equal(result.result?.remoteClose,expected,JSON.stringify(result));assert.equal(f.service.requests.filter(r=>r.method==='DELETE').length,1);assert.equal(f.service.calls(),0);assert.equal((await f.h.request({op:'status'})).ok.process,null);
});
test('HTTP catalog publish failure retains the known remote close state',async t=>{
 const f=await fixture(t,'delete-error',{listDelay:400}),start=await f.h.request({op:'start',server:f.id,revision:f.revision});assert.ok(start.ok,JSON.stringify(start));
 const artifact=join(f.h.root,'runs',start.ok.id,'mcp-catalog.json');await writeFile(artifact,'synthetic exclusive collision',{mode:0o600,flag:'wx'});
 const result=await finish(f,start.ok.id);assert.equal(result.status,'failed');assert.equal(result.result?.remoteClose,'unconfirmed',JSON.stringify(result));
 assert.equal(await readFile(artifact,'utf8'),'synthetic exclusive collision');assert.equal((await f.h.request({op:'catalog',id:result.id})).ok,null);assert.equal(f.service.calls(),0);
});
