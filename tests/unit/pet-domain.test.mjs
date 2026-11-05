import assert from 'node:assert/strict';
import test from 'node:test';
import {petBasePose,petCanAnimate,petCanClaimFeedback,petFeedbackBudget} from '../../src/domain/pet.ts';

const view=()=>({workspaceEpoch:'synthetic-root',stateRevision:4,playEpoch:7,visible:true,collapsed:false,dragging:false,menuOpen:false,workMode:false,reducedMotion:false,pageVisible:true});
const notice=()=>({workspaceEpoch:'synthetic-root',commitRevision:4,playEpoch:7,feedbackId:'synthetic-done',kind:'done'});
const grant=()=>({workspaceEpoch:'synthetic-root',stateRevision:4,playEpoch:7,feedbackId:'synthetic-done',kind:'done',remainingMs:1800});
test('pending candidate mark remains until every pending candidate is processed',()=>{
 assert.equal(petBasePose(3),'found');assert.equal(petBasePose(1),'found');assert.equal(petBasePose(0),'idle');
});
test('hidden, collapsed, menu, drag and motion preferences independently block decoration',()=>{
 assert.equal(petCanAnimate(view()),true);
 for(const patch of [{visible:false},{collapsed:true},{menuOpen:true},{dragging:true},{workMode:true},{reducedMotion:true},{pageVisible:false}])assert.equal(petCanAnimate({...view(),...patch}),false);
});
test('only fresh feedback from the current root and playable epoch may be claimed',()=>{
 assert.equal(petCanClaimFeedback(notice(),view(),new Set()),true);
 for(const patch of [{workspaceEpoch:'old-root'},{playEpoch:6},{commitRevision:3},{kind:'remind'},{commitRevision:Infinity},{commitRevision:-1}])assert.equal(petCanClaimFeedback({...notice(),...patch},view(),new Set()),false);
 assert.equal(petCanClaimFeedback(notice(),view(),new Set(['synthetic-done'])),false);
 assert.equal(petCanClaimFeedback(notice(),{...view(),collapsed:true},new Set()),false);
});
test('a claimed grant cannot be carried across hide/show or collapse/expand',()=>{
 assert.equal(petFeedbackBudget(notice(),grant(),view(),100),1500);
 assert.equal(petFeedbackBudget(notice(),grant(),{...view(),playEpoch:9},100),0);
 assert.equal(petFeedbackBudget(notice(),grant(),{...view(),visible:false},100),0);
});
test('playback subtracts the full round trip and never extends the host expiration',()=>{
 assert.equal(petFeedbackBudget(notice(),{...grant(),remainingMs:1200},view(),250),950);
 assert.equal(petFeedbackBudget(notice(),grant(),view(),1800),0);
 for(const elapsed of [-1,NaN,Infinity])assert.equal(petFeedbackBudget(notice(),grant(),view(),elapsed),0);
 for(const remainingMs of [0,-1,Infinity,2001])assert.equal(petFeedbackBudget(notice(),{...grant(),remainingMs},view(),0),0);
});
test('a late or mismatched grant is rejected after a newer authoritative revision',()=>{
 for(const patch of [{feedbackId:'other-id'},{workspaceEpoch:'old-root'},{playEpoch:6},{kind:'found'},{stateRevision:3}])assert.equal(petFeedbackBudget(notice(),{...grant(),...patch},view(),0),0);
 assert.equal(petFeedbackBudget(notice(),grant(),{...view(),stateRevision:5},0),0);
});
