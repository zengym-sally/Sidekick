import assert from 'node:assert/strict';
import test from 'node:test';
import {createApp} from 'vue';
import {createPinia,setActivePinia} from 'pinia';
import {createAgentSettings,useAgents} from '../../src/stores/agents.ts';
const config=id=>({version:1,agentId:id,revision:'old',modelId:null,preferences:{detail:'standard',focus:id==='organizer'?'balanced':id==='tracker'?'evidence':'deadline'},supplementalInstructions:''});
const trial=(overrides={})=>({id:'A',agentId:'organizer',purpose:'role_trial',status:'running',snapshot:{},input:{text:'synthetic trial',timeZone:'Asia/Shanghai',sourceAtMs:null},result:null,errorCode:null,createdAtMs:1,finishedAtMs:null,...overrides});
const unknown=()=>trial({status:'failed',errorCode:'MCP_RESULT_UNKNOWN',finishedAtMs:3,snapshot:{checkpoint:'persisted unknown'}});
function deferred(){let resolve;const promise=new Promise(finish=>resolve=finish);return {promise,resolve};}
test('late role reads cannot select a previous role or replace a newer draft',async()=>{const reads={};const s=createAgentSettings(async(command,args)=>command==='read_agent_configuration'?new Promise(resolve=>reads[args.agentId]=resolve):null);const a=s.select('organizer'),b=s.select('tracker');reads.tracker(config('tracker'));await b;reads.organizer(config('organizer'));await a;assert.equal(s.selected.value,'tracker');assert.equal(s.current.value.config.agentId,'tracker');});
test('saving a role preserves newer input while retaining the committed revision',async()=>{let finish;const s=createAgentSettings(async(command,args)=>command==='read_agent_configuration'?config(args.agentId):command==='latest_agent_trial'?null:new Promise(resolve=>finish=resolve));await s.select('organizer');s.current.value.draft.supplementalInstructions='before';const saved=s.save();s.current.value.draft.supplementalInstructions='newer';finish({configuration:{...config('organizer'),revision:'new',supplementalInstructions:'before'},warning:null});await saved;assert.equal(s.current.value.draft.supplementalInstructions,'newer');assert.equal(s.current.value.config.revision,'new');assert.equal(s.dirty.value,true);});
test('unknown configuration outcomes disable trial until reread without losing the draft',async()=>{const s=createAgentSettings(async(command,args)=>{if(command==='read_agent_configuration')return config(args.agentId);if(command==='latest_agent_trial')return null;throw {code:'AGENT_SAVE_UNCERTAIN',message:'unknown'};});await s.select('organizer');s.current.value.draft.supplementalInstructions='keep';await assert.rejects(s.save());assert.equal(s.current.value.ready,false);assert.equal(s.current.value.draft.supplementalInstructions,'keep');await s.load('organizer');assert.equal(s.current.value.ready,true);assert.equal(s.current.value.draft.supplementalInstructions,'keep');});
test('advisor configuration does not imply that trial is available',async()=>{let calls=0;const s=createAgentSettings(async(command,args)=>{calls++;return command==='read_agent_configuration'?config(args.agentId):null;});await s.select('advisor');const before=calls;await assert.rejects(s.startTrial());assert.equal(calls,before);});
test('a lost save or reset response blocks trials until a read reconciles persisted configuration',async()=>{
 for(const reset of [false,true]){let persisted={...config('organizer'),preferences:{detail:'detailed',focus:'followups'}};let started=false;
 const s=createAgentSettings(async(command,args)=>{if(command==='read_agent_configuration')return persisted;if(command==='latest_agent_trial')return null;if(command==='start_agent_trial'){started=true;return {}};if(command==='save_agent_configuration'||command==='reset_agent_configuration'){persisted={...config('organizer'),revision:'committed'};throw Error('synthetic response lost');}throw Error(command);});
 await s.select('organizer');if(reset)await assert.rejects(s.reset());else await assert.rejects(s.save());assert.equal(s.current.value.ready,false);assert.equal(s.current.value.draft.preferences.detail,'detailed');await assert.rejects(s.startTrial());assert.equal(started,false);await s.load('organizer');assert.equal(s.current.value.config.revision,'committed');assert.equal(s.current.value.ready,true);
 }
});
test('a late cancellation response cannot replace a newer trial after polling reconciles the old run',async()=>{
 let first,second,calls=0;const old={id:'A',agentId:'organizer',status:'running',createdAtMs:1};const newer={...old,id:'B',createdAtMs:2};
 const s=createAgentSettings(async(command,args)=>{if(command==='read_agent_configuration')return config(args.agentId);if(command==='latest_agent_trial'||command==='active_agent_trial')return null;if(command==='read_agent_trial')return {...old,status:'cancelled'};if(command==='start_agent_trial')return newer;if(command==='cancel_agent_trial')return new Promise(resolve=>{if(calls++===0)first=resolve;else second=resolve;});throw Error(command);});
 await s.select('organizer');s.trials.organizer=old;const a=s.cancelTrial(),b=s.cancelTrial();first({...old,status:'cancelled'});await a;await s.refreshTrial();await s.startTrial();second({...old,status:'cancelled'});await b;assert.equal(s.trials.organizer.id,'B');assert.equal(s.running.value,true);
});
for(const late of [
 {status:'running'},
 {status:'queued'},
 {status:'cancelled',finishedAtMs:2},
 {status:'succeeded',finishedAtMs:2,result:[]},
 {status:'failed',finishedAtMs:2,errorCode:'SYNTHETIC_FAILURE'},
 {status:'interrupted',finishedAtMs:2},
 {status:'failed',finishedAtMs:2,errorCode:'MCP_RESULT_UNKNOWN',snapshot:{checkpoint:'older unknown'}},
])test(`a late latest ${late.status}/${late.errorCode||'ordinary'} snapshot cannot replace the same persisted unknown trial`,async()=>{
 const latest=deferred(),persisted=unknown();
 const s=createAgentSettings(async(command,args)=>{if(command==='read_agent_configuration')return config(args.agentId);if(command==='latest_agent_trial')return latest.promise;if(command==='active_agent_trial')return 'A';if(command==='read_agent_trial')return persisted;throw Error(command);});
 await s.load('organizer');const selecting=s.select('organizer');await s.refreshTrial();latest.resolve(trial(late));await selecting;
 assert.deepEqual(s.trials.organizer,persisted);assert.equal(s.running.value,false);
});
test('a late polling read cannot replace an unknown trial read by selection',async()=>{
 const read=deferred(),persisted=unknown();
 const s=createAgentSettings(async(command,args)=>{if(command==='read_agent_configuration')return config(args.agentId);if(command==='latest_agent_trial')return persisted;if(command==='active_agent_trial')return 'A';if(command==='read_agent_trial')return read.promise;throw Error(command);});
 const polling=s.refreshTrial();await s.select('organizer');read.resolve(trial());await polling;
 assert.deepEqual(s.trials.organizer,persisted);assert.equal(s.running.value,false);
});
test('a late start response cannot replace the same unknown trial reconciled by polling',async()=>{
 const start=deferred(),persisted=unknown();
 const s=createAgentSettings(async(command,args)=>{if(command==='read_agent_configuration')return config(args.agentId);if(command==='latest_agent_trial')return null;if(command==='active_agent_trial')return 'A';if(command==='read_agent_trial')return persisted;if(command==='start_agent_trial')return start.promise;throw Error(command);});
 await s.select('organizer');const starting=s.startTrial();await s.refreshTrial();start.resolve(trial());await starting;
 assert.deepEqual(s.trials.organizer,persisted);assert.equal(s.running.value,false);
});
test('a late cancel response cannot replace the same unknown trial reconciled by polling',async()=>{
 const cancel=deferred(),persisted=unknown();
 const s=createAgentSettings(async(command,args)=>{if(command==='read_agent_configuration')return config(args.agentId);if(command==='latest_agent_trial')return trial();if(command==='active_agent_trial')return 'A';if(command==='read_agent_trial')return persisted;if(command==='cancel_agent_trial')return cancel.promise;throw Error(command);});
 await s.select('organizer');const cancelling=s.cancelTrial();await s.refreshTrial();cancel.resolve(trial({status:'cancelled',finishedAtMs:2}));await cancelling;
 assert.deepEqual(s.trials.organizer,persisted);assert.equal(s.running.value,false);
});
for(const status of ['running','queued'])test(`a late latest ${status} snapshot cannot revive an ordinary terminal trial`,async()=>{
 const latest=deferred(),terminal=trial({status:'succeeded',finishedAtMs:3,result:[]});
 const s=createAgentSettings(async(command,args)=>{if(command==='read_agent_configuration')return config(args.agentId);if(command==='latest_agent_trial')return latest.promise;if(command==='active_agent_trial')return 'A';if(command==='read_agent_trial')return terminal;throw Error(command);});
 await s.load('organizer');const selecting=s.select('organizer');await s.refreshTrial();latest.resolve(trial({status}));await selecting;
 assert.deepEqual(s.trials.organizer,terminal);assert.equal(s.running.value,false);
});
test('a late polling read cannot revive an ordinary terminal trial',async()=>{
 const read=deferred(),terminal=trial({status:'cancelled',finishedAtMs:3});
 const s=createAgentSettings(async(command,args)=>{if(command==='read_agent_configuration')return config(args.agentId);if(command==='latest_agent_trial')return terminal;if(command==='active_agent_trial')return 'A';if(command==='read_agent_trial')return read.promise;throw Error(command);});
 const polling=s.refreshTrial();await s.select('organizer');read.resolve(trial());await polling;
 assert.deepEqual(s.trials.organizer,terminal);assert.equal(s.running.value,false);
});
test('a late start response cannot revive the same ordinary terminal trial',async()=>{
 const start=deferred(),terminal=trial({status:'interrupted',finishedAtMs:3});
 const s=createAgentSettings(async(command,args)=>{if(command==='read_agent_configuration')return config(args.agentId);if(command==='latest_agent_trial')return null;if(command==='active_agent_trial')return 'A';if(command==='read_agent_trial')return terminal;if(command==='start_agent_trial')return start.promise;throw Error(command);});
 await s.select('organizer');const starting=s.startTrial();await s.refreshTrial();start.resolve(trial());await starting;
 assert.deepEqual(s.trials.organizer,terminal);assert.equal(s.running.value,false);
});
test('selection can promote an ordinary terminal trial to persisted unknown',async()=>{
 const latest=deferred(),persisted=unknown();
 const s=createAgentSettings(async(command,args)=>{if(command==='read_agent_configuration')return config(args.agentId);if(command==='latest_agent_trial')return latest.promise;throw Error(command);});
 await s.load('organizer');s.trials.organizer=trial({status:'cancelled',finishedAtMs:2});const selecting=s.select('organizer');latest.resolve(persisted);await selecting;
 assert.deepEqual(s.trials.organizer,persisted);
});
test('polling can promote an ordinary terminal trial to persisted unknown',async()=>{
 const persisted=unknown();
 const s=createAgentSettings(async(command)=>{if(command==='active_agent_trial')return 'A';if(command==='read_agent_trial')return persisted;throw Error(command);});
 s.trials.organizer=trial({status:'succeeded',finishedAtMs:2,result:[]});await s.refreshTrial();assert.deepEqual(s.trials.organizer,persisted);
});
test('an explicit new trial replaces an old unknown and invalidates an older selection response',async()=>{
 const latest=deferred(),newer=trial({id:'B',createdAtMs:4});let first=true;
 const s=createAgentSettings(async(command,args)=>{if(command==='read_agent_configuration')return config(args.agentId);if(command==='latest_agent_trial'){if(first){first=false;return unknown();}return latest.promise;}if(command==='start_agent_trial')return newer;throw Error(command);});
 await s.select('organizer');const selecting=s.select('organizer');await s.startTrial();latest.resolve(unknown());await selecting;
 assert.deepEqual(s.trials.organizer,newer);assert.equal(s.running.value,true);
});
test('a late role trial response remains associated with its requested role',async()=>{
 const latest=deferred(),organizer=unknown(),advisor=trial({id:'advisor-run',agentId:'advisor'});
 const s=createAgentSettings(async(command,args)=>{if(command==='read_agent_configuration')return config(args.agentId);if(command==='latest_agent_trial')return args.agentId==='organizer'?latest.promise:advisor;throw Error(command);});
 await s.load('organizer');const selecting=s.select('organizer');await s.select('advisor');latest.resolve(organizer);await selecting;
 assert.equal(s.selected.value,'advisor');assert.deepEqual(s.trials.advisor,advisor);assert.deepEqual(s.trials.organizer,organizer);
});
test('the process-isolated Pinia agents store keeps polling unknown when the Tauri latest response arrives late',async()=>{
 const previousWindow=Object.getOwnPropertyDescriptor(globalThis,'window'),latest=deferred(),persisted=unknown(),calls=[];let s;
 assert.throws(()=>useAgents(),/no active Pinia/);
 try{
  Object.defineProperty(globalThis,'window',{configurable:true,writable:true,value:{__TAURI_INTERNALS__:{invoke:async(command,args)=>{calls.push(command);if(command==='read_agent_configuration')return config(args.agentId);if(command==='latest_agent_trial')return latest.promise;if(command==='active_agent_trial')return 'A';if(command==='read_agent_trial')return persisted;throw Error(command);}}}});
  const app=createApp({});app.use(createPinia());s=app.runWithContext(()=>useAgents());await s.load('organizer');const selecting=s.select('organizer');await s.refreshTrial();latest.resolve(trial());await selecting;
  assert.deepEqual(s.trials.organizer,persisted);assert.equal(s.running,false);assert.deepEqual(calls,['read_agent_configuration','latest_agent_trial','active_agent_trial','read_agent_trial']);
 }finally{
  s?.$dispose();setActivePinia(undefined);if(previousWindow)Object.defineProperty(globalThis,'window',previousWindow);else delete globalThis.window;
 }
 assert.throws(()=>useAgents(),/no active Pinia/);
});

test('tracker trials use their selected configuration and keep independent synthetic clues',async()=>{
 const calls=[];const s=createAgentSettings(async(command,args)=>{calls.push({command,args});if(command==='read_agent_configuration')return config(args.agentId);if(command==='latest_agent_trial')return null;if(command==='start_agent_trial')return trial({id:'tracker-A',agentId:'tracker',input:args.input});throw Error(command);});
 await s.select('organizer');const original=s.sample.value;await s.select('tracker');s.sample.value='林川已提交SDK鉴权修复，等待我验收。';await s.startTrial();
 assert.equal(s.trials.tracker.agentId,'tracker');assert.equal(calls.at(-1).args.agentId,'tracker');assert.equal(calls.at(-1).args.input.text,'林川已提交SDK鉴权修复，等待我验收。');
 await s.select('organizer');assert.equal(s.sample.value,original);
});
test('poll and cancel follow an active tracker even after selecting another role',async()=>{
 const calls=[],active=trial({id:'tracker-A',agentId:'tracker'});const s=createAgentSettings(async(command,args)=>{calls.push({command,args});if(command==='read_agent_configuration')return config(args.agentId);if(command==='latest_agent_trial')return null;if(command==='active_agent_trial')return null;if(command==='read_agent_trial')return active;if(command==='cancel_agent_trial')return {...active,status:'cancelled'};throw Error(command);});
 s.trials.tracker=active;await s.select('organizer');await s.refreshTrial();assert.equal(calls.at(-1).args.id,'tracker-A');await s.cancelTrial();assert.equal(calls.at(-1).args.id,'tracker-A');assert.equal(s.trials.tracker.status,'cancelled');assert.equal(s.trials.organizer,null);
});

test('a late tracker cancellation cannot replace its newer run after a role switch',async()=>{
 const cancel=deferred(),old=trial({id:'tracker-A',agentId:'tracker'}),newer=trial({id:'tracker-B',agentId:'tracker',createdAtMs:5});
 const s=createAgentSettings(async(command,args)=>{if(command==='read_agent_configuration')return config(args.agentId);if(command==='latest_agent_trial'||command==='active_agent_trial')return null;if(command==='cancel_agent_trial')return cancel.promise;if(command==='read_agent_trial')return {...old,status:'cancelled'};if(command==='start_agent_trial')return newer;throw Error(command);});
 await s.select('tracker');s.trials.tracker=old;const pending=s.cancelTrial();await s.select('organizer');await s.refreshTrial();await s.select('tracker');await s.startTrial();cancel.resolve({...old,status:'cancelled'});await pending;assert.equal(s.trials.tracker.id,'tracker-B');assert.equal(s.trials.organizer,null);
});
