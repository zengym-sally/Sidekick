import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
const group=process.pid;let child,finished=false,closing=false,total=0,truncated=false,timer;
const emit=value=>{try{process.stdout.write(`${JSON.stringify(value)}\n`);}catch{}}
function cleanup(){
  if(closing)return;closing=true;clearTimeout(timer);
  const cleaner=spawn(process.execPath,['-e',"const g=Number(process.argv[1]);try{process.kill(-g,'SIGSTOP')}catch{};try{process.kill(-g,'SIGKILL')}catch{}",String(group)],{detached:true,stdio:'ignore',env:{PATH:'/usr/bin:/bin'}});
  cleaner.on('error',()=>{try{process.kill(-group,'SIGKILL');}catch{process.exit(1);}});cleaner.unref();
}
function finish(exitCode,timedOut=false){
  if(finished)return;finished=true;clearTimeout(timer);
  process.stdout.write(`${JSON.stringify({type:'done',exitCode,timedOut})}\n`,cleanup);
}
process.stdout.on('error',cleanup);process.on('SIGTERM',cleanup);process.on('SIGHUP',cleanup);
const input=createInterface({input:process.stdin});input.on('close',cleanup);
emit({type:'owned',pid:group});
input.once('line',line=>{
  let request;try{request=JSON.parse(line);}catch{finish(1);return;}
  if(typeof request.command!=='string'||typeof request.cwd!=='string'||!Number.isFinite(request.timeoutMs)||request.timeoutMs<=0||request.timeoutMs>60000){finish(1);return;}
  child=spawn('/bin/bash',['-c',request.command],{cwd:request.cwd,env:request.env||{PATH:'/usr/bin:/bin'},detached:false,stdio:['ignore','pipe','pipe']});
  const data=chunk=>{
    if(total>=65536){if(!truncated){truncated=true;emit({type:'data',value:Buffer.from('\n[Sidekick：输出已截断]\n').toString('base64')});}return;}
    const accepted=chunk.subarray(0,65536-total);total+=accepted.length;emit({type:'data',value:accepted.toString('base64')});
  };
  child.stdout.on('data',data);child.stderr.on('data',data);
  child.on('error',()=>finish(1));child.on('exit',code=>finish(code??1));
  timer=setTimeout(()=>finish(124,true),request.timeoutMs);
});
