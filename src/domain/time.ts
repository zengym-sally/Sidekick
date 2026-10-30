import { calendarDate, dayCoordinate } from '../../runtime/dates.mjs';
import { currentZone,requireApplicationZone,localInput,pointFromInput,type TimePoint } from './todos.ts';
export interface TimeDraft {enabled:boolean;dayOnly:boolean;raw:string;choice:number|null;previous:TimePoint|null;zone:string;needsReview:boolean}
export function timeDraft(point:TimePoint|null):TimeDraft{return {zone:currentZone(),needsReview:false,enabled:!!point,dayOnly:point?.precision==='day',raw:point?(point.precision==='day'?calendarDate(point.atMs,point.timeZone):localInput(point)):'',choice:point?.atMs??null,previous:point};}
export function draftPoint(draft:TimeDraft):TimePoint|null{
  if(!draft.enabled)return null;
  if(draft.needsReview)throw new Error('请重新核对这项时间，再继续保存。');
  if(!draft.raw.trim())throw new Error('已启用的时间尚未填写，请补充或取消设置。');
  if(!draft.dayOnly)return pointFromInput(draft.raw,draft.choice,draft.previous?.precision==='day'?null:draft.previous,draft.zone);
  if(draft.previous?.precision==='day'&&calendarDate(draft.previous.atMs,draft.previous.timeZone)===draft.raw)return draft.previous;
  requireApplicationZone();
  const at=dayCoordinate(draft.raw,draft.zone);if(at===null)throw new Error('这个日期不存在，请检查后重新填写。');
  return {atMs:at,timeZone:draft.zone,localText:draft.raw,precision:'day'};
}

export function rezoneDraft(draft:TimeDraft){const zone=currentZone();if(draft.zone===zone)return;if(draft.enabled&&!draft.dayOnly&&draft.raw){try{const value=draftPoint(draft);if(value){draft.raw=localInput(value,zone);draft.choice=value.atMs;draft.previous=value;}}catch{draft.needsReview=true;}}draft.zone=zone;}
export function timeSignature(draft:TimeDraft):unknown {try{return draftPoint(draft);}catch{return [draft.enabled,draft.dayOnly,draft.raw,draft.choice,draft.zone,draft.needsReview];}}
