import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { StringDecoder } from 'node:string_decoder';
import { randomUUID } from 'node:crypto';

export function stopOwnedGroup(pid){try{process.kill(-pid,'SIGSTOP');}catch{}try{process.kill(-pid,'SIGKILL');}catch{}}
export function watchHost(onClose){
  let closed=false;const close=()=>{if(!closed){closed=true;onClose();}};
  process.stdin.on('end',close);process.stdin.on('error',close);process.stdout.on('error',close);process.on('SIGTERM',close);process.on('SIGHUP',close);
  return ()=>{process.stdin.off('end',close);process.stdin.off('error',close);process.stdout.off('error',close);process.off('SIGTERM',close);process.off('SIGHUP',close);};
}
export function managedBash({workerPath,runId,deadline=Date.now()+120000,onWorker=()=>{},secrets=[]}){
  const children=new Map();
  const close=()=>{for(const [pid,child] of children){child.stdin.destroy();stopOwnedGroup(pid);}};
  const operations={exec(command,cwd,{onData,signal,timeout,env}){
    if(signal?.aborted)return Promise.reject(new Error('aborted'));
    const seconds=Math.min(Number.isFinite(timeout)&&timeout>0?timeout:30,60,(deadline-Date.now())/1000);
    if(seconds<=0)return Promise.reject(new Error('timeout:0'));
    return new Promise((resolve,reject)=>{
      const nonce=randomUUID();const child=spawn(process.execPath,[workerPath,'--run',runId,'--nonce',nonce],{detached:true,cwd,env:env||{PATH:'/usr/bin:/bin'},stdio:['pipe','pipe','pipe']});
      children.set(child.pid,child);onWorker({action:'start',pid:child.pid,nonce});
      let result,protocolError=false,carry='',outputBytes=0,closed=false;const decoder=new StringDecoder('utf8');
      const secretList=secrets.filter(Boolean),hold=Math.max(0,...secretList.map(s=>s.length));
      const emitText=(text,final=false)=>{
        carry+=text;const end=final?carry.length:Math.max(0,carry.length-hold);let cut=end;
        for(const secret of secretList){const found=carry.indexOf(secret);if(found>=0&&found<cut&&found+secret.length>cut)cut=found;}
        let value=carry.slice(0,cut);carry=carry.slice(cut);for(const secret of secretList)value=value.split(secret).join('[REDACTED]');if(value)onData(Buffer.from(value));
      };
      const lines=createInterface({input:child.stdout});
      lines.on('line',line=>{
        outputBytes+=Buffer.byteLength(line);if(outputBytes>200000||line.length>100000){protocolError=true;stopOwnedGroup(child.pid);return;}
        try{const value=JSON.parse(line);if(value.type==='data')emitText(decoder.write(Buffer.from(value.value,'base64')));else if(value.type==='done')result=value;else if(value.type!=='owned')throw new Error();}catch{protocolError=true;stopOwnedGroup(child.pid);}
      });
      child.stderr.on('data',()=>{});child.stdin.on('error',()=>{});
      const abort=()=>{child.stdin.destroy();stopOwnedGroup(child.pid);};signal?.addEventListener('abort',abort,{once:true});
      const limit=setTimeout(()=>{if(!result)result={timedOut:true};abort();},Math.ceil(seconds*1000)+1500);
      const finish=error=>{
        if(closed)return;closed=true;clearTimeout(limit);signal?.removeEventListener('abort',abort);stopOwnedGroup(child.pid);children.delete(child.pid);onWorker({action:'end',pid:child.pid,nonce});
        emitText(decoder.end(),true);lines.close();child.stdin.destroy();
        if(signal?.aborted)reject(new Error('aborted'));else if(result?.timedOut)reject(new Error(`timeout:${seconds}`));else if(error||protocolError||!result)reject(new Error('managed Bash failed'));else resolve({exitCode:result.exitCode});
      };
      child.on('error',finish);child.on('close',()=>finish());
      child.stdin.write(`${JSON.stringify({command,cwd,env:env||{PATH:'/usr/bin:/bin'},timeoutMs:Math.max(1,Math.ceil(seconds*1000))})}\n`);
    });
  }};
  return {operations,close};
}
