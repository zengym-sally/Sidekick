import assert from 'node:assert/strict';
import test from 'node:test';
import {createServer} from 'node:http';
import {spawn,execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync,realpathSync,readFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {once} from 'node:events';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {advisorSample,advisorAnswer} from '../fixtures/advisor-trial.mjs';
const input={runId:'s31-trial',kind:'trial',anchorAtMs:1793239200000,source:{rawText:'我下周五整理清单。',timeZone:'Asia/Shanghai'},snapshot:{provider:{id:'p',network:{timeoutMs:1500,retry:{maxRetries:0}}},model:{id:'logical',apiModelId:'override-wire',capabilities:{toolCall:true}},agent:{agentId:'organizer',revision:'saved',preferences:{detail:'concise',focus:'followups'},supplementalInstructions:'保留核对依据。'}},apiKey:'synthetic-s31'};
const trackerFacts={version:1,todos:[{id:'sample-action',version:1,title:'整理接入清单',kind:'action',owner:'我',status:'open',submission:'尚未提交',acceptance:'尚未验收'},{id:'sample-followup',version:1,title:'修复SDK鉴权',kind:'followup',owner:'林川',status:'open',submission:'尚未提交',acceptance:'尚未验收'}]};
async function g1Owner(t) {
 const directory=mkdtempSync(join(tmpdir(),'sidekick-g1-runtime-')),record=join(directory,'model.jsonl'),nonce=randomBytes(24).toString('hex'),script=realpathSync(resolve('tests/fixtures/mcp-trial.mjs'));
 const child=spawn(resolve('build/s0-runtime/node'),[script,'model',record,'g1',join(directory,'marker'),nonce],{env:{PATH:'/usr/bin:/bin'},stdio:['ignore','pipe','pipe']});
 t.after(async()=>{if(child.exitCode===null&&child.signalCode===null){const done=once(child,'exit');child.kill('SIGTERM');await done;}rmSync(directory,{recursive:true,force:true});});
 let output='',stderr='';child.stdout.on('data',bytes=>output+=bytes);child.stderr.on('data',bytes=>stderr+=bytes);
 const deadline=Date.now()+5000;while(!output.includes('\n')){assert.equal(child.exitCode,null,stderr);assert.ok(Date.now()<deadline);await new Promise(done=>setTimeout(done,10));}
 const url=output.trim().split('\n')[0],pin={pid:child.pid,port:Number(new URL(url).port),nonce,script,command:execFileSync('/bin/ps',['-p',String(child.pid),'-o','uid=,lstart=,command='],{encoding:'utf8',env:{PATH:'/usr/bin:/bin'}}).trim()};
 const count=()=>{try{return readFileSync(record,'utf8').trim().split('\n').filter(Boolean).map(line=>JSON.parse(line)).filter(row=>row.type==='g1-http').length;}catch(error){if(error.code==='ENOENT')return 0;throw error;}};
 return {url,pin,count};
}
function g1Tracker(url,id) {
 const request=structuredClone(input);request.runId=id;request.snapshot.provider.baseUrl=url;request.snapshot.agent.agentId='tracker';request.snapshot.agent.supplementalInstructions='S36_CASE=ok';request.source.rawText='林川已提交SDK鉴权修复，等待我验收。';request.snapshot.trackerSample=structuredClone(trackerFacts);return request;
}
test('g1 transport uses a paired private owner without adding role request flags',async t=>{
 const owner=await g1Owner(t),request=g1Tracker(owner.url,'g1_private_positive');
 const result=await run(t,request,{args:['--run',request.runId,'--s36-native-g1'],env:{SIDEKICK_S36_NATIVE_MODEL_PIN:JSON.stringify({scope:'controlled-native-g1',owner:owner.pin})}});
 assert.equal(result.code,0,JSON.stringify(result.events));assert.equal(result.errors,'');assert.equal(result.events.at(-1).data.roleResult.kind,'tracker');assert.equal(owner.count(),1);assert.ok(!result.events.some(event=>['worker','mcp_begin','mcp_ready'].includes(event.type)));
 assert.ok(!result.output.includes(owner.pin.nonce));assert.ok(!result.output.includes('SIDEKICK_S36_NATIVE_MODEL_PIN'));
});
test('g1 transport rejects malformed, single-sided and ambiguous controls before any HTTP',async t=>{
 const owner=await g1Owner(t),id='g1_private_negative',args=['--run',id,'--s36-native-g1'],control={scope:'controlled-native-g1',owner:owner.pin},encode=value=>({SIDEKICK_S36_NATIVE_MODEL_PIN:JSON.stringify(value)});
 const edits=[
  {args:[],env:encode(control)},
  {args,env:{}},
  {args,env:{SIDEKICK_S36_NATIVE_MODEL_PIN:''}},
  {args,env:{SIDEKICK_S36_NATIVE_MODEL_PIN:'{'}},
  {args,env:encode({...control,scope:'other'})},
  {args,env:encode({...control,extra:true})},
  {args,env:encode({...control,owner:{...owner.pin,extra:true}})},
  {args,env:encode({...control,owner:{}})},
  {args,env:{SIDEKICK_S36_NATIVE_MODEL_PIN:'x'.repeat(16385)}},
  {args:['--run','different','--s36-native-g1'],env:encode(control)},
  {args:[...args,'--s36-native-g1'],env:encode(control)},
  ...[false,null,{}].map(value=>({args,env:encode(control),edit:request=>request.verificationNativeModel=value})),
 ];
 for(const options of edits){const request=g1Tracker(owner.url,id);options.edit?.(request);const result=await run(t,request,options);assert.equal(result.code,1);assert.equal(result.events.at(-1).code,'RUNTIME_PROTOCOL');assert.equal(result.errors,'');assert.equal(owner.count(),0);assert.ok(!result.events.some(event=>['worker','result','mcp_begin','mcp_ready'].includes(event.type)));}
});
async function run(t,request,options={}){const cwd=mkdtempSync(join(tmpdir(),'sidekick-s31-fixture-'));t.after(()=>rmSync(cwd,{recursive:true,force:true}));const child=spawn(resolve('build/s0-runtime/node'),[resolve('build/s0-runtime/organizer.mjs'),...(options.args||[])],{env:{PATH:'/usr/bin:/bin',TMPDIR:cwd,...options.env},stdio:['pipe','pipe','pipe']});t.after(()=>{if(child.exitCode===null)child.kill();});let output='',errors='';child.stdout.on('data',c=>output+=c);child.stderr.on('data',c=>errors+=c);const done=new Promise(resolve=>child.on('close',code=>resolve({code,events:output.trim().split('\n').filter(Boolean).map(s=>JSON.parse(s)),output,errors})));child.stdin.write(JSON.stringify({...request,cwd})+'\n');return done;}
test('trial uses the actual role model and preferences with no tools or business sink',async t=>{
 let body;const server=createServer(async(req,res)=>{let raw='';for await(const c of req)raw+=c;body=JSON.parse(raw);res.writeHead(200,{'content-type':'text/event-stream'});const text=JSON.stringify({candidates:[{title:'整理清单',kind:'action',owner:'我',evidence:'我下周五整理清单。',dueExpression:'下周五',followupExpression:null}]});res.end(`data: ${JSON.stringify({choices:[{index:0,delta:{role:'assistant',content:text},finish_reason:null}]})}\n\ndata: ${JSON.stringify({choices:[{index:0,delta:{},finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`);});await new Promise(done=>server.listen(0,'127.0.0.1',done));t.after(()=>{server.closeAllConnections();server.close();});
 const request=structuredClone(input);request.snapshot.provider.baseUrl=`http://127.0.0.1:${server.address().port}/v1`;const result=await run(t,request);assert.equal(result.code,0);assert.equal(body.model,'override-wire');assert.ok(!body.tools?.length);assert.match(JSON.stringify(body.messages),/DETAIL_LEVEL=concise/);assert.match(JSON.stringify(body.messages),/WORK_FOCUS=followups/);assert.match(JSON.stringify(body.messages),/保留核对依据/);assert.equal(result.events.at(-1).data.candidates.length,1);assert.ok(!result.output.includes('synthetic-s31'));assert.equal(result.errors,'');
});
test('an unavailable role cannot impersonate organizer in an isolated trial',async t=>{const request=structuredClone(input);request.snapshot.agent.agentId='fourth';const result=await run(t,request);assert.equal(result.code,1);assert.equal(result.events.at(-1).code,'RUNTIME_PROTOCOL');assert.ok(!result.events.some(e=>e.type==='result'));});

test('tracker returns associations through its own result branch with no registered tools',async t=>{
 let body;const server=createServer(async(req,res)=>{let raw='';for await(const c of req)raw+=c;body=JSON.parse(raw);res.writeHead(200,{'content-type':'text/event-stream'});const text=JSON.stringify({suggestions:[{todoId:'sample-followup',todoVersion:1,change:'submission',summary:'提交待验收',evidence:'林川已提交SDK鉴权修复'}]});res.end(`data: ${JSON.stringify({choices:[{index:0,delta:{role:'assistant',content:text},finish_reason:null}]})}\n\ndata: ${JSON.stringify({choices:[{index:0,delta:{},finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`);});await new Promise(done=>server.listen(0,'127.0.0.1',done));t.after(()=>{server.closeAllConnections();server.close();});
 const request=structuredClone(input);request.snapshot.provider.baseUrl=`http://127.0.0.1:${server.address().port}/v1`;request.snapshot.agent.agentId='tracker';request.snapshot.agent.preferences.focus='evidence';request.source.rawText='林川已提交SDK鉴权修复，等待我验收。';request.snapshot.trackerSample=structuredClone(trackerFacts);
 const result=await run(t,request);assert.equal(result.code,0);assert.ok(!body.tools?.length);assert.match(JSON.stringify(body.messages),/Sidekick tracker/);assert.equal(result.events.at(-1).data.roleResult.kind,'tracker');assert.equal(result.events.at(-1).data.roleResult.suggestions[0].change,'submission');assert.equal(result.events.at(-1).data.candidates,undefined);assert.equal(result.errors,'');
});

test('tracker rejects forged tool payloads before model requests or worker startup',async t=>{
 let requests=0;const server=createServer((req,res)=>{requests++;req.resume();res.writeHead(500);res.end('{}');});await new Promise(done=>server.listen(0,'127.0.0.1',done));t.after(()=>{server.closeAllConnections();server.close();});
 const edits=[r=>r.kind='extract',r=>r.kind='revise',r=>r.kind='test',r=>r.snapshot.skills=null,r=>r.snapshot.skills={},r=>r.mcp={servers:[{id:'forged'}]},r=>r.mcp={},r=>r.verificationMcpOnly=false,r=>r.verificationOutputDiagnostics=true];
 for(const toolCall of [true,false])for(const edit of edits){const r=structuredClone(input);r.snapshot.provider.baseUrl=`http://127.0.0.1:${server.address().port}/v1`;r.snapshot.agent.agentId='tracker';r.snapshot.model.capabilities.toolCall=toolCall;r.snapshot.trackerSample=structuredClone(trackerFacts);edit(r);const result=await run(t,r);assert.equal(result.code,1);assert.equal(result.events.at(-1).code,'RUNTIME_PROTOCOL');assert.ok(!result.events.some(e=>['result','worker','mcp_begin','mcp_ready'].includes(e.type)));assert.equal(result.errors,'');}
 assert.equal(requests,0);
});

test('tracker validates full fixed facts before networking and keeps a legal positive control',async t=>{
 let requests=0;const server=createServer(async(req,res)=>{requests++;for await(const _ of req){}res.writeHead(200,{'content-type':'text/event-stream'});res.end(`data: ${JSON.stringify({choices:[{index:0,delta:{role:'assistant',content:'{"suggestions":[]}'},finish_reason:null}]})}\n\ndata: ${JSON.stringify({choices:[{index:0,delta:{},finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`);});await new Promise(done=>server.listen(0,'127.0.0.1',done));t.after(()=>{server.closeAllConnections();server.close();});
 const edits=[r=>r.snapshot.trackerSample.todos[0]=null,r=>r.snapshot.trackerSample.todos[0]=[],r=>r.snapshot.trackerSample.todos[0].extra='forged',r=>r.snapshot.trackerSample.extra=true,r=>r.snapshot.trackerSample.todos=r.snapshot.trackerSample.todos.map(({id,version})=>({id,version})),...['title','kind','owner','status','submission','acceptance'].flatMap(key=>[r=>delete r.snapshot.trackerSample.todos[1][key],r=>r.snapshot.trackerSample.todos[1][key]='forged'])];
 for(const toolCall of [true,false]){const base=structuredClone(input);base.snapshot.provider.baseUrl=`http://127.0.0.1:${server.address().port}/v1`;base.snapshot.agent.agentId='tracker';base.snapshot.agent.preferences.focus='evidence';base.snapshot.model.capabilities.toolCall=toolCall;base.snapshot.trackerSample=structuredClone(trackerFacts);base.mcp=null;
  const positive=await run(t,base);assert.equal(positive.code,0);assert.equal(positive.events.at(-1).data.roleResult.kind,'tracker');const before=requests;
  for(const edit of edits){const r=structuredClone(base);edit(r);const result=await run(t,r);assert.equal(result.code,1);assert.equal(result.events.at(-1).code,'RUNTIME_PROTOCOL');assert.ok(!result.events.some(e=>['result','worker','mcp_begin','mcp_ready'].includes(e.type)));assert.equal(result.errors,'');assert.equal(requests,before);}
 }
 assert.equal(requests,2);
});

test('advisor returns its own ranked explanations with a host snapshot identity',async t=>{
 let body;const server=createServer(async(req,res)=>{let raw='';for await(const c of req)raw+=c;body=JSON.parse(raw);const text=JSON.stringify({snapshotId:'s31-trial',date:'2026-11-02',timeZone:'Asia/Shanghai',ranking:[{todoId:'advisor-followup',todoVersion:3,reasons:[{code:'followup_today',relatedTodoId:null,relatedTodoVersion:null}]},{todoId:'advisor-undated',todoVersion:1,reasons:[{code:'undated',relatedTodoId:null,relatedTodoVersion:null}]},{todoId:'advisor-action',todoVersion:2,reasons:[{code:'earlier_due',relatedTodoId:'advisor-followup',relatedTodoVersion:3}]}]});res.writeHead(200,{'content-type':'text/event-stream'});res.end(`data: ${JSON.stringify({choices:[{index:0,delta:{role:'assistant',content:text},finish_reason:null}]})}\n\ndata: ${JSON.stringify({choices:[{index:0,delta:{},finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`);});await new Promise(done=>server.listen(0,'127.0.0.1',done));t.after(()=>{server.closeAllConnections();server.close();});
 const request=structuredClone(input);request.snapshot.provider.baseUrl=`http://127.0.0.1:${server.address().port}/v1`;request.snapshot.agent.agentId='advisor';request.snapshot.agent.preferences.focus='deadline';request.anchorAtMs=1793581200000;request.source.timeZone='Asia/Shanghai';request.snapshot.advisorSample={version:1,snapshotId:'s31-trial',date:'2026-11-02',timeZone:'Asia/Shanghai',anchorAtMs:1793581200000,todos:[{id:'advisor-action',version:2,title:'整理接入清单',kind:'action',owner:'我',status:'open',dueDate:'2026-11-02',followupDate:null},{id:'advisor-followup',version:3,title:'修复SDK鉴权',kind:'followup',owner:'林川',status:'open',dueDate:'2026-11-03',followupDate:'2026-11-02'},{id:'advisor-undated',version:1,title:'确认试用名单',kind:'action',owner:'我',status:'open',dueDate:null,followupDate:null},{id:'advisor-done',version:1,title:'归档合成纪要',kind:'action',owner:'我',status:'done',dueDate:'2026-11-01',followupDate:null}],counts:{total:4,open:3,done:1,dueToday:1,followupToday:1,undated:1}};
 const result=await run(t,request);assert.equal(result.code,0);assert.ok(!body.tools?.length);assert.match(JSON.stringify(body.messages),/Sidekick advisor/);assert.equal(result.events.at(-1).data.roleResult.kind,'advisor');assert.deepEqual(result.events.at(-1).data.roleResult.ranking.map(item=>item.todoId),['advisor-followup','advisor-undated','advisor-action']);assert.equal(result.events.at(-1).data.candidates,undefined);assert.equal(result.errors,'');
});

function advisorRequest(){const r=structuredClone(input);r.snapshot.agent.agentId='advisor';r.snapshot.agent.preferences.focus='deadline';r.snapshot.advisorSample=advisorSample(r.runId);r.anchorAtMs=1793581200000;r.source.timeZone='Asia/Shanghai';r.source.rawText='请给出合成排序与依据。';r.mcp=null;return r;}
async function advisorModel(t,answer){const bodies=[];const server=createServer(async(req,res)=>{let raw='';for await(const c of req)raw+=c;bodies.push(JSON.parse(raw));const text=JSON.stringify(answer);res.writeHead(200,{'content-type':'text/event-stream'});res.end(`data: ${JSON.stringify({choices:[{index:0,delta:{role:'assistant',content:text},finish_reason:null}]})}\n\ndata: ${JSON.stringify({choices:[{index:0,delta:{},finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`);});await new Promise(done=>server.listen(0,'127.0.0.1',done));t.after(()=>{server.closeAllConnections();server.close();});return {bodies,url:`http://127.0.0.1:${server.address().port}/v1`};}
test('advisor keeps multiple model choices and empty advice with both capability declarations',async t=>{
 for(const toolCall of [true,false])for(const alternate of [false,true,'empty']){const answer=advisorAnswer('s31-trial',alternate===true);if(alternate==='empty')answer.ranking=[];const model=await advisorModel(t,answer);const r=advisorRequest();r.snapshot.provider.baseUrl=model.url;r.snapshot.model.capabilities.toolCall=toolCall;const result=await run(t,r);assert.equal(result.code,0);assert.deepEqual(result.events.at(-1).data,{roleResult:{kind:'advisor',version:1,...answer}});assert.equal(model.bodies.length,1);assert.ok(!model.bodies[0].tools?.length);assert.equal(result.errors,'');}
});
test('advisor rejects tools and verification payloads before networking from complete legal facts',async t=>{
 const model=await advisorModel(t,advisorAnswer('s31-trial'));const edits=[r=>r.kind='extract',r=>r.kind='revise',r=>r.kind='test',r=>r.snapshot.skills=null,r=>r.snapshot.skills={},r=>r.mcp={servers:[{id:'forged'}]},r=>r.mcp={},r=>r.mcp={servers:[],extra:true},r=>r.verificationMcpOnly=false,r=>r.verificationOutputDiagnostics=null,r=>r.verificationNativeModel=false,r=>r.verificationNativeModel={}];
 for(const toolCall of [true,false]){const base=advisorRequest();base.snapshot.provider.baseUrl=model.url;base.snapshot.model.capabilities.toolCall=toolCall;const positive=await run(t,base);assert.equal(positive.code,0);const before=model.bodies.length;for(const edit of edits){const r=structuredClone(base);edit(r);const result=await run(t,r);assert.equal(result.code,1);assert.equal(result.events.at(-1).code,'RUNTIME_PROTOCOL');assert.ok(!result.events.some(e=>['result','worker','mcp_begin','mcp_ready'].includes(e.type)));assert.equal(result.errors,'');assert.equal(model.bodies.length,before);}}
 assert.equal(model.bodies.length,2);
});
for(const toolCall of [true,false])test(`advisor validates complete host facts and identity before networking / tools=${toolCall}`,async t=>{
 const model=await advisorModel(t,{...advisorAnswer('s31-trial'),ranking:[]});const base=advisorRequest();base.snapshot.provider.baseUrl=model.url;base.snapshot.model.capabilities.toolCall=toolCall;assert.equal((await run(t,base)).code,0);assert.equal(model.bodies.length,1);
 const edits=[r=>r.snapshot.advisorSample=null,r=>r.snapshot.advisorSample.todos[0]=null,r=>r.snapshot.advisorSample.todos[0]=[],r=>r.snapshot.advisorSample.todos[0].extra=true,r=>r.snapshot.advisorSample.extra=true,r=>r.snapshot.advisorSample.counts.open=0,r=>r.snapshot.advisorSample.snapshotId='another-run',r=>r.snapshot.advisorSample.date='2026-02-30',r=>r.snapshot.advisorSample.timeZone='Invalid/Zone',r=>r.snapshot.advisorSample.anchorAtMs++,r=>r.anchorAtMs++,r=>r.source.timeZone='Invalid/Zone',r=>r.source=null,r=>{r.runId=123;r.snapshot.advisorSample.snapshotId=123;}];
 for(let i=0;i<4;i++)for(const key of Object.keys(base.snapshot.advisorSample.todos[i]))edits.push(r=>{delete r.snapshot.advisorSample.todos[i][key];});
 for(const edit of edits){const r=structuredClone(base);edit(r);const result=await run(t,r);assert.equal(result.code,1);assert.equal(result.events.at(-1).code,'RUNTIME_PROTOCOL');assert.ok(!result.events.some(e=>['result','worker','mcp_begin','mcp_ready'].includes(e.type)));assert.equal(model.bodies.length,1);assert.equal(result.errors,'');}
});
