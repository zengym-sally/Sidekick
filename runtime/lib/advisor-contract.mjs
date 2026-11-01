const invalid=()=>{throw new Error('MODEL_INVALID_OUTPUT');};
const protocol=()=>{throw new Error('RUNTIME_PROTOCOL');};
function object(value,keys,fail=invalid){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||Object.keys(value).some(key=>!keys.includes(key)))fail();return value;}
function exact(value,expected){
 if(expected===null||typeof expected!=='object'){if(value!==expected)protocol();return;}
 if(Array.isArray(expected)){if(!Array.isArray(value)||value.length!==expected.length)protocol();expected.forEach((item,index)=>exact(value[index],item));return;}
 object(value,Object.keys(expected),protocol);for(const key of Object.keys(expected))exact(value[key],expected[key]);
}
function expectedSample(id){
 const date='2026-11-02',todos=[
  {id:'advisor-action',version:2,title:'整理接入清单',kind:'action',owner:'我',status:'open',dueDate:'2026-11-02',followupDate:null},
  {id:'advisor-followup',version:3,title:'修复SDK鉴权',kind:'followup',owner:'林川',status:'open',dueDate:'2026-11-03',followupDate:'2026-11-02'},
  {id:'advisor-undated',version:1,title:'确认试用名单',kind:'action',owner:'我',status:'open',dueDate:null,followupDate:null},
  {id:'advisor-done',version:1,title:'归档合成纪要',kind:'action',owner:'我',status:'done',dueDate:'2026-11-01',followupDate:null}
 ];const open=todos.filter(todo=>todo.status==='open');
 return {version:1,snapshotId:id,date,timeZone:'Asia/Shanghai',anchorAtMs:1793581200000,todos,counts:{total:todos.length,open:open.length,done:todos.length-open.length,dueToday:open.filter(todo=>todo.dueDate===date).length,followupToday:open.filter(todo=>todo.followupDate===date).length,undated:open.filter(todo=>todo.dueDate===null&&todo.followupDate===null).length}};
}
export function validateAdvisorRequest(request){
 const snapshot=request.snapshot,mcp=request.mcp;
 const emptyMcp=mcp===undefined||mcp===null||mcp&&typeof mcp==='object'&&!Array.isArray(mcp)&&Object.keys(mcp).length===1&&Array.isArray(mcp.servers)&&mcp.servers.length===0;
 if(request.kind!=='trial'||snapshot?.agent?.agentId!=='advisor'||typeof request.runId!=='string'||!/^[a-zA-Z0-9_-]{1,128}$/.test(request.runId)||!emptyMcp||Object.hasOwn(snapshot,'skills')||['verificationMcpOnly','verificationOutputDiagnostics','verificationNativeModel'].some(key=>Object.hasOwn(request,key)))protocol();
 exact(snapshot.advisorSample,expectedSample(request.runId));
 object(request.source,['rawText','timeZone'],protocol);
 if(request.anchorAtMs!==1793581200000||request.source.timeZone!=='Asia/Shanghai'||typeof request.source.rawText!=='string'||!request.source.rawText.trim()||[...request.source.rawText].length>64000||request.source.rawText.includes('\0'))protocol();
}
export function parseAdvisorResult(raw,request){
 validateAdvisorRequest(request);
 if(typeof raw!=='string'||raw.length>262144)invalid();let result;try{result=JSON.parse(raw);}catch{invalid();}
 object(result,['snapshotId','date','timeZone','ranking']);const facts=request.snapshot.advisorSample;
 if(result.snapshotId!==request.runId||result.date!==facts.date||result.timeZone!==facts.timeZone||!Array.isArray(result.ranking)||![0,3].includes(result.ranking.length))invalid();
 const seen=new Set();const ranking=result.ranking.map(item=>{
  object(item,['todoId','todoVersion','reasons']);const todo=facts.todos.find(todo=>todo.id===item.todoId&&todo.version===item.todoVersion&&todo.status==='open');
  if(!todo||!Number.isInteger(item.todoVersion)||seen.has(item.todoId)||!Array.isArray(item.reasons)||item.reasons.length<1||item.reasons.length>3)invalid();seen.add(item.todoId);
  const reasonsSeen=new Set();const reasons=item.reasons.map(reason=>{
   object(reason,['code','relatedTodoId','relatedTodoVersion']);if(typeof reason.code!=='string')invalid();const key=JSON.stringify([reason.code,reason.relatedTodoId,reason.relatedTodoVersion]);if(reasonsSeen.has(key))invalid();reasonsSeen.add(key);
   if(reason.code==='earlier_due'){
    const other=facts.todos.find(other=>other.id===reason.relatedTodoId&&other.version===reason.relatedTodoVersion&&other.status==='open');
    if(!other||!Number.isInteger(reason.relatedTodoVersion)||other.id===todo.id||todo.dueDate===null||other.dueDate===null||todo.dueDate>=other.dueDate)invalid();
   }else{
    if(reason.relatedTodoId!==null||reason.relatedTodoVersion!==null)invalid();
    const valid={due_today:todo.dueDate===facts.date,followup_today:todo.followupDate===facts.date,upcoming_due:todo.dueDate!==null&&todo.dueDate>facts.date,undated:todo.dueDate===null&&todo.followupDate===null,open_action:todo.kind==='action',open_followup:todo.kind==='followup'};
    if(!Object.hasOwn(valid,reason.code)||valid[reason.code]!==true)invalid();
   }
   return {code:reason.code,relatedTodoId:reason.relatedTodoId,relatedTodoVersion:reason.relatedTodoVersion};
  });return {todoId:item.todoId,todoVersion:item.todoVersion,reasons};
 });return {roleResult:{kind:'advisor',version:1,snapshotId:result.snapshotId,date:result.date,timeZone:result.timeZone,ranking}};
}
