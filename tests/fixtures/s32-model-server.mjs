import {createServer} from 'node:http';import {dirname,join} from 'node:path';
function stream(res,value,tool){res.writeHead(200,{'content-type':'text/event-stream'});const delta=tool?{role:'assistant',tool_calls:[{index:0,id:'controlled-'+Date.now(),type:'function',function:{name:tool.name,arguments:JSON.stringify(tool.args)}}]}:{role:'assistant',content:JSON.stringify(value)};res.end(`data: ${JSON.stringify({choices:[{index:0,delta,finish_reason:null}]})}\n\ndata: ${JSON.stringify({choices:[{index:0,delta:{},finish_reason:tool?'tool_calls':'stop'}]})}\n\ndata: [DONE]\n\n`);}
const server=createServer(async(req,res)=>{try{let raw='';for await(const b of req)raw+=b;const body=JSON.parse(raw),system=body.messages.find(m=>m.role==='system')?.content||'',tools=body.messages.filter(m=>m.role==='tool');const path=/<name>s32-reader<\/name>[^]*?<location>([^<]+)<\/location>/.exec(system)?.[1]?.replaceAll('&amp;','&').replaceAll('&apos;',"'");
if(!path){stream(res,{candidates:[]});return;}
if(tools.length===0)stream(res,null,{name:'read',args:{path}});
else if(tools.length===1)stream(res,null,{name:'read',args:{path:'references/context.md'}});
else if(tools.length===2)stream(res,null,{name:'bash',args:{command:`/bin/bash '${join(dirname(path),'scripts/echo.sh').replaceAll("'","'\\''")}'`,timeout:3}});
else stream(res,{candidates:[{title:'整理合成清单',kind:'action',owner:'我',priority:'medium',tags:['skill-proof-v1'],evidence:'我下周五整理清单。',dueExpression:'下周五',followupExpression:null}]});
}catch{res.writeHead(400);res.end('{}');}});
server.listen(Number(process.env.SIDEKICK_SYNTHETIC_PORT||0),'127.0.0.1',()=>process.stdout.write(`http://127.0.0.1:${server.address().port}/v1\n`));
process.on('SIGTERM',()=>{server.closeAllConnections();server.close(()=>process.exit(0));});
