import {dirname,sep} from 'node:path';
import {realpath} from 'node:fs/promises';
export function createSkillRead(cwd,skills,createRead,resolveReadPath,onRead=()=>{}){
 let base=cwd;const root=skills?.root?dirname(skills.root):null;
 const tool=createRead(cwd);
 return {...tool,executionMode:'sequential',async execute(id,args,signal,onUpdate){
  const path=await resolveReadPath(args.path,base);
  const result=await createRead(cwd).execute(id,{...args,path},signal,onUpdate);
  if(root&&(path===root||path.startsWith(root+sep))){const actual=await realpath(path).catch(()=>null);if(actual&&(actual===root||actual.startsWith(root+sep))){base=dirname(actual);onRead(actual);}}
  return result;
 }};
}
