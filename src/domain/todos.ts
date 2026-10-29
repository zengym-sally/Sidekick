import { calendarDate,dayEnd } from '../../runtime/dates.mjs';
export interface TimePoint { atMs:number; timeZone:string; localText:string; precision?:'day' }
export interface TodoInput { title:string; kind:'action'|'followup'; owner:string; priority:'low'|'medium'|'high'; due:TimePoint|null; followup:TimePoint|null; tags:string[] }
export interface Todo { id:string; data:TodoInput; status:'open'|'completed'|'deleted'; createdAtMs:number; updatedAtMs:number; completedAtMs:number|null; deletedAtMs:number|null; version:number; source:'manual'|'signed_ai' }
export interface TodoEvent { operationId:string; action:string; occurredAtMs:number; before:Todo|null; after:Todo }
export interface WorkspaceInfo { needsSetup:boolean; root:string|null; defaultRoot:string; pendingRoot:string|null }
export interface Filters { kind?:string; status?:string; date?:string; owner?:string; tag?:string; query?:string }

export function currentZone():string { return Intl.DateTimeFormat().resolvedOptions().timeZone; }
const pad=(n:number)=>String(n).padStart(2,'0');
export function localInput(point:TimePoint|null):string {
  if(!point)return '';
  const date=new Date(point.atMs);
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
export function localCandidates(raw:string):number[] {
  const match=/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})$/.exec(raw);
  if(!match)return [];
  const [year,month,day,hour,minute]=match.slice(1).map(Number);
  const naive=Date.UTC(year,month-1,day,hour,minute);
  const offsets=new Set([-36,-12,0,12,36].map(hours=>new Date(naive+hours*3600000).getTimezoneOffset()));
  return [...offsets].map(offset=>naive+offset*60000).filter(at=>{
    const date=new Date(at);
    return date.getFullYear()===year && date.getMonth()===month-1 && date.getDate()===day && date.getHours()===hour && date.getMinutes()===minute;
  }).sort((a,b)=>a-b);
}
export function pointFromInput(raw:string,choice:number|null,previous:TimePoint|null):TimePoint|null {
  if(!raw.trim())return null;
  if(previous && raw.replace(' ','T')===localInput(previous) && (choice===null||choice===previous.atMs))return previous;
  const candidates=localCandidates(raw);
  if(!candidates.length)throw new Error('这个日期或时刻不存在，请检查后重新填写。');
  const at=candidates.length===1?candidates[0]:choice;
  if(at===null || !candidates.includes(at))throw new Error('这个时刻在当前时区出现两次，请选择明确的 UTC 偏移。');
  return {atMs:at,timeZone:currentZone(),localText:raw};
}
export function offsetLabel(at:number):string {
  return new Intl.DateTimeFormat('zh-CN',{timeZoneName:'longOffset',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(at));
}
export function displayTime(at:number):string {
  return new Intl.DateTimeFormat('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(at));
}
export function displayPoint(point:TimePoint):string {return point.precision==='day'?new Intl.DateTimeFormat('zh-CN',{timeZone:point.timeZone,year:'numeric',month:'numeric',day:'numeric'}).format(new Date(point.atMs))+'（仅日期）':displayTime(point.atMs);}
export function isOverdue(todo:Todo,now=Date.now()):boolean {const point=todo.data.due;if(todo.status!=='open'||!point)return false;return point.precision==='day'?(dayEnd(point.atMs,point.timeZone)??Infinity)<=now:point.atMs<now;}
export function effectivePoint(todo:Todo):TimePoint|null{return todo.data.kind==='followup'?todo.data.followup??todo.data.due:todo.data.due;}
export function effectiveTime(todo:Todo):number|null {const point=effectivePoint(todo);if(!point)return null;if(point.precision!=='day')return point.atMs;const [y,m,d]=calendarDate(point.atMs,point.timeZone).split('-').map(Number);return new Date(y,m-1,d,12).getTime();}
function dayRange(now:number):[number,number] {const d=new Date(now);return [new Date(d.getFullYear(),d.getMonth(),d.getDate()).getTime(),new Date(d.getFullYear(),d.getMonth(),d.getDate()+1).getTime()];}
export function filterTodos(rows:Todo[],filters:Filters={},now=Date.now()):Todo[] {
  const [start,end]=dayRange(now);const monday=new Date(start);monday.setDate(monday.getDate()-(monday.getDay()+6)%7);const next=new Date(monday);next.setDate(next.getDate()+7);
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
    if(filters.date==='week' && (time===null||time<monday.getTime()||time>=next.getTime()))return false;
    if(filters.date==='overdue' && !isOverdue(todo,now))return false;
    return true;
  });
}
export function todayLists(rows:Todo[],now=Date.now()):{action:Todo[];followup:Todo[]} {
  const entries=filterTodos(rows,{status:'open',date:'today'},now).sort((a,b)=>(effectiveTime(a)??Infinity)-(effectiveTime(b)??Infinity));
  return {action:entries.filter(t=>t.data.kind==='action'),followup:entries.filter(t=>t.data.kind==='followup')};
}

export function displayInZone(at:number,timeZone:string):string{return new Intl.DateTimeFormat('zh-CN',{timeZone,year:'numeric',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(at));}
