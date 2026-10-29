import { timeDraft,draftPoint,type TimeDraft } from './time.ts';
import type { Candidate,SignChoice } from './organizer.ts';
import type { TodoInput } from './todos.ts';
export interface CandidateEditorState {version:number;selected:boolean;title:string;kind:TodoInput['kind'];owner:string;priority:TodoInput['priority'];tags:string;due:TimeDraft;followup:TimeDraft;timeReviewed:boolean;targetId:string;targetVersion:number;instruction:string;baseline:string;stale:boolean}
export function candidateState(c:Candidate):CandidateEditorState {
  const f=c.draft.fields;const state:CandidateEditorState={version:c.version,selected:c.status==='pending',title:f.title,kind:f.kind,owner:f.owner,priority:f.priority,tags:f.tags.join('，'),due:timeDraft(f.due),followup:timeDraft(f.followup),timeReviewed:!c.draft.unresolved,targetId:'',targetVersion:0,instruction:'',baseline:'',stale:false};state.baseline=editorSignature(state);return state;
}
export function editorSignature(s:CandidateEditorState):string{return JSON.stringify([s.title,s.kind,s.owner,s.priority,s.tags,s.due,s.followup,s.timeReviewed]);}
export function candidateFields(s:CandidateEditorState):TodoInput {
  if(!s.title.trim()||!s.owner.trim())throw new Error('请填写事项标题和实际负责人。');
  if(s.stale)throw new Error('这条候选已经更新，请重新载入后再签收。');
  return {title:s.title,kind:s.kind,owner:s.owner,priority:s.priority,tags:s.tags.split(/[,，]/),due:draftPoint(s.due),followup:s.kind==='followup'?draftPoint(s.followup):null};
}
export function signChoice(c:Candidate,s:CandidateEditorState):SignChoice {
  if(c.status!=='pending')throw new Error('已处理候选不能再次签收。');
  if(c.draft.unresolved&&!s.timeReviewed)throw new Error('请核对有歧义的时间，补充日期或勾选保留未定期。');
  return {candidateId:c.id,expectedVersion:s.version,fields:candidateFields(s),timeReviewed:s.timeReviewed,target:s.targetId?{id:s.targetId,expectedVersion:s.targetVersion}:null};
}
