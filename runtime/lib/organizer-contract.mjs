import { resolveExpression } from '../../shared/dates.mjs';
const fail=(reason='contract')=>{const error=new Error('MODEL_INVALID_OUTPUT');error.reason=reason;throw error;};
function object(value,keys){if(!value||typeof value!=='object'||Array.isArray(value))fail('object-type');if(Object.keys(value).some(k=>!keys.includes(k)))fail('object-keys');return value;}
function text(value,max){if(typeof value!=='string'||!value.trim()||[...value].length>max||/[\u0000-\u001f]/.test(value))fail('text');return value.trim();}
function fields(value){
  const title=text(value.title,200),owner=text(value.owner,100),kind=value.kind,priority=value.priority??'medium';
  if(!['action','followup'].includes(kind))fail('kind');if(!['low','medium','high'].includes(priority))fail('priority');
  const tags=value.tags??[];if(!Array.isArray(tags)||tags.length>12)fail('tags');
  return {title,kind,owner,priority,tags:[...new Set(tags.map(t=>text(t,32)))],due:null,followup:null};
}
function expression(value){if(value===null||value===undefined)return null;return text(value,256);}
function resolveField(draft,key,raw,request){
  const label=key==='due'?'截止':'跟进';draft.warnings=draft.warnings.filter(w=>!w.startsWith(label));
  const result=resolveExpression(raw,request.anchorAtMs,request.source.timeZone);
  draft.fields[key]=result.point;draft[`${key==='due'?'due':'followup'}Expression`]=raw;
  draft.warnings.push(...result.warnings.map(w=>`${label}${result.unresolved?'待核对':'说明'}：${w}`));return result.unresolved;
}
function extraction(value,request){
  object(value,['title','kind','owner','priority','tags','evidence','dueExpression','followupExpression']);
  const evidence=text(value.evidence,2000);if(!request.source.rawText.includes(evidence))fail('evidence');
  const draft={fields:fields(value),evidence,dueExpression:expression(value.dueExpression),followupExpression:expression(value.followupExpression),warnings:[],unresolved:false};
  if([draft.dueExpression,draft.followupExpression].some(value=>value&&!request.source.rawText.includes(value)))fail('date-evidence');
  if(draft.fields.kind==='action'&&draft.followupExpression)fail('followup');
  const due=resolveField(draft,'due',draft.dueExpression,request),follow=resolveField(draft,'followup',draft.followupExpression,request);draft.unresolved=due||follow;return draft;
}
export function parseModelResult(raw,request){
  if(typeof raw!=='string')fail('raw-type');if(raw.length>262144)fail('raw-size');let result;
  try{result=JSON.parse(raw.trim().replace(/^```(?:json)?\s*|\s*```$/g,''));}catch{fail('json');}
  if(request.kind==='test'){object(result,['ok']);if(result.ok!==true)fail();return {ok:true};}
  if(request.kind==='extract'){
    object(result,['candidates']);if(!Array.isArray(result.candidates)||result.candidates.length>50)fail();
    return {candidates:result.candidates.map(value=>extraction(value,request))};
  }
  if(request.kind!=='revise')fail('task-kind');object(result,['changes']);const patch=object(result.changes,['title','kind','owner','priority','tags','dueExpression','followupExpression']);
  if(!Object.keys(patch).length)fail('changes-empty');const previous=request.candidate.draft;const draft=structuredClone(previous);
  const next=fields({...draft.fields,...patch});
  for(const key of ['title','kind','owner','priority','tags'])if(Object.hasOwn(patch,key))draft.fields[key]=next[key];
  let dueIssue=previous.unresolved&&previous.warnings.some(w=>w.startsWith('截止待核对'));
  let followIssue=previous.unresolved&&previous.warnings.some(w=>w.startsWith('跟进待核对'));
  if(Object.hasOwn(patch,'dueExpression'))dueIssue=resolveField(draft,'due',expression(patch.dueExpression),request);
  if(Object.hasOwn(patch,'followupExpression'))followIssue=resolveField(draft,'followup',expression(patch.followupExpression),request);
  if(draft.fields.kind==='action'){
    if(patch.followupExpression)fail('followup');draft.fields.followup=null;draft.followupExpression=null;draft.warnings=draft.warnings.filter(w=>!w.startsWith('跟进'));followIssue=false;
  }
  draft.unresolved=dueIssue||followIssue;return {preview:draft};
}
