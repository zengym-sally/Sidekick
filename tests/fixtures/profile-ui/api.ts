import { organizerFixture } from './organizer';
import {agentFixture} from './agents';
import {skillsFixture} from './skills';
import {mcpFixture} from './mcp';
import {todayFixture,configureTodayRows} from './today';
import {todayRows} from '../today-advice.mjs';
const parameters=new URLSearchParams(location.search);
let initialized=!parameters.has('onboarding');
const rows:unknown[]=parameters.has('todayFixture')&&!parameters.has('todayEmptyList')?todayRows():[];
if(parameters.has('todayLong')&&rows.length)(rows[0] as {data:{title:string}}).data.title='合成跨部门交付与验收资料核对'.repeat(10);
const workspace=()=>({needsSetup:!initialized,root:initialized?'/fixture/sidekick':null,defaultRoot:'/fixture/sidekick',pendingRoot:null});
let applicationSettings={timeZone:'Asia/Shanghai'};
configureTodayRows(rows,applicationSettings.timeZone);let todoReads=0;
const defaults=()=>({version:1,name:'小明同学',address:'BOSS'});
export async function invoke(command:string,args?:Record<string,unknown>){
  const advice=await todayFixture(command,args,rows,applicationSettings.timeZone);if(advice!==undefined)return JSON.parse(JSON.stringify(advice));
  const mcp=mcpFixture(command,args);if(mcp!==undefined)return mcp;
  const skillResult=skillsFixture(command,args);if(skillResult!==undefined)return skillResult;
  if(command==='read_application_settings')return structuredClone(applicationSettings);
  if(command==='save_application_settings'){if(parameters.has('settingsUncertain')){applicationSettings={timeZone:(args?.input as {timeZone:string}).timeZone};throw {code:'SETTINGS_UNCERTAIN',message:'合成场景：请读回核对通用设置。'};}if(parameters.has('settingsSaveError'))throw {code:'WORKSPACE_IO',message:'合成场景：通用设置暂时无法保存。'};applicationSettings={timeZone:(args?.input as {timeZone:string}).timeZone};return {settings:structuredClone(applicationSettings),warning:null};}
  if(command==='open_workspace_directory')return;
  const agent=agentFixture(command,args?JSON.parse(JSON.stringify(args)):args,command==='start_agent_trial'?organizerFixture('read_model_configuration',undefined,rows):undefined);if(agent!==undefined)return JSON.parse(JSON.stringify(agent));
  const organized=organizerFixture(command,args?JSON.parse(JSON.stringify(args)):args,rows);if(organized!==undefined)return JSON.parse(JSON.stringify(organized));
  if(command==='workspace_info')return workspace();
  if(command==='initialize_workspace'){initialized=true;return workspace();}
  if(command==='list_todos'){if(parameters.has('todayBoundaryOwnership')&&++todoReads===2)configureTodayRows(rows,applicationSettings.timeZone,true);return structuredClone(rows);}
  if(command==='create_todo'){
    const input=args?.input as {tags:string[]};
    const todo={id:crypto.randomUUID(),data:{...input,tags:input.tags.filter(Boolean)},version:1,status:'open',source:'manual',createdAtMs:Date.now(),updatedAtMs:Date.now(),completedAtMs:null,deletedAtMs:null};
    rows.push(todo);return todo;
  }
  if(command==='read_profile'){
    if(parameters.has('readError'))throw {message:'合成场景：个人配置暂不可读。'};
    const saved=localStorage.getItem('sidekick-profile-ui-fixture');return saved?JSON.parse(saved):defaults();
  }
  if(command==='save_profile'){
    if(parameters.has('saveError'))throw {message:'合成场景：暂时无法保存。'};
    const input=args?.input as {name:string;address:string};const profile={version:1,name:input.name.trim()||'小明同学',address:input.address.trim()||'BOSS'};
    localStorage.setItem('sidekick-profile-ui-fixture',JSON.stringify(profile));return {profile,warning:null};
  }
  throw {message:'此界面夹具不提供该业务命令。'};
}
export async function listen(){return ()=>{};}
export async function open(){return null;}
export async function getVersion(){return '0.3.0（界面样本）';}
