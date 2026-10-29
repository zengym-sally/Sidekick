export interface ResolvedPoint {atMs:number;timeZone:string;localText:string;precision?:'day'}
export function calendarDate(at:number,zone:string):string;
export function zonedCandidates(raw:string,zone:string):number[];
export function dayCoordinate(date:string,zone:string):number|null;
export function nextCalendarDate(date:string):string;
export function dayEnd(at:number,zone:string):number|null;
export function resolveExpression(expression:string|null,anchor:number,zone:string):{point:ResolvedPoint|null;warnings:string[];unresolved:boolean};
