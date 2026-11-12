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
test('advisor trials use the saved role and keep their synthetic guidance independent',async()=>{
 const calls=[];const s=createAgentSettings(async(command,args)=>{calls.push({command,args});if(command==='read_agent_configuration')return config(args.agentId);if(command==='latest_agent_trial')return null;if(command==='start_agent_trial')return trial({id:'advisor-A',agentId:'advisor',input:args.input});throw Error(command);});
 await s.select('tracker');s.sample.value='tracker clues';await s.select('advisor');s.sample.value='请给出合成事项的排序与依据。';await s.startTrial();assert.equal(calls.at(-1).args.agentId,'advisor');assert.equal(s.trials.advisor.id,'advisor-A');assert.equal(calls.at(-1).args.input.text,'请给出合成事项的排序与依据。');await s.select('tracker');assert.equal(s.sample.value,'tracker clues');
});
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
test('the process-isolated Pinia agents store uses Web configuration and leaves unwired role trials unavailable',async()=>{
 const previousWindow=Object.getOwnPropertyDescriptor(globalThis,'window'),previousFetch=Object.getOwnPropertyDescriptor(globalThis,'fetch'),calls=[];let s;
 assert.throws(()=>useAgents(),/no active Pinia/);
 try{
  Object.defineProperty(globalThis,'window',{configurable:true,writable:true,value:{location:{host:'agents.test',origin:'http://agents.test'},__TAURI_INTERNALS__:{invoke:async()=>{throw Error('Unexpected native transport');}}}});
  globalThis.fetch=async(url)=>{calls.push(String(url));return new Response(JSON.stringify({contractVersion:'web-api/2',configuration:config('organizer')}),{status:200,headers:{'content-type':'application/json'}});};
  const app=createApp({});app.use(createPinia());s=app.runWithContext(()=>useAgents());await s.load('organizer');await s.select('organizer');await s.refreshTrial();
  assert.deepEqual(s.states.organizer.config,config('organizer'));assert.equal(s.trials.organizer,null);assert.equal(s.running,false);assert.deepEqual(calls,['/api/agents/organizer']);
 }finally{
  s?.$dispose();setActivePinia(undefined);if(previousWindow)Object.defineProperty(globalThis,'window',previousWindow);else delete globalThis.window;if(previousFetch)Object.defineProperty(globalThis,'fetch',previousFetch);else delete globalThis.fetch;
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

test('advisor poll and cancel stay with the active run after switching to tracker',async()=>{
 const calls=[],active=trial({id:'advisor-active',agentId:'advisor'});const s=createAgentSettings(async(command,args)=>{calls.push({command,args});if(command==='read_agent_configuration')return config(args.agentId);if(command==='latest_agent_trial'||command==='active_agent_trial')return null;if(command==='read_agent_trial')return active;if(command==='cancel_agent_trial')return {...active,status:'cancelled'};throw Error(command);});s.trials.advisor=active;await s.select('tracker');await s.refreshTrial();assert.equal(calls.at(-1).args.id,'advisor-active');await s.cancelTrial();assert.equal(s.trials.advisor.status,'cancelled');assert.equal(s.trials.tracker,null);
});
test('a late advisor start response cannot overwrite a newer polled run',async()=>{
 const start=deferred(),newer=trial({id:'advisor-new',agentId:'advisor',createdAtMs:5});const s=createAgentSettings(async(command,args)=>{if(command==='read_agent_configuration')return config(args.agentId);if(command==='latest_agent_trial')return null;if(command==='start_agent_trial')return start.promise;if(command==='active_agent_trial')return newer.id;if(command==='read_agent_trial')return newer;throw Error(command);});await s.select('advisor');s.sample.value='合成指导';const pending=s.startTrial();await s.select('tracker');await s.refreshTrial();start.resolve(trial({id:'advisor-old',agentId:'advisor',createdAtMs:1}));await pending;assert.equal(s.trials.advisor.id,'advisor-new');assert.equal(s.selected.value,'tracker');
});
test('an unknown advisor save blocks a new trial and retains guidance until reconciliation',async()=>{
 let starts=0;const s=createAgentSettings(async(command,args)=>{if(command==='read_agent_configuration')return config(args.agentId);if(command==='latest_agent_trial')return null;if(command==='start_agent_trial'){starts++;return trial({agentId:'advisor'});}throw Error('synthetic lost save');});await s.select('advisor');s.sample.value='keep advisor guidance';s.current.value.draft.supplementalInstructions='keep saved draft';await assert.rejects(s.save());await assert.rejects(s.startTrial());assert.equal(starts,0);assert.equal(s.sample.value,'keep advisor guidance');assert.equal(s.current.value.draft.supplementalInstructions,'keep saved draft');
});

const ownershipConfig=id=>({version:1,agentId:id,revision:'r',modelId:null,preferences:{detail:'standard',focus:id==='advisor'?'deadline':'balanced'},supplementalInstructions:''});
const ownershipRun=(id,status='running',createdAtMs=10)=>({id,agentId:'advisor',purpose:'role_trial',status,snapshot:{},input:{text:'synthetic',timeZone:'Asia/Shanghai',sourceAtMs:null},result:null,errorCode:null,createdAtMs,finishedAtMs:status==='running'?null:11});
const ownershipDeferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
for (const olderTimestamp of [9,10]) test(`late start A must not replace polled B, A=${olderTimestamp}, B=10`,async()=>{
 const start=ownershipDeferred();const s=createAgentSettings(async(command,args)=>{if(command==='read_agent_configuration')return ownershipConfig(args.agentId);if(command==='latest_agent_trial')return null;if(command==='start_agent_trial')return start.promise;if(command==='active_agent_trial')return 'B';if(command==='read_agent_trial')return ownershipRun('B');throw Error(command);});
 await s.select('advisor');const pending=s.startTrial();await s.refreshTrial();assert.equal(s.trials.advisor.id,'B');start.resolve(ownershipRun('A','running',olderTimestamp));await pending;assert.equal(s.trials.advisor.id,'B');
});
test('an explicit new start must not be rejected when host wall clock moves backwards',async()=>{
 const calls=[];const s=createAgentSettings(async(command,args)=>{calls.push({command,args});if(command==='read_agent_configuration')return ownershipConfig(args.agentId);if(command==='latest_agent_trial')return ownershipRun('old','succeeded',10);if(command==='start_agent_trial')return ownershipRun('new','running',9);throw Error(command);});
 await s.select('advisor');await s.startTrial();assert.equal(s.trials.advisor.id,'new');assert.equal(s.running.value,true);
});
test('late latest A must not replace polled B at the same createdAtMs',async()=>{
 const latest=ownershipDeferred();const s=createAgentSettings(async(command,args)=>{if(command==='read_agent_configuration')return ownershipConfig(args.agentId);if(command==='latest_agent_trial')return latest.promise;if(command==='active_agent_trial')return 'B';if(command==='read_agent_trial')return ownershipRun('B');throw Error(command);});
 await s.load('advisor');const selecting=s.select('advisor');await s.refreshTrial();latest.resolve(ownershipRun('A','succeeded'));await selecting;assert.equal(s.trials.advisor.id,'B');assert.equal(s.running.value,true);
});
test('late poll A must not replace B from a newer latest response at equal timestamps',async()=>{
 const read=ownershipDeferred();const s=createAgentSettings(async(command,args)=>{if(command==='read_agent_configuration')return ownershipConfig(args.agentId);if(command==='latest_agent_trial')return ownershipRun('B');if(command==='active_agent_trial')return 'A';if(command==='read_agent_trial')return read.promise;throw Error(command);});
 const poll=s.refreshTrial();await s.select('advisor');read.resolve(ownershipRun('A','succeeded'));await poll;assert.equal(s.trials.advisor.id,'B');assert.equal(s.running.value,true);
});

test('a fresh latest read restores a newer persisted ID even after a host clock rollback',async()=>{const s=createAgentSettings(async(command,args)=>{if(command==='read_agent_configuration')return config(args.agentId);if(command==='latest_agent_trial')return ownershipRun('new-history','succeeded',9);throw Error(command);});s.trials.advisor=ownershipRun('old-history','succeeded',10);await s.select('advisor');assert.equal(s.trials.advisor.id,'new-history');});
for(const newerFirst of [false,true])test(`only the newest latest request owns a role response / newerFirst=${newerFirst}`,async()=>{const old=deferred(),fresh=deferred();let reads=0;const s=createAgentSettings(async(command,args)=>{if(command==='read_agent_configuration')return config(args.agentId);if(command==='latest_agent_trial')return reads++===0?old.promise:fresh.promise;throw Error(command);});await s.load('advisor');const a=s.select('advisor'),b=s.select('advisor');if(newerFirst){fresh.resolve(ownershipRun('new-history','succeeded',9));await b;old.resolve(ownershipRun('old-history','succeeded',10));await a;}else{old.resolve(ownershipRun('old-history','succeeded',10));await a;fresh.resolve(ownershipRun('new-history','succeeded',9));await b;}assert.equal(s.trials.advisor.id,'new-history');});
test('after an equal-time late start cancellation still targets the polled active ID',async()=>{const pending=deferred(),cancelled=[];const s=createAgentSettings(async(command,args)=>{if(command==='read_agent_configuration')return config(args.agentId);if(command==='latest_agent_trial')return null;if(command==='start_agent_trial')return pending.promise;if(command==='active_agent_trial')return 'active-B';if(command==='read_agent_trial')return ownershipRun('active-B');if(command==='cancel_agent_trial'){cancelled.push(args.id);return ownershipRun(args.id,'cancelled');}throw Error(command);});await s.select('advisor');const start=s.startTrial();await s.refreshTrial();pending.resolve(ownershipRun('old-A'));await start;await s.cancelTrial();assert.deepEqual(cancelled,['active-B']);assert.equal(s.trials.advisor.status,'cancelled');});

test('a late start error cannot replace the error state of a polled newer run',async()=>{let rejectStart;const s=createAgentSettings(async(command,args)=>{if(command==='read_agent_configuration')return config(args.agentId);if(command==='latest_agent_trial')return null;if(command==='start_agent_trial')return new Promise((_,reject)=>rejectStart=reject);if(command==='active_agent_trial')return 'new-B';if(command==='read_agent_trial')return ownershipRun('new-B');throw Error(command);});await s.select('advisor');const start=s.startTrial().catch(()=>{});await s.refreshTrial();s.trialError.value='new run notice';rejectStart(Error('old start failed'));await start;assert.equal(s.trialError.value,'new run notice');assert.equal(s.trials.advisor.id,'new-B');});
for(const fails of [false,true])test(`a late poll cannot rewrite a newer run error state / fails=${fails}`,async()=>{let rejectRead;const read=deferred();const s=createAgentSettings(async(command,args)=>{if(command==='read_agent_configuration')return config(args.agentId);if(command==='latest_agent_trial')return ownershipRun('new-B');if(command==='active_agent_trial')return 'old-A';if(command==='read_agent_trial')return fails?new Promise((_,reject)=>rejectRead=reject):read.promise;throw Error(command);});const poll=s.refreshTrial();await s.select('advisor');s.trialError.value='new run notice';if(fails)rejectRead(Error('old poll failed'));else read.resolve(ownershipRun('old-A','succeeded'));await poll;assert.equal(s.trialError.value,'new run notice');assert.equal(s.trials.advisor.id,'new-B');});

for(const role of ['organizer','tracker','advisor'])test(`a same-ID unknown reconciliation clears a temporary read error without replacing facts / ${role}`,async()=>{let unavailable=false;const terminal=trial({id:`${role}-unknown`,agentId:role,status:'failed',errorCode:'MCP_RESULT_UNKNOWN',finishedAtMs:3,snapshot:{checkpoint:'persisted unknown'}});const s=createAgentSettings(async(command,args)=>{if(command==='read_agent_configuration')return config(args.agentId);if(command==='latest_agent_trial')return terminal;if(command==='active_agent_trial')return null;if(command==='read_agent_trial'){if(unavailable)throw Error('temporary read failure');return terminal;}throw Error(command);});await s.select(role);const before=structuredClone(JSON.parse(JSON.stringify(s.trials[role])));unavailable=true;await s.refreshTrial();assert.match(s.trialError.value,/temporary read failure/);unavailable=false;await s.refreshTrial();assert.equal(s.trialError.value,'');assert.deepEqual(s.trials[role],before);assert.equal(s.trials[role].errorCode,'MCP_RESULT_UNKNOWN');});
for(const status of ['succeeded','cancelled','interrupted'])test(`a same-ID ordinary terminal reconciliation clears its temporary read error / ${status}`,async()=>{let unavailable=false;const terminal=ownershipRun('ordinary-terminal',status);const s=createAgentSettings(async(command,args)=>{if(command==='read_agent_configuration')return config(args.agentId);if(command==='latest_agent_trial')return terminal;if(command==='active_agent_trial')return null;if(command==='read_agent_trial'){if(unavailable)throw Error('temporary read failure');return terminal;}throw Error(command);});await s.select('advisor');unavailable=true;await s.refreshTrial();unavailable=false;await s.refreshTrial();assert.equal(s.trialError.value,'');assert.deepEqual(s.trials.advisor,terminal);});
