import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { managedBash, watchHost } from '../../runtime/managed-bash.mjs';
if(process.argv.includes('--host')){
  const child=spawn(process.execPath,[process.argv[1],'--runtime'],{stdio:['pipe','pipe','ignore']});child.stdout.pipe(process.stdout);process.stdin.resume();
}else{
  const control=new AbortController();const bash=managedBash({workerPath:fileURLToPath(new URL('../../runtime/bash-worker.mjs',import.meta.url)),runId:'lifecycle-fixture',onWorker:event=>process.stdout.write(`${JSON.stringify(event)}\n`)});
  const unwatch=watchHost(()=>{control.abort();bash.close();});process.stdin.resume();
  try{await bash.operations.exec('sleep 30 & printf "child=%s\\n" "$!"; wait',process.cwd(),{signal:control.signal,onData:data=>process.stdout.write(`${JSON.stringify({data:data.toString()})}\n`),env:{PATH:'/usr/bin:/bin'}});}catch{}
  finally{bash.close();unwatch();process.stdin.destroy();}
}
