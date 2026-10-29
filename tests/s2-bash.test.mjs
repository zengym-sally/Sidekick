import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { managedBash } from '../runtime/managed-bash.mjs';
const workerPath=fileURLToPath(new URL('../runtime/bash-worker.mjs',import.meta.url));
const alive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};
async function gone(pid){for(let i=0;i<100&&alive(pid);i++)await new Promise(r=>setTimeout(r,30));assert.equal(alive(pid),false,`owned pid ${pid} must exit`);}
test('managed Bash preserves output and exit status while redacting the active credential',async()=>{
  let output='';const bash=managedBash({workerPath,runId:'bash-test',secrets:['synthetic-secret']});
  const result=await bash.operations.exec("printf synthetic-secret; printf done; exit 7",process.cwd(),{onData:data=>output+=data,env:{PATH:'/usr/bin:/bin'}});
  assert.equal(result.exitCode,7);assert.equal(output,'[REDACTED]done');bash.close();
});
test('the run deadline bounds a missing or excessive Bash timeout',async()=>{
  for(const timeout of [undefined,999999]){const bash=managedBash({workerPath,runId:'deadline-test',deadline:Date.now()+120});await assert.rejects(bash.operations.exec('sleep 20',process.cwd(),{timeout,onData:()=>{},env:{PATH:'/usr/bin:/bin'}}),/timeout/);bash.close();}
});
test('a crashed guardian is reaped together with its already-running Bash child',async t=>{
  let workerPid,resolveReady;const ready=new Promise(resolve=>resolveReady=resolve);let sleepPid;
  const bash=managedBash({workerPath,runId:'worker-crash',onWorker:event=>{if(event.action==='start')workerPid=event.pid;}});
  t.after(()=>{bash.close();if(workerPid){try{process.kill(-workerPid,'SIGKILL');}catch{}}});
  const task=bash.operations.exec('sleep 30 & printf "child=%s\\n" "$!"; wait',process.cwd(),{onData:data=>{const match=/child=(\d+)/.exec(data.toString());if(match){sleepPid=Number(match[1]);resolveReady();}},env:{PATH:'/usr/bin:/bin'}});
  await ready;assert.equal(alive(sleepPid),true);process.kill(workerPid,'SIGKILL');await assert.rejects(task,/managed Bash failed/);await gone(sleepPid);
});
for(const mode of ['--runtime','--host'])test(`SIGKILL ${mode} closes the life channel and reaps the owned tool group`,async t=>{
  const child=spawn(process.execPath,[fileURLToPath(new URL('./fixtures/bash-lifecycle.mjs',import.meta.url)),mode],{stdio:['pipe','pipe','ignore']});
  let toolPid,sleepPid;const lines=createInterface({input:child.stdout});
  t.after(()=>{child.stdin.destroy();child.kill('SIGKILL');if(toolPid&&alive(toolPid)){try{process.kill(-toolPid,'SIGKILL');}catch{}}});
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('fixture not ready')),3000);lines.on('line',line=>{const value=JSON.parse(line);if(value.action==='start')toolPid=value.pid;const match=/child=(\d+)/.exec(value.data||'');if(match)sleepPid=Number(match[1]);if(toolPid&&sleepPid){clearTimeout(timer);resolve();}});child.on('error',reject);});
  child.kill('SIGKILL');await gone(toolPid);await gone(sleepPid);lines.close();
});
