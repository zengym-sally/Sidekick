import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { resolve,join } from 'node:path';
import { mkdtempSync,rmSync,statSync,readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
const sample={candidates:[{title:'整理清单',kind:'action',owner:'我',priority:'medium',tags:[],evidence:'我下周五整理清单。',dueExpression:'下周五',followupExpression:null}]};
function stream(response,text){response.writeHead(200,{'content-type':'text/event-stream'});response.end(`data: ${JSON.stringify({id:'fixture',object:'chat.completion.chunk',choices:[{index:0,delta:{role:'assistant',content:text},finish_reason:null}]})}\n\ndata: ${JSON.stringify({id:'fixture',choices:[{index:0,delta:{},finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`);}
async function server(t,handler){const server=createServer(async(req,res)=>{let text='';for await(const chunk of req)text+=chunk;handler(req,res,JSON.parse(text));});await new Promise(done=>server.listen(0,'127.0.0.1',done));t.after(()=>{server.closeAllConnections();server.close();});return `http://127.0.0.1:${server.address().port}/v1`;}
function request(baseUrl){return {runId:'runtime-fixture',kind:'extract',cwd:process.cwd(),anchorAtMs:Date.parse('2026-10-29T02:00:00Z'),apiKey:'synthetic-credential',snapshot:{provider:{id:'test-provider',baseUrl,network:{timeoutMs:1500,retry:{maxRetries:0}},extraHeaders:{}},model:{id:'logical-id',apiModelId:'wire-deployment',capabilities:{toolCall:false}},profile:{name:'小明同学',address:'BOSS'}},source:{rawText:'我下周五整理清单。',timeZone:'Asia/Shanghai'}};}
function launch(t,input,onProgress){
  input.cwd=mkdtempSync(join(tmpdir(),'sidekick-s2-runtime-'));
  const child=spawn(resolve('build/s0-runtime/node'),[resolve('build/s0-runtime/organizer.mjs')],{env:{PATH:'/usr/bin:/bin',TMPDIR:input.cwd},stdio:['pipe','pipe','pipe']});
  t.after(()=>{child.stdin.destroy();child.kill('SIGKILL');rmSync(input.cwd,{recursive:true,force:true});});const events=[];let output='',errors='';
  child.stderr.on('data',chunk=>errors+=chunk);const lines=createInterface({input:child.stdout});
  lines.on('line',line=>{output+=line;const event=JSON.parse(line);events.push(event);if(event.type==='progress')onProgress?.(child,event);});
  const finished=new Promise((done,reject)=>{child.on('error',reject);child.on('close',code=>{lines.close();done({code,events,output,errors});});});
  finished.child=child;child.stdin.on('error',()=>{});child.stdin.write(`${JSON.stringify(input)}\n`);return finished;
}
test('bundled Pi calls the API model ID and returns validated dated candidates without leaking credentials',async t=>{
  let sent;const url=await server(t,(req,res,body)=>{sent=body;assert.equal(req.headers.authorization,'Bearer synthetic-credential');stream(res,JSON.stringify(sample));});
  const result=await launch(t,request(url));assert.equal(result.code,0);assert.equal(sent.model,'wire-deployment');
  const data=result.events.find(e=>e.type==='result').data;assert.equal(data.candidates[0].fields.due.precision,'day');
  assert.ok(!result.output.includes('synthetic-credential'));assert.equal(result.errors,'');
});
test('Pi persisted truncated tool output stays inside the private run directory with mode 600',async t=>{
  let outputPath;const input=request('');input.snapshot.model.capabilities.toolCall=true;
  const url=await server(t,(_req,res,body)=>{
    const tool=body.messages.findLast(m=>m.role==='tool');
    if(tool){const content=typeof tool.content==='string'?tool.content:JSON.stringify(tool.content);const match=/Full output:\s*([^\]\n]+)/.exec(content);outputPath=match?.[1]?.trim();stream(res,'{"candidates":[]}');return;}
    res.writeHead(200,{'content-type':'text/event-stream'});
    res.end(`data: ${JSON.stringify({id:'tool-fixture',choices:[{index:0,delta:{role:'assistant',tool_calls:[{index:0,id:'bash-fixture',type:'function',function:{name:'bash',arguments:JSON.stringify({command:'for i in {1..4000}; do printf "controlled-line-%s\\n" "$i"; done',timeout:2})}}]},finish_reason:null}]})}\n\ndata: ${JSON.stringify({choices:[{index:0,delta:{},finish_reason:'tool_calls'}]})}\n\ndata: [DONE]\n\n`);
  });input.snapshot.provider.baseUrl=url;const result=await launch(t,input);assert.equal(result.code,0);
  assert.ok(outputPath&&outputPath.startsWith(input.cwd+'/'));assert.equal(statSync(outputPath).mode&0o777,0o600);assert.ok(readFileSync(outputPath,'utf8').includes('controlled-line-'));
});
test('authentication and malformed model results fail with safe categories',async t=>{
  for(const mode of ['auth','invalid']){
    const url=await server(t,(_req,res)=>{if(mode==='auth'){res.writeHead(401,{'content-type':'application/json'});res.end(JSON.stringify({error:{message:'Invalid API key synthetic-credential'}}));}else stream(res,'not-json');});
    const result=await launch(t,request(url));assert.equal(result.code,1);assert.equal(result.events.at(-1).code,mode==='auth'?'MODEL_AUTH':'MODEL_INVALID_OUTPUT');assert.ok(!result.output.includes('synthetic-credential'));assert.ok(!result.errors.includes('synthetic-credential'));
  }
});
test('transient failures retry the current model request within the configured bound',async t=>{
  let calls=0;const url=await server(t,(_req,res)=>{calls++;if(calls===1){res.writeHead(503,{'content-type':'application/json'});res.end('{"error":{"message":"temporary"}}');}else stream(res,JSON.stringify({candidates:[]}));});
  const input=request(url);input.snapshot.provider.network.retry.maxRetries=1;const result=await launch(t,input);assert.equal(result.code,0);assert.equal(calls,2);assert.deepEqual(result.events.at(-1).data,{candidates:[]});
});
for(const mode of ['cancel','eof','deadline'])test(`in-flight model ${mode} stops without candidates`,async t=>{
  let received=false,action=()=>{};
  const url=await server(t,(_req,res)=>{received=true;res.writeHead(200,{'content-type':'text/event-stream'});res.write(': waiting\n\n');action();});
  const input=request(url);if(mode==='deadline')input.runLimitMs=300;
  const running=launch(t,input);action=()=>{if(mode==='eof')running.child.stdin.end();else if(mode==='cancel')running.child.stdin.write('{"type":"cancel"}\n');};
  const result=await running;assert.equal(received,true);
  assert.equal(result.code,1);assert.equal(result.events.at(-1).code,mode==='deadline'?'MODEL_TIMEOUT':'CANCELLED');assert.ok(!result.events.some(e=>e.type==='result'));
});
