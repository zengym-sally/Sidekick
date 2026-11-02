import {readFileSync,writeFileSync,existsSync,unlinkSync} from 'node:fs';
const control=JSON.parse(readFileSync(new URL('./today-helper-control.json',import.meta.url),'utf8'));
let input=null,raw='';process.stdin.setEncoding('utf8');process.stdin.on('data',bytes=>{raw+=bytes;if(!input&&raw.includes('\n')){input=JSON.parse(raw.slice(0,raw.indexOf('\n')));writeFileSync(control.ready,JSON.stringify({runId:input.snapshotId,pid:process.pid}),{mode:0o600});}});
process.stdin.on('end',()=>{if(control.exitOnHostClose)process.exit(0);});
const timer=setInterval(async()=>{if(input&&existsSync(control.release)){clearInterval(timer);if(control.consumeRelease)unlinkSync(control.release);const {buildTodayFacts,nextTodayFactBoundary}=await import(control.factsModule);const facts=buildTodayFacts(input);process.stdout.write(JSON.stringify({version:1,facts,validUntilMs:control.nullValidity?null:nextTodayFactBoundary(facts)})+'\n',()=>process.exit(0));}},10);
