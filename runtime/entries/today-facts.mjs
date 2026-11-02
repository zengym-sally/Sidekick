import {buildTodayFacts,nextTodayFactBoundary} from '../../shared/today-facts.mjs';
let chunks=[],size=0,received=false,finished=false;
function fail(){if(finished)return;finished=true;process.stderr.write('TODAY_FACTS_INVALID\n');process.exitCode=1;process.stdin.destroy();}
process.stdin.on('data',bytes=>{if(finished)return;size+=bytes.length;if(size>1600000){fail();return;}chunks.push(bytes);if(!bytes.includes(10))return;const raw=Buffer.concat(chunks,size).toString('utf8'),at=raw.indexOf('\n');chunks=[];if(received||raw.slice(at+1).trim()){fail();return;}received=true;try{const facts=buildTodayFacts(JSON.parse(raw.slice(0,at)));const result=JSON.stringify({version:1,facts,validUntilMs:nextTodayFactBoundary(facts)});if(Buffer.byteLength(result)+1>1600000)throw Error();finished=true;process.stdout.write(result+'\n',()=>process.stdin.destroy());}catch{fail();}});
process.stdin.on('end',()=>{if(!finished)fail();});
process.stdin.on('error',()=>{if(!finished)fail();});
