export interface TodayRawTodo {id:string;data:{title:string;kind:'action'|'followup';owner:string;priority:'low'|'medium'|'high';tags:string[];due:{atMs:number;timeZone:string;localText:string;precision?:'day'|'minute'}|null;followup:{atMs:number;timeZone:string;localText:string;precision?:'day'|'minute'}|null};status:'open'|'completed'|'deleted';version:number;createdAtMs:number;updatedAtMs:number;completedAtMs:number|null;deletedAtMs:number|null;source:'manual'|'signed_ai'}
export interface TodayFactTodo {id:string;version:number;title:string;kind:'action'|'followup';owner:string;priority:'low'|'medium'|'high';tags:string[];status:'open'|'completed'|'deleted';dueDate:string|null;followupDate:string|null;overdue:boolean}
export interface TodayFacts {schemaVersion:1;snapshotId:string;anchorAtMs:number;timeZone:string;date:string;rawTodos:TodayRawTodo[];todos:TodayFactTodo[];counts:{total:number;open:number;completed:number;deleted:number;dueToday:number;followupToday:number;undated:number;overdue:number}}
export function buildTodayFacts(input:{snapshotId:string;anchorAtMs:number;timeZone:string;rawTodos:TodayRawTodo[]}):TodayFacts;
export function validateTodayFacts(facts:unknown):TodayFacts;
export function equalTodayValue(left:unknown,right:unknown):boolean;
export function todayFactsChanged(previous:TodayFacts,current:TodayFacts):boolean;
export function nextTodayFactBoundary(facts:TodayFacts):number|null;
