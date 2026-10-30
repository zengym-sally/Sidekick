import {readFileSync} from 'node:fs';
import {access} from 'node:fs/promises';
import {join} from 'node:path';
import {loadSkills} from '@sidekick/pi-skills';
import {initializeSkills,scanSkills,freezeSkills,restoreBuiltin} from './skills-store.mjs';
try{
 const raw=readFileSync(0,'utf8');if(raw.length>16384)throw new Error('SKILLS_CONFIG');const request=JSON.parse(raw);
 if(!['scan','snapshot','restore'].includes(request.action))throw new Error('SKILLS_CONFIG');
 await initializeSkills(request.root,request.builtin);
 let value;
 if(request.action==='snapshot'){try{await access(join(request.root,'config/skills-index.json'));}catch{await scanSkills(request.root,loadSkills,{builtin:request.builtin});}value=await freezeSkills(request.root,request.runDirectory,{builtin:request.builtin});}
 else if(request.action==='restore'){const restored=await restoreBuiltin(request.root,request.builtin,request.id,request.expectedHash);value={catalog:await scanSkills(request.root,loadSkills,{builtin:request.builtin,restoreResult:restored}),...restored};}
 else value=await scanSkills(request.root,loadSkills,{builtin:request.builtin});
 process.stdout.write(JSON.stringify({ok:true,value}));
}catch(error){const known=new Set(['SKILLS_PATH','SKILLS_SCAN_REQUIRED','SKILLS_CHANGED','SKILLS_CONFIG','SKILLS_BUNDLE','SKILLS_SCAN_FAILED','SKILLS_RESTORE_UNKNOWN','SKILL_LIMIT']);process.stdout.write(JSON.stringify({ok:false,code:known.has(error.code||error.message)?error.code||error.message:'SKILLS_IO'}));process.exitCode=1;}
