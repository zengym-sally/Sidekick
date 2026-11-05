import assert from 'node:assert/strict';
import test from 'node:test';
import {createPetWindow} from '../../src/stores/pet.ts';

const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function fixture(t){
 const calls=[],listeners=new Map();let claim=null;
 const view={clientEpoch:0,sequence:1,playEpoch:7,maskSequence:0,policySequence:0,visible:true,edge:'free',collapsed:false,dragging:false,menuOpen:false,workMode:false,artworkLeft:40,artworkTop:30};
 const state={workspaceEpoch:'synthetic-root',stateRevision:4,factsKnown:true,pendingCandidateCount:2,warning:null,view};
 const copy=()=>structuredClone(state),api=async(command,args)=>{
  calls.push({command,args});
  if(command==='read_pet_state')return copy();
  if(command==='attach_pet_client'){
   if(args.expectedClientEpoch!==view.clientEpoch)return {attached:false,snapshot:copy()};
   ++view.clientEpoch;++view.sequence;++view.playEpoch;view.maskSequence=0;view.policySequence=0;
   return {attached:true,snapshot:copy()};
  }
  if(command==='set_pet_hit_mask'){view.maskSequence=args.request.sequence;return {...view};}
  if(command==='confirm_pet_presentation')return {...view};
  if(command==='set_pet_policy'){view.policySequence=args.request.sequence;return {...view};}
  if(command==='claim_pet_feedback')return claim?claim.promise:null;
  if(command==='prepare_pet_menu'){view.menuOpen=true;++view.sequence;++view.playEpoch;return {token:1,view:{...view}};}
  if(command==='popup_pet_menu'){view.menuOpen=false;++view.sequence;++view.playEpoch;return {...view};}
  if(command==='prepare_pet_drag'){view.dragging=true;++view.sequence;++view.playEpoch;return {token:1,view:{...view}};}
  if(command==='start_pet_drag')return {...view};
  throw Error(command);
 };
 const subscribe=async(name,changed)=>{listeners.set(name,changed);return ()=>listeners.delete(name);};
 const model=createPetWindow(api,subscribe);
 t.after(()=>model.dispose());
 const renderer={mask:async()=>Array(112*112).fill(1),paint:async()=>{}};
 return {model,api,calls,listeners,state,view,copy,renderer,set claim(v){claim=v;},emit:async(name,payload)=>listeners.get(name)?.(payload)};
}
test('pet subscribes before first snapshot and presents real pending state',async t=>{
 const f=fixture(t);await f.model.start(f.renderer,{reducedMotion:false,pageVisible:true});
 assert.equal(f.listeners.size,3);assert.equal(f.model.pose.value,'found');assert.equal(f.model.motion.value,'idle');
 assert.equal(f.calls.filter(c=>c.command==='attach_pet_client').length,1);
 assert.ok(f.calls.some(c=>c.command==='set_pet_hit_mask'));assert.ok(f.calls.some(c=>c.command==='confirm_pet_presentation'));
});
test('late snapshot cannot overwrite a newer read',async t=>{
 const f=fixture(t);await f.model.start(f.renderer,{reducedMotion:false,pageVisible:true});
 const a=deferred(),b=deferred();let sequence=0;
 const model=createPetWindow(async(command,args)=>command==='read_pet_state'?++sequence===1?a.promise:b.promise:f.api(command,args),async()=>()=>{});
 t.after(()=>model.dispose());
 const first=model.refresh(),second=model.refresh();
 b.resolve({...f.copy(),stateRevision:6,pendingCandidateCount:0});await second;
 a.resolve({...f.copy(),stateRevision:5,pendingCandidateCount:9});await first;
 assert.equal(model.snapshot.value.stateRevision,6);assert.equal(model.snapshot.value.pendingCandidateCount,0);
});
test('late grant is not replayed after a collapse and new playable epoch',async t=>{
 const f=fixture(t);await f.model.start(f.renderer,{reducedMotion:false,pageVisible:true});
 const claim=deferred();f.claim=claim;const notice={workspaceEpoch:'synthetic-root',commitRevision:4,playEpoch:f.view.playEpoch,feedbackId:'synthetic-feedback',kind:'done'};
 const receive=f.emit('pet-feedback',notice);
 await Promise.resolve();
 f.view.collapsed=true;++f.view.sequence;++f.view.playEpoch;await f.emit('pet-view-changed',{...f.view});
 f.view.collapsed=false;++f.view.sequence;++f.view.playEpoch;await f.emit('pet-view-changed',{...f.view});
 claim.resolve({...notice,stateRevision:4,remainingMs:1500});await receive;
 assert.notEqual(f.model.motion.value,'done');assert.equal(f.model.pose.value,'found');
});
test('native menu is prepared and painted before popup',async t=>{
 const f=fixture(t);await f.model.start(f.renderer,{reducedMotion:false,pageVisible:true});
 f.calls.length=0;f.renderer.paint=async()=>{f.calls.push({command:'paint'});};
 assert.equal(await f.model.openMenu(true),true);
 const prepare=f.calls.findIndex(c=>c.command==='prepare_pet_menu'),paint=f.calls.findIndex(c=>c.command==='paint'),popup=f.calls.findIndex(c=>c.command==='popup_pet_menu');
 assert.ok(prepare>=0&&paint>prepare&&popup>paint);assert.equal(f.model.motion.value,'idle');
 assert.equal(f.calls[popup].args.request.clientEpoch,f.view.clientEpoch);
});
test('disposing during subscription cleans late listeners and never starts reads',async()=>{
 const wait=deferred(),calls=[];let stopped=0;
 const model=createPetWindow(async command=>{calls.push(command);},async()=>{await wait.promise;return ()=>++stopped;});
 const start=model.start({mask:async()=>[],paint:async()=>{}},{reducedMotion:false,pageVisible:true});
 model.dispose();wait.resolve();await start;
 assert.equal(stopped,3);assert.deepEqual(calls,[]);
});
test('source invalidation cancels an in-flight claim before the corrective read returns',async t=>{
 const f=fixture(t),claim=deferred(),read=deferred();let holdRead=false;
 const model=createPetWindow(async(command,args)=>command==='read_pet_state'&&holdRead?read.promise:f.api(command,args),async(name,changed)=>{f.listeners.set(name,changed);return ()=>f.listeners.delete(name);});
 t.after(()=>model.dispose());await model.start(f.renderer,{reducedMotion:false,pageVisible:true});
 f.claim=claim;
 const notice={workspaceEpoch:'synthetic-root',commitRevision:4,playEpoch:f.view.playEpoch,feedbackId:'invalidated-in-flight',kind:'done'};
 const receiving=f.emit('pet-feedback',notice);await Promise.resolve();
 holdRead=true;
 const invalidating=f.emit('pet-state-changed',{workspaceEpoch:'synthetic-root',invalidatedFeedbackId:notice.feedbackId});
 claim.resolve({...notice,stateRevision:4,remainingMs:1500});await receiving;
 assert.notEqual(model.motion.value,'done');assert.notEqual(model.pose.value,'done');
 read.resolve({...f.copy(),stateRevision:5});await invalidating;
});
test('failed feedback presentation cannot be retried as a stale success pose',async t=>{
 const f=fixture(t);let clock=0,failNext=false;
 const model=createPetWindow(async(command,args)=>{if(command==='set_pet_hit_mask'&&failNext){failNext=false;throw Error('synthetic mask failure');}return f.api(command,args);},async(name,changed)=>{f.listeners.set(name,changed);return ()=>f.listeners.delete(name);},()=>clock);
 t.after(()=>model.dispose());await model.start(f.renderer,{reducedMotion:false,pageVisible:true});
 const claim=deferred();f.claim=claim;failNext=true;
 const notice={workspaceEpoch:'synthetic-root',commitRevision:4,playEpoch:f.view.playEpoch,feedbackId:'failed-presentation',kind:'done'};
 const receive=f.emit('pet-feedback',notice);claim.resolve({...notice,stateRevision:4,remainingMs:1000});await receive;
 clock=3000;await model.refresh();assert.equal(model.pose.value,'found');assert.notEqual(model.motion.value,'done');
});
test('an active success pose is cleared before a hanging invalidation read completes',async t=>{
 const f=fixture(t),claim=deferred(),read=deferred();let holdRead=false;
 const model=createPetWindow(async(command,args)=>command==='read_pet_state'&&holdRead?read.promise:f.api(command,args),async(name,changed)=>{f.listeners.set(name,changed);return ()=>f.listeners.delete(name);});
 t.after(()=>model.dispose());await model.start(f.renderer,{reducedMotion:false,pageVisible:true});f.claim=claim;
 const notice={workspaceEpoch:'synthetic-root',commitRevision:4,playEpoch:f.view.playEpoch,feedbackId:'active-invalidated',kind:'done'};
 const receive=f.emit('pet-feedback',notice);claim.resolve({...notice,stateRevision:4,remainingMs:1500});await receive;assert.equal(model.pose.value,'done');
 holdRead=true;const invalidating=f.emit('pet-state-changed',{workspaceEpoch:'synthetic-root',invalidatedFeedbackId:notice.feedbackId});
 for(let i=0;i<30;i++)await Promise.resolve();assert.equal(model.pose.value,'found');
 read.resolve({...f.copy(),stateRevision:5});await invalidating;
});
test('pending mark stays independent of a completed gesture',async t=>{
 const f=fixture(t),claim=deferred();await f.model.start(f.renderer,{reducedMotion:false,pageVisible:true});f.claim=claim;
 const notice={workspaceEpoch:'synthetic-root',commitRevision:4,playEpoch:f.view.playEpoch,feedbackId:'done-with-pending',kind:'done'};
 const receive=f.emit('pet-feedback',notice);claim.resolve({...notice,stateRevision:4,remainingMs:1500});await receive;
 assert.equal(f.model.pose.value,'done');assert.equal(f.model.hasPending.value,true);
 f.state.pendingCandidateCount=1;++f.state.stateRevision;await f.model.refresh();assert.equal(f.model.hasPending.value,true);
 f.state.pendingCandidateCount=0;++f.state.stateRevision;await f.model.refresh();assert.equal(f.model.hasPending.value,false);
});
test('visibility changes during startup are not overwritten by the initial hidden policy',async t=>{
 const f=fixture(t),subscriptions=deferred();
 const model=createPetWindow(f.api,async(name,changed)=>{await subscriptions.promise;f.listeners.set(name,changed);return ()=>f.listeners.delete(name);});
 t.after(()=>model.dispose());const start=model.start(f.renderer,{reducedMotion:false,pageVisible:false});
 await model.setPolicy({reducedMotion:false,pageVisible:true});subscriptions.resolve();await start;
 const applied=f.calls.filter(c=>c.command==='set_pet_policy').at(-1);assert.equal(applied.args.request.pageVisible,true);assert.equal(model.motion.value,'idle');
});
test('a stale view cannot roll back an acknowledged policy with the same layout sequence',async t=>{
 const f=fixture(t);await f.model.start(f.renderer,{reducedMotion:false,pageVisible:true});const old={...f.view};
 await f.model.setPolicy({reducedMotion:false,pageVisible:true,keyboardFocused:true});const newest=f.view.policySequence;
 await f.emit('pet-view-changed',old);assert.equal(f.model.view.value.policySequence,newest);
});

test('drag expands and paints before the native drag request',async t=>{
 const f=fixture(t);await f.model.start(f.renderer,{reducedMotion:false,pageVisible:true});f.calls.length=0;f.renderer.paint=async()=>{f.calls.push({command:'paint'});};
 assert.equal(await f.model.startDrag(),true);const commands=f.calls.map(c=>c.command);assert.ok(commands.indexOf('prepare_pet_drag')<commands.indexOf('paint'));assert.ok(commands.indexOf('paint')<commands.indexOf('start_pet_drag'));assert.equal(f.model.view.value.dragging,true);
});
test('release before the native drag request is a quiet cancellation',async t=>{
 const f=fixture(t);const model=createPetWindow(async(command,args)=>{if(command==='prepare_pet_drag')throw {code:'PET_DRAG_RELEASED',message:'拖动已结束。'};return f.api(command,args);},async()=>()=>{});
 t.after(()=>model.dispose());await model.start(f.renderer,{reducedMotion:false,pageVisible:true});assert.equal(await model.startDrag(),false);assert.equal(model.error.value,'');
});
