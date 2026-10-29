import { createServer } from 'node:http';
const server=createServer(async(req,res)=>{
  let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>1000000){res.writeHead(413);res.end();return;}}
  try{
    const body=JSON.parse(raw),system=body.messages.find(m=>m.role==='system')?.content||'';
    const content=body.messages.findLast(m=>m.role==='user')?.content;const context=JSON.parse(typeof content==='string'?content:content?.find(b=>b.type==='text')?.text||'{}');
    let result;
    if(system.includes('exactly {"ok":true}'))result={ok:true};
    else if(system.includes('Return {"changes"'))result={changes:{title:'补充模型网关接入说明'}};
    else {const lines=context.source.split('\n').filter(Boolean);result={candidates:lines.slice(0,4).map((line,index)=>({title:['整理网关接入清单','跟进SDK鉴权修复','确认试用名单','核对联系人名单'][index],kind:index===1?'followup':'action',owner:index===1?'林川':'我',priority:'medium',tags:[],evidence:line,dueExpression:index<2?'周五17点前':null,followupExpression:index===1?'今天15点':null}))};}
    res.writeHead(200,{'content-type':'text/event-stream'});res.end(`data: ${JSON.stringify({id:'local-fixture',choices:[{index:0,delta:{role:'assistant',content:JSON.stringify(result)},finish_reason:null}]})}\n\ndata: ${JSON.stringify({choices:[{index:0,delta:{},finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`);
  }catch{res.writeHead(400);res.end('{"error":{"message":"fixture request invalid"}}');}
});
server.listen(1493,'127.0.0.1',()=>process.stdout.write('S2 synthetic OpenAI fixture: http://127.0.0.1:1493/v1 (no external model, no request logging)\n'));
