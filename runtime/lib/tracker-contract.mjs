const fail=()=>{throw new Error('MODEL_INVALID_OUTPUT');};
function object(value,keys){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||Object.keys(value).some(key=>!keys.includes(key)))fail();return value;}
function text(value,max){if(typeof value!=='string'||!value.trim()||[...value].length>max||/\p{Cc}/u.test(value))fail();return value.trim();}
export function parseTrackerResult(raw,request){
 if(typeof raw!=='string'||raw.length>262144)fail();let result;try{result=JSON.parse(raw);}catch{fail();}
 object(result,['suggestions']);if(!Array.isArray(result.suggestions)||result.suggestions.length>20)fail();
 const facts=request.snapshot?.trackerSample;if(facts?.version!==1||!Array.isArray(facts.todos)||facts.todos.length!==2)fail();
 const seen=new Set();const suggestions=result.suggestions.map(item=>{
  object(item,['todoId','todoVersion','change','summary','evidence']);
  if(!facts.todos.some(todo=>todo.id===item.todoId&&todo.version===item.todoVersion)||!Number.isInteger(item.todoVersion)||!['progress','submission','acceptance','risk'].includes(item.change))fail();
  const key=JSON.stringify([item.todoId,item.change]);if(seen.has(key))fail();seen.add(key);
  const summary=text(item.summary,500),evidence=text(item.evidence,2000);if(!request.source.rawText.includes(evidence))fail();
  return {todoId:item.todoId,todoVersion:item.todoVersion,change:item.change,summary,evidence};
 });return {roleResult:{kind:'tracker',version:1,suggestions}};
}
export function validateTrackerRequest(request){
 const sample=request.snapshot?.trackerSample;const mcp=request.mcp;
 const emptyMcp=mcp===undefined||mcp===null||mcp&&typeof mcp==='object'&&!Array.isArray(mcp)&&Object.keys(mcp).length===1&&Array.isArray(mcp.servers)&&mcp.servers.length===0;
 if(request.kind!=='trial'||request.snapshot?.agent?.agentId!=='tracker'||!sample||sample.version!==1||!Array.isArray(sample.todos)||sample.todos.length!==2||!emptyMcp||Object.hasOwn(request.snapshot,'skills')||Object.hasOwn(request,'verificationMcpOnly')||Object.hasOwn(request,'verificationOutputDiagnostics'))throw new Error('RUNTIME_PROTOCOL');
 const expected=[
  {id:'sample-action',version:1,title:'整理接入清单',kind:'action',owner:'我',status:'open',submission:'尚未提交',acceptance:'尚未验收'},
  {id:'sample-followup',version:1,title:'修复SDK鉴权',kind:'followup',owner:'林川',status:'open',submission:'尚未提交',acceptance:'尚未验收'}
 ];
 if(typeof sample!=='object'||Array.isArray(sample)||Object.keys(sample).length!==2||Object.keys(sample).some(key=>!['version','todos'].includes(key))||sample.todos.some((todo,index)=>!todo||typeof todo!=='object'||Array.isArray(todo)||Object.keys(todo).length!==Object.keys(expected[index]).length||Object.keys(expected[index]).some(key=>todo[key]!==expected[index][key])))throw new Error('RUNTIME_PROTOCOL');
}
