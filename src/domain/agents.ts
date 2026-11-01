import type {CandidateDraft,ModelRun} from './organizer';
export type AgentId='organizer'|'tracker'|'advisor';
export const agents=[
  {id:'organizer' as const,name:'事项整理',description:'读懂资料，整理成可签收的事项。',focus:[['balanced','执行与跟进兼顾'],['my_actions','更关注本人执行'],['followups','更关注本人跟进']]},
  {id:'tracker' as const,name:'进展跟踪',description:'把新线索与已有事项接起来。',focus:[['evidence','优先呈现原文依据'],['risks','优先呈现风险与变化']]},
  {id:'advisor' as const,name:'工作参谋',description:'根据事实，理清今日重点。',focus:[['deadline','优先关注交付截止'],['followup','优先关注跟进安排']]},
];
export interface AgentConfig {version:1;agentId:AgentId;revision:string;modelId:string|null;preferences:{detail:string;focus:string};supplementalInstructions:string}
export interface AgentDraft {modelId:string|null;preferences:{detail:string;focus:string};supplementalInstructions:string}
export interface TrackerSuggestion {todoId:string;todoVersion:number;change:'progress'|'submission'|'acceptance'|'risk';summary:string;evidence:string}
export interface TrackerTrialResult {kind:'tracker';version:1;suggestions:TrackerSuggestion[]}
export interface TrackerSampleTodo {id:string;version:number;title:string;kind:'action'|'followup';owner:string;status:'open';submission:string;acceptance:string}
export interface AgentTrial {id:string;agentId:AgentId;purpose:'role_trial';status:ModelRun['status'];snapshot:Record<string,unknown>;input:{text:string;timeZone:string;sourceAtMs:number|null};result:CandidateDraft[]|null;roleResult?:TrackerTrialResult|null;errorCode:string|null;createdAtMs:number;finishedAtMs:number|null}
export function configDraft(c:AgentConfig):AgentDraft{return {modelId:c.modelId,preferences:{...c.preferences},supplementalInstructions:c.supplementalInstructions};}
export function agentSignature(d:AgentDraft):string{return JSON.stringify(d);}
