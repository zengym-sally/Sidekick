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
  const c=saved.organizer||defaults('organizer');const key=`fixture-trial-${++sequence}`;const run={id:key,agentId:'organizer',purpose:'role_trial',status:'succeeded',snapshot:{modelId:c.modelId||'default',revision:modelConfig?.revision,model:modelConfig?.models.models.find((m:any)=>m.id===(c.modelId||modelConfig?.defaultModelId)),agent:c},input:args.input,result:[{fields:{title:'合成预览：整理接入清单',kind:'action',owner:'我',priority:'medium',tags:[],due:null,followup:null},evidence:args.input.text.split('\n')[0],dueExpression:null,followupExpression:null,warnings:[],unresolved:false}],errorCode:null,createdAtMs:Date.now(),finishedAtMs:Date.now()};trials[key]=run;return run;
 }
 return undefined;
}
