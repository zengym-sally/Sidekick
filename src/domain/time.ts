import { calendarDate, dayCoordinate } from '../../runtime/dates.mjs';
import { currentZone,localInput,pointFromInput,type TimePoint } from './todos.ts';
export interface TimeDraft {enabled:boolean;dayOnly:boolean;raw:string;choice:number|null;previous:TimePoint|null}
export function timeDraft(point:TimePoint|null):TimeDraft{return {enabled:!!point,dayOnly:point?.precision==='day',raw:point?(point.precision==='day'?calendarDate(point.atMs,point.timeZone):localInput(point)):'',choice:point?.atMs??null,previous:point};}
export function draftPoint(draft:TimeDraft):TimePoint|null{
  if(!draft.enabled)return null;
  if(!draft.raw.trim())throw new Error('已启用的时间尚未填写，请补充或取消设置。');
  if(!draft.dayOnly)return pointFromInput(draft.raw,draft.choice,draft.previous?.precision==='day'?null:draft.previous);
  if(draft.previous?.precision==='day'&&calendarDate(draft.previous.atMs,draft.previous.timeZone)===draft.raw)return draft.previous;
  const at=dayCoordinate(draft.raw,currentZone());if(at===null)throw new Error('这个日期不存在，请检查后重新填写。');
  return {atMs:at,timeZone:currentZone(),localText:draft.raw,precision:'day'};
}
