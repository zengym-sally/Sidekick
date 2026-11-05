export type PetPose='idle'|'found'|'remind'|'done';
export interface PetPlaybackView {
 workspaceEpoch:string;stateRevision:number;playEpoch:number;
 visible:boolean;collapsed:boolean;dragging:boolean;menuOpen:boolean;
 workMode:boolean;reducedMotion:boolean;pageVisible:boolean;
}
export interface PetFeedbackNotice {
 workspaceEpoch:string;commitRevision:number;playEpoch:number;
 feedbackId:string;kind:'found'|'done';
}
export interface PetFeedbackGrant {
 workspaceEpoch:string;stateRevision:number;playEpoch:number;
 feedbackId:string;kind:'found'|'done';remainingMs:number;
}
const counter=(value:number)=>Number.isSafeInteger(value)&&value>=0;
const feedbackKind=(kind:string)=>kind==='found'||kind==='done';
const sameScope=(value:{workspaceEpoch:string;playEpoch:number},view:PetPlaybackView)=>Boolean(view.workspaceEpoch)&&value.workspaceEpoch===view.workspaceEpoch&&counter(value.playEpoch)&&value.playEpoch===view.playEpoch;

export function petBasePose(pendingCandidateCount:number):'idle'|'found'{return pendingCandidateCount>0?'found':'idle';}
export function petCanAnimate(view:PetPlaybackView){
 return view.visible&&!view.collapsed&&!view.dragging&&!view.menuOpen&&!view.workMode&&!view.reducedMotion&&view.pageVisible;
}
export function petCanClaimFeedback(notice:PetFeedbackNotice,view:PetPlaybackView,consumed:ReadonlySet<string>){
 return petCanAnimate(view)&&sameScope(notice,view)&&Boolean(notice.feedbackId)&&feedbackKind(notice.kind)&&!consumed.has(notice.feedbackId)&&counter(notice.commitRevision)&&counter(view.stateRevision)&&notice.commitRevision>=view.stateRevision;
}
export function petFeedbackBudget(notice:PetFeedbackNotice,grant:PetFeedbackGrant,view:PetPlaybackView,roundTripMs:number){
 if(!petCanAnimate(view)||!sameScope(notice,view)||!sameScope(grant,view)||!notice.feedbackId||grant.feedbackId!==notice.feedbackId||!feedbackKind(grant.kind)||grant.kind!==notice.kind)return 0;
 if(!counter(notice.commitRevision)||!counter(grant.stateRevision)||!counter(view.stateRevision)||grant.stateRevision<view.stateRevision)return 0;
 if(!Number.isFinite(roundTripMs)||roundTripMs<0||!Number.isFinite(grant.remainingMs)||grant.remainingMs<=0||grant.remainingMs>2000)return 0;
 return Math.max(0,Math.min(1500,grant.remainingMs-roundTripMs));
}
