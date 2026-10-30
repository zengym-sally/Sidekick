import { ref } from 'vue';
import { calendarDate,dayEnd,dayCoordinate,zonedCandidates } from '../../runtime/dates.mjs';
export interface TimePoint { atMs:number; timeZone:string; localText:string; precision?:'day' }
export interface TodoInput { title:string; kind:'action'|'followup'; owner:string; priority:'low'|'medium'|'high'; due:TimePoint|null; followup:TimePoint|null; tags:string[] }
export interface Todo { id:string; data:TodoInput; status:'open'|'completed'|'deleted'; createdAtMs:number; updatedAtMs:number; completedAtMs:number|null; deletedAtMs:number|null; version:number; source:'manual'|'signed_ai' }
export interface TodoEvent { operationId:string; action:string; occurredAtMs:number; before:Todo|null; after:Todo }
export interface WorkspaceInfo { needsSetup:boolean; root:string|null; defaultRoot:string; pendingRoot:string|null }
export interface Filters { kind?:string; status?:string; date?:string; owner?:string; tag?:string; query?:string }

const applicationZone=ref<string|null>(null),applicationZoneReady=ref(true);
export function setApplicationZoneReady(ready:boolean){applicationZoneReady.value=ready;}
export function requireApplicationZone():string {if(!applicationZoneReady.value)throw Error('请先在通用设置重新读取并核对日期规则，再记录或整理新事项。');return currentZone();}
export function setApplicationZone(zone:string|null){if(zone)new Intl.DateTimeFormat('en',{timeZone:zone});applicationZone.value=zone;applicationZoneReady.value=true;}
export function currentZone():string { return applicationZone.value||Intl.DateTimeFormat().resolvedOptions().timeZone; }
export function localInput(point:TimePoint|null,zone=currentZone()):string {
  if(!point)return '';
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(point.atMs)).map(p=>[p.type,p.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
export function localCandidates(raw:string,zone=currentZone()):number[] {return zonedCandidates(raw,zone);}
export function pointFromInput(raw:string,choice:number|null,previous:TimePoint|null,zone=currentZone()):TimePoint|null {
  if(!raw.trim())return null;
  if(previous && raw.replace(' ','T')===localInput(previous,zone) && (choice===null||choice===previous.atMs))return previous;
  requireApplicationZone();
  const candidates=localCandidates(raw,zone);
  if(!candidates.length)throw new Error('这个日期或时刻不存在，请检查后重新填写。');
  const at=candidates.length===1?candidates[0]:choice;
  if(at===null || !candidates.includes(at))throw new Error('这个时刻在当前时区出现两次，请选择明确的 UTC 偏移。');
  return {atMs:at,timeZone:zone,localText:raw};
}
export function offsetLabel(at:number):string {
  return new Intl.DateTimeFormat('zh-CN',{timeZone:currentZone(),timeZoneName:'longOffset',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(at));
}
export function displayTime(at:number):string {
  return new Intl.DateTimeFormat('zh-CN',{timeZone:currentZone(),month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(at));
}
export function displayPoint(point:TimePoint):string {return point.precision==='day'?new Intl.DateTimeFormat('zh-CN',{timeZone:point.timeZone,year:'numeric',month:'numeric',day:'numeric'}).format(new Date(point.atMs))+'（仅日期）':displayTime(point.atMs);}
export function isOverdue(todo:Todo,now=Date.now()):boolean {const point=todo.data.due;if(todo.status!=='open'||!point)return false;if(point.precision!=='day')return point.atMs<now;const zone=applicationZone.value||point.timeZone,at=dayCoordinate(calendarDate(point.atMs,point.timeZone),zone);return at!==null&&(dayEnd(at,zone)??Infinity)<=now;}
export function effectivePoint(todo:Todo):TimePoint|null{return todo.data.kind==='followup'?todo.data.followup??todo.data.due:todo.data.due;}
export function effectiveTime(todo:Todo):number|null {const point=effectivePoint(todo);if(!point)return null;if(point.precision!=='day')return point.atMs;return dayCoordinate(calendarDate(point.atMs,point.timeZone),currentZone());}
function dayRange(now:number):[number,number] {const zone=currentZone(),date=calendarDate(now,zone),start=dayCoordinate(date,zone);return [start??now,dayEnd(now,zone)??now+86400000];}
export function filterTodos(rows:Todo[],filters:Filters={},now=Date.now()):Todo[] {
  const [start,end]=dayRange(now);const civil=calendarDate(start,currentZone()),base=Date.parse(civil+'T12:00Z'),monday=new Date(base-((new Date(base).getUTCDay()+6)%7)*86400000).toISOString().slice(0,10),next=new Date(Date.parse(monday+'T12:00Z')+7*86400000).toISOString().slice(0,10),weekStart=dayCoordinate(monday,currentZone())??start,weekEnd=dayCoordinate(next,currentZone())??end;
  return rows.filter(todo=>{
    if(filters.status==='deleted'?todo.status!=='deleted':todo.status==='deleted')return false;
    if(filters.status && !['all','deleted'].includes(filters.status) && todo.status!==filters.status)return false;
    if(filters.kind && filters.kind!=='all' && todo.data.kind!==filters.kind)return false;
    if(filters.owner && todo.data.owner!==filters.owner)return false;
    if(filters.tag && !todo.data.tags.includes(filters.tag))return false;
    if(filters.query && !todo.data.title.toLocaleLowerCase().includes(filters.query.trim().toLocaleLowerCase()))return false;
    const time=effectiveTime(todo);
    if(filters.date==='undated' && (todo.data.due||todo.data.followup))return false;
    if(filters.date==='today' && (time===null||time>=end))return false;
    if(filters.date==='week' && (time===null||time<weekStart||time>=weekEnd))return false;
    if(filters.date==='overdue' && !isOverdue(todo,now))return false;
    return true;
  });
}
export function todayLists(rows:Todo[],now=Date.now()):{action:Todo[];followup:Todo[]} {
  const entries=filterTodos(rows,{status:'open',date:'today'},now).sort((a,b)=>(effectiveTime(a)??Infinity)-(effectiveTime(b)??Infinity));
  return {action:entries.filter(t=>t.data.kind==='action'),followup:entries.filter(t=>t.data.kind==='followup')};
}

export function displayInZone(at:number,timeZone:string):string{return new Intl.DateTimeFormat('zh-CN',{timeZone,year:'numeric',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(at));}
