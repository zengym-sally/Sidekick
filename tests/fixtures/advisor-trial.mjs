export function advisorSample(id){return {version:1,snapshotId:id,date:'2026-11-02',timeZone:'Asia/Shanghai',anchorAtMs:1793581200000,todos:[
 {id:'advisor-action',version:2,title:'整理接入清单',kind:'action',owner:'我',status:'open',dueDate:'2026-11-02',followupDate:null},
 {id:'advisor-followup',version:3,title:'修复SDK鉴权',kind:'followup',owner:'林川',status:'open',dueDate:'2026-11-03',followupDate:'2026-11-02'},
 {id:'advisor-undated',version:1,title:'确认试用名单',kind:'action',owner:'我',status:'open',dueDate:null,followupDate:null},
 {id:'advisor-done',version:1,title:'归档合成纪要',kind:'action',owner:'我',status:'done',dueDate:'2026-11-01',followupDate:null}
],counts:{total:4,open:3,done:1,dueToday:1,followupToday:1,undated:1}};}
export function advisorAnswer(id,alternate=false){
 const reason=code=>({code,relatedTodoId:null,relatedTodoVersion:null});
 const action={todoId:'advisor-action',todoVersion:2,reasons:alternate?[{code:'earlier_due',relatedTodoId:'advisor-followup',relatedTodoVersion:3}]:[reason('due_today'),{code:'earlier_due',relatedTodoId:'advisor-followup',relatedTodoVersion:3}]};
 const followup={todoId:'advisor-followup',todoVersion:3,reasons:alternate?[reason('upcoming_due'),reason('open_followup')]:[reason('followup_today')]};
 const undated={todoId:'advisor-undated',todoVersion:1,reasons:alternate?[reason('open_action')]:[reason('undated')]};
 return {snapshotId:id,date:'2026-11-02',timeZone:'Asia/Shanghai',ranking:alternate?[followup,undated,action]:[action,followup,undated]};
}
