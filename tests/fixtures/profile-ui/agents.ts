import type {AgentConfig,AgentId} from '../../../src/domain/agents';
const saved:Partial<Record<AgentId,AgentConfig>>={},trials:Record<string,any>={};let sequence=0;
function defaults(id:AgentId):AgentConfig{return {version:1,agentId:id,revision:`default-1-${id}`,modelId:null,preferences:{detail:'standard',focus:id==='organizer'?'balanced':id==='tracker'?'evidence':'deadline'},supplementalInstructions:''};}
export function agentFixture(command:string,args:any,modelConfig?:any):unknown{
 const id=(args?.agentId||args?.input?.agentId) as AgentId;
 if(command==='read_agent_configuration')return saved[id]||defaults(id);
 if(command==='save_agent_configuration'||command==='reset_agent_configuration'){
  const current=saved[id]||defaults(id);if(current.revision!==(args.expectedRevision||args.input.expectedRevision))throw {code:'AGENT_VERSION_CONFLICT',message:'合成场景：配置已有新版本。'};
  const c:AgentConfig=command==='reset_agent_configuration'?defaults(id):{version:1,agentId:id,revision:'',modelId:args.input.modelId,preferences:args.input.preferences,supplementalInstructions:args.input.supplementalInstructions};c.revision=`fixture-agent-${++sequence}`;saved[id]=c;return {configuration:c,warning:null};
 }
 if(command==='active_agent_trial')return null;
 if(command==='latest_agent_trial')return Object.values(trials).findLast(r=>r.agentId===id)||null;
 if(command==='read_agent_trial'||command==='cancel_agent_trial')return trials[args.id];
 if(command==='start_agent_trial'){
  const c=saved[id]||defaults(id);const key=`fixture-trial-${++sequence}`;const run={id:key,agentId:id,purpose:'role_trial',status:'succeeded',snapshot:{modelId:c.modelId||'default',revision:modelConfig?.revision,model:modelConfig?.models.models.find((m:any)=>m.id===(c.modelId||modelConfig?.defaultModelId)),agent:c,...(id==='tracker'?{trackerSample:{version:1,todos:[{id:'sample-action',version:1,title:'整理接入清单',kind:'action',owner:'我',status:'open',submission:'尚未提交',acceptance:'尚未验收'},{id:'sample-followup',version:1,title:'修复SDK鉴权',kind:'followup',owner:'林川',status:'open',submission:'尚未提交',acceptance:'尚未验收'}]}}:{})},input:args.input,result:[{fields:{title:'合成预览：整理接入清单',kind:'action',owner:'我',priority:'medium',tags:[],due:null,followup:null},evidence:args.input.text.split('\n')[0],dueExpression:null,followupExpression:null,warnings:[],unresolved:false}],errorCode:null,createdAtMs:Date.now(),finishedAtMs:Date.now()};if(id==='tracker'){run.result=null as any;(run as any).roleResult={kind:'tracker',version:1,suggestions:new URLSearchParams(location.search).has('trackerEmpty')?[]:[{todoId:'sample-followup',todoVersion:1,change:'submission',summary:'提交待验收，请先核对线索。',evidence:args.input.text.split('，')[0]}]};if(new URLSearchParams(location.search).has('trackerError')){run.status='failed';run.errorCode='MODEL_INVALID_OUTPUT' as any;(run as any).roleResult=null;}}trials[key]=run;return run;
 }
 return undefined;
}
