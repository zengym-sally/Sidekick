import {constants} from 'node:fs';
import {mkdir,lstat,realpath,open,writeFile,rename,readdir,unlink,rm,chmod} from 'node:fs/promises';
import {join,resolve,relative,dirname,sep,isAbsolute} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';

const MAX_FILES=4096,MAX_BYTES=64*1024*1024,MAX_FILE=2*1024*1024,MAX_METADATA=16*1024*1024,MAX_RESPONSE=2_000_000;
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const sorted=files=>files.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
const treeHash=files=>digest(JSON.stringify(sorted([...files]).map(f=>[f.path,f.sha256,f.executable||false])));
const validId=value=>typeof value==='string'&&/^[a-z0-9][a-z0-9-]{0,63}$/.test(value);
const inside=(root,path)=>path===root||path.startsWith(root+sep);
const fail=code=>Object.assign(new Error(code),{code});
const messages={SKILL_LINK:'目录或文件含链接，未加载。',SKILL_LIMIT:'技能文件数量或体积超出限制。',SKILL_INVALID:'技能入口格式无法识别。',SKILL_COLLISION:'技能名称重复，冲突双方均未加载。',SKILL_BROKEN_REFERENCE:'引用的本地支持文件不存在或越界。',SKILL_DEPENDENCY:'依赖的技能包不可用。',SKILL_PENDING:'技能目录有未完成操作，请先核对恢复状态。',SKILL_MISSING:'这个内置包已移除，可显式恢复。'};
const diagnostic=(code,path)=>({code,path,message:messages[code]||'技能暂不可用，请检查目录后重扫。'});
async function exists(path){try{return await lstat(path);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function regular(path,limit=MAX_FILE){
 const before=await lstat(path);if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1)throw fail('SKILL_LINK');if(before.size>limit)throw fail('SKILL_LIMIT');
 const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const stat=await file.stat();if(stat.dev!==before.dev||stat.ino!==before.ino||!stat.isFile()||stat.nlink!==1)throw fail('SKILLS_CHANGED');const bytes=await file.readFile();const after=await file.stat();if(bytes.length>limit||after.size!==stat.size||after.mtimeMs!==stat.mtimeMs)throw fail('SKILLS_CHANGED');return {bytes,stat};}finally{await file.close();}
}
async function safeDirectory(path,create=false){if(create)try{await mkdir(path,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}const m=await lstat(path);if(!m.isDirectory()||m.isSymbolicLink())throw fail('SKILLS_PATH');return `${m.dev}:${m.ino}`;}
async function context(input){
 if(typeof input!=='string'||!isAbsolute(input))throw fail('SKILLS_PATH');const original=await lstat(input);if(!original.isDirectory()||original.isSymbolicLink())throw fail('SKILLS_PATH');const root=await realpath(input);
 if((await regular(join(root,'.sidekick-workspace'),128)).bytes.toString()!=='sidekick-workspace-v1\n')throw fail('SKILLS_PATH');
 const identities=new Map([[root,await safeDirectory(root)]]);
 for(const name of ['config','skills','runs','backups']){const path=join(root,name);identities.set(path,await safeDirectory(path,true));}
 return {root,async check(){for(const [path,id] of identities)if(await safeDirectory(path)!==id)throw fail('SKILLS_CHANGED');},async parents(path){if(!inside(root,resolve(path)))throw fail('SKILLS_PATH');await this.check();let current=root;for(const part of relative(root,dirname(path)).split(sep).filter(Boolean)){current=join(current,part);await safeDirectory(current);}}};
}
async function atomicJson(ctx,path,value){await ctx.parents(path);const current=await exists(path);if(current&&(!current.isFile()||current.isSymbolicLink()||current.nlink!==1))throw fail('SKILLS_PATH');const temp=join(dirname(path),`.skills-${randomUUID()}.tmp`);const body=JSON.stringify(value);if(Buffer.byteLength(body,'utf8')>MAX_METADATA)throw fail('SKILL_LIMIT');const file=await open(temp,'wx',0o600);try{await file.writeFile(body);await file.sync();}finally{await file.close();}try{await ctx.check();await rename(temp,path);}catch(error){await unlink(temp).catch(()=>{});throw error;}}
async function jsonFile(path,optional=false){try{return JSON.parse((await regular(path,MAX_METADATA)).bytes.toString('utf8'));}catch(error){if(optional&&error.code==='ENOENT')return null;throw fail('SKILLS_CONFIG');}}
async function inventory(base,{pending=false}={}){
 const files=[];let bytes=0;await safeDirectory(base);
 async function walk(path,prefix=''){
  await safeDirectory(path);
  for(const entry of (await readdir(path,{withFileTypes:true})).sort((a,b)=>a.name<b.name?-1:1)){
   const name=prefix?`${prefix}/${entry.name}`:entry.name,full=join(path,entry.name),meta=await lstat(full);
   if(name==='.sidekick-pending'){if(pending)continue;throw fail('SKILL_PENDING');}
   if(meta.isSymbolicLink()||(!meta.isFile()&&!meta.isDirectory())||meta.isFile()&&meta.nlink!==1)throw Object.assign(fail('SKILL_LINK'),{path:name});
   if(meta.isDirectory()){await walk(full,name);continue;}
   const data=await regular(full);bytes+=data.bytes.length;if(files.length>=MAX_FILES||bytes>MAX_BYTES)throw fail('SKILL_LIMIT');
   files.push({path:name,sha256:digest(data.bytes),bytes:data.bytes.length,executable:!!(data.stat.mode&0o111)});
  }
 }
 await walk(base);return {files:sorted(files),bytes,hash:treeHash(files)};
}
function safeRelative(value){return typeof value==='string'&&value.length>0&&value.length<=1024&&!isAbsolute(value)&&!value.includes('\\')&&!value.split('/').some(p=>!p||p==='.'||p==='..')&&!value.includes('\0');}
async function builtinBundle(input){
 const root=await realpath(input),manifest=await jsonFile(join(root,'manifest.json'));
 if(manifest.version!==1||!Array.isArray(manifest.packages)||manifest.packages.length>200)throw fail('SKILLS_BUNDLE');const ids=new Set();
 for(const item of manifest.packages){if(!validId(item.id)||ids.has(item.id)||!Array.isArray(item.files)||item.files.length>MAX_FILES)throw fail('SKILLS_BUNDLE');ids.add(item.id);const actual=await inventory(join(root,'packages',item.id));if(actual.files.length!==item.files.length||item.files.some(file=>!safeRelative(file.path)||!actual.files.some(a=>a.path===file.path&&a.sha256===file.sha256&&a.bytes===file.bytes)))throw fail('SKILLS_BUNDLE');item.hash=actual.hash;item.files=actual.files;}
 for(const ref of manifest.supportReferences||[]){if(!safeRelative(ref.from)||!safeRelative(ref.resourcePath)||!safeRelative(ref.snapshotPath)||ref.href!=='../../../events/im/message_receive.go'||ref.from!=='lark-event/references/lark-event-im.md'||ref.snapshotPath!=='events/im/message_receive.go')throw fail('SKILLS_BUNDLE');const bytes=(await regular(join(root,ref.resourcePath))).bytes;if(digest(bytes)!==ref.sha256||bytes.length!==ref.bytes)throw fail('SKILLS_BUNDLE');}
 return {root,manifest};
}
async function recoveryBundle(ctx,input){try{return await builtinBundle(input);}catch(error){if(await exists(join(ctx.root,'config/skills-operation.json')))throw fail('SKILLS_RESTORE_UNKNOWN');throw error;}}
async function populate(ctx,source,target,files,nonce){
 await ctx.parents(target);await mkdir(target,{mode:0o700});await writeFile(join(target,'.sidekick-pending'),nonce,{flag:'wx',mode:0o600});
 for(const item of files){let parent=target;for(const part of dirname(item.path).split('/').filter(p=>p!=='.')){parent=join(parent,part);await safeDirectory(parent,true);}await ctx.parents(join(target,item.path));const src=await regular(join(source,item.path));if(digest(src.bytes)!==item.sha256)throw fail('SKILLS_CHANGED');await writeFile(join(target,item.path),src.bytes,{flag:'wx',mode:item.executable?0o700:0o600});}
 await ctx.check();
}
function journalValid(j){return j?.version===1&&validId(j.id)&&/^[a-f0-9-]{36}$/.test(j.nonce)&&['prepared','moved','copying','published','rollback'].includes(j.phase)&&Array.isArray(j.newFiles)&&j.newFiles.every(f=>safeRelative(f.path)&&/^[a-f0-9]{64}$/.test(f.sha256))&&Array.isArray(j.oldFiles)&&j.oldFiles.every(f=>safeRelative(f.path)&&/^[a-f0-9]{64}$/.test(f.sha256))&&(!j.backup||j.backup===`backups/skills-${j.nonce}/${j.id}`);}
async function recover(ctx,bundle){try{return await recoverOperation(ctx,bundle);}catch{throw fail('SKILLS_RESTORE_UNKNOWN');}}
async function recoverOperation(ctx,bundle){
 const path=join(ctx.root,'config/skills-operation.json'),j=await jsonFile(path,true);if(!j)return;
 const item=bundle?.manifest.packages.find(item=>item.id===j.id);
 if(!journalValid(j)||!item||j.newHash!==item.hash||JSON.stringify(sorted([...j.newFiles]).map(f=>[f.path,f.sha256,f.bytes,f.executable]))!==JSON.stringify(item.files.map(f=>[f.path,f.sha256,f.bytes,f.executable]))||treeHash(j.newFiles)!==j.newHash||(j.oldHash!==null&&treeHash(j.oldFiles)!==j.oldHash))throw fail('SKILLS_RESTORE_UNKNOWN');
 const target=join(ctx.root,'skills',j.id),backup=j.backup?join(ctx.root,j.backup):null;await ctx.parents(target);if(backup)await ctx.parents(backup);
 if(j.oldHash!==null&&(!backup||!await exists(backup))){if(j.phase==='prepared'&&await exists(target)&&(await inventory(target)).hash===j.oldHash){await unlink(path);return;}throw fail('SKILLS_RESTORE_UNKNOWN');}
 if(backup&&(await inventory(backup)).hash!==j.oldHash)throw fail('SKILLS_RESTORE_UNKNOWN');
 const targetMeta=await exists(target),marker=targetMeta?await exists(join(target,'.sidekick-pending')):null;
 if(j.phase==='published'&&!targetMeta)throw fail('SKILLS_RESTORE_UNKNOWN');
 if(j.phase==='published'&&targetMeta){const current=await inventory(target,{pending:true});if(current.hash!==j.newHash)throw fail('SKILLS_RESTORE_UNKNOWN');if(marker){if((await regular(join(target,'.sidekick-pending'),128)).bytes.toString()!==j.nonce)throw fail('SKILLS_RESTORE_UNKNOWN');await unlink(join(target,'.sidekick-pending'));}await ctx.check();await unlink(path);return;}
 if(targetMeta){if(!marker||(await regular(join(target,'.sidekick-pending'),128)).bytes.toString()!==j.nonce)throw fail('SKILLS_RESTORE_UNKNOWN');const current=await inventory(target,{pending:true}),expected=j.phase==='rollback'?j.oldFiles:j.newFiles;if(!current.files.every(f=>expected.some(e=>e.path===f.path&&e.sha256===f.sha256)))throw fail('SKILLS_RESTORE_UNKNOWN');await ctx.check();await rm(target,{recursive:true});}
 if(backup){j.phase='rollback';await atomicJson(ctx,path,j);await populate(ctx,backup,target,j.oldFiles,j.nonce);if((await inventory(target,{pending:true})).hash!==j.oldHash)throw fail('SKILLS_RESTORE_UNKNOWN');await unlink(join(target,'.sidekick-pending'));}
 await ctx.check();await unlink(path);
}
async function publish(ctx,bundle,item,expectedHash,options={}){
 const target=join(ctx.root,'skills',item.id),present=await exists(target),before=present?await inventory(target):null;
 if((before?.hash||'missing')!==expectedHash)throw fail('SKILLS_CHANGED');
 const nonce=randomUUID(),backup=before?`backups/skills-${nonce}/${item.id}`:null;
 const j={version:1,id:item.id,nonce,phase:'prepared',backup,oldHash:before?.hash||null,oldFiles:before?.files||[],newHash:item.hash,newFiles:item.files};
 if(backup)await safeDirectory(join(ctx.root,'backups',`skills-${nonce}`),true);
 const journal=join(ctx.root,'config/skills-operation.json');await atomicJson(ctx,journal,j);
 try{
  await ctx.parents(target);
  if(before){if((await inventory(target)).hash!==before.hash)throw fail('SKILLS_CHANGED');await rename(target,join(ctx.root,backup));j.phase='moved';await atomicJson(ctx,journal,j);}
  if(options.fault==='afterBackup')throw fail('SKILLS_TEST_FAILURE');
  j.phase='copying';await atomicJson(ctx,journal,j);
  if(options.beforePublish)await options.beforePublish(target);
  await populate(ctx,join(bundle.root,'packages',item.id),target,item.files,nonce);
  if((await inventory(target,{pending:true})).hash!==item.hash)throw fail('SKILLS_CHANGED');
  j.phase='published';await atomicJson(ctx,journal,j);
  if(options.fault==='afterPublish')throw fail('SKILLS_TEST_FAILURE');
  await unlink(join(target,'.sidekick-pending'));await ctx.check();await unlink(journal);
  return {backupPath:backup?join(ctx.root,backup):null};
 }catch(error){if(error.code==='SKILLS_TEST_FAILURE')throw error;try{await recover(ctx,bundle);}catch{throw fail('SKILLS_RESTORE_UNKNOWN');}throw error;}
}
export async function initializeSkills(root,builtin){
 const ctx=await context(root),bundle=await recoveryBundle(ctx,builtin);await recover(ctx,bundle);const statePath=join(ctx.root,'config/skills-installation.json');let state=await jsonFile(statePath,true)||{version:1,processed:[],packages:{},conflicts:[]};
 if(state.version!==1||!Array.isArray(state.processed)||!state.processed.every(validId)||!state.packages||typeof state.packages!=='object')throw fail('SKILLS_CONFIG');
 state.conflicts??=[];if(!Array.isArray(state.conflicts)||!state.conflicts.every(validId))throw fail('SKILLS_CONFIG');
 for(const item of bundle.manifest.packages){if(!state.processed.includes(item.id)){if(!await exists(join(ctx.root,'skills',item.id)))await publish(ctx,bundle,item,'missing');else state.conflicts.push(item.id);state.processed.push(item.id);}state.packages[item.id]={hash:item.hash,files:item.files.map(f=>f.path)};}
 await atomicJson(ctx,statePath,state);return state;
}
function stripMarkdownExamples(text){
 text=text.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n');if(text.startsWith('---')){const end=text.indexOf('\n---',3);if(end!==-1)text=text.slice(end+4).trim();}
 const lines=[];let fence=null;
 for(const line of text.split(/\r?\n/)){
  const match=/^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
  if(fence){if(match&&match[1][0]===fence.character&&match[1].length>=fence.length&&!match[2].trim())fence=null;continue;}
  if(match&&(match[1][0]!=='`'||!match[2].includes('`'))){fence={character:match[1][0],length:match[1].length};continue;}
  lines.push(line);
 }
 const body=lines.join('\n');let output='',index=0;
 while(index<body.length){
  if(body[index]!=='`'){output+=body[index++];continue;}
  let end=index;while(body[end]==='`')end++;const length=end-index;let closing=-1,cursor=end;
  while(cursor<body.length){if(body[cursor]!=='`'){cursor++;continue;}let next=cursor;while(body[next]==='`')next++;if(next-cursor===length){closing=next;break;}cursor=next;}
  if(closing<0){output+=body.slice(index,end);index=end;}else index=closing;
 }
 return output;
}
export async function scanSkills(root,loadSkills,options={}){
 const ctx=await context(root),bundle=options.builtin?await recoveryBundle(ctx,options.builtin):null;await recover(ctx,bundle);const state=await jsonFile(join(ctx.root,'config/skills-installation.json'),true);const candidates=[];const support=bundle?.manifest.supportReferences||[];const scanState=join(ctx.root,'config/skills-scan-state.json');await atomicJson(ctx,scanState,{version:1,status:'scanning'});let discovered=0,visited=0,totalBytes=0,totalFiles=0;
 async function discover(path){await safeDirectory(path);for(const entry of await readdir(path,{withFileTypes:true})){if(++visited>MAX_FILES)throw fail('SKILL_LIMIT');if(entry.name.startsWith('.'))continue;const full=join(path,entry.name);if(entry.isSymbolicLink()){candidates.push({relativePath:relative(join(ctx.root,'skills'),full),diagnostics:[diagnostic('SKILL_LINK',entry.name)]});continue;}if(!entry.isDirectory())continue;if(await exists(join(full,'SKILL.md'))){if(++discovered>200)throw fail('SKILL_LIMIT');candidates.push({relativePath:relative(join(ctx.root,'skills'),full),baseDir:full,diagnostics:[]});}else await discover(full);}}
 try{await discover(join(ctx.root,'skills'));
 for(const entry of candidates){if(!entry.baseDir)continue;try{
  const data=await inventory(entry.baseDir);totalBytes+=data.bytes;totalFiles+=data.files.length;if(totalBytes>MAX_BYTES||totalFiles>MAX_FILES)throw fail('SKILLS_TOTAL_LIMIT');Object.assign(entry,data,{fileCount:data.files.length});
  const loaded=loadSkills({cwd:ctx.root,agentDir:join(ctx.root,'skills/.no-defaults'),skillPaths:[join(entry.baseDir,'SKILL.md')],includeDefaults:false});
  if(loaded.skills.length!==1||loaded.diagnostics.length){entry.diagnostics.push(diagnostic('SKILL_INVALID',`${entry.relativePath}/SKILL.md`));continue;}
  const skill=loaded.skills[0];entry.name=skill.name;entry.description=skill.description;entry.disableModelInvocation=skill.disableModelInvocation;
  for(const file of data.files.filter(f=>f.path.endsWith('.md'))){const text=stripMarkdownExamples((await regular(join(entry.baseDir,file.path))).bytes.toString('utf8'));const links=[...text.matchAll(/\[[^\]\n]*\]\(([^)\s]+)(?:\s+"[^"\n]*")?\)/g)].map(m=>m[1]);
   for(let target of links){const pinned=support.find(ref=>ref.from===`${entry.relativePath}/${file.path}`&&ref.href===target);if(pinned){entry.supportReferences??=[];if(!entry.supportReferences.some(ref=>ref.snapshotPath===pinned.snapshotPath))entry.supportReferences.push(pinned);continue;}target=target.replace(/^[<`]|[>`]$/g,'').split('#')[0];if(!target||target==='url'||/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(target)||/[{}$<>*]/.test(target)||target.startsWith('//'))continue;
    try{target=decodeURIComponent(target);}catch{entry.diagnostics.push(diagnostic('SKILL_BROKEN_REFERENCE',`${entry.relativePath}/${file.path}`));continue;}
    const absolute=resolve(dirname(join(entry.baseDir,file.path)),target);if(!inside(join(ctx.root,'skills'),absolute)||!await exists(absolute)){entry.diagnostics.push(diagnostic('SKILL_BROKEN_REFERENCE',`${entry.relativePath}/${file.path}`));continue;}
    entry.references??=[];entry.references.push(absolute);
   }
  }
 }catch(error){if(['SKILL_LINK','SKILL_LIMIT','SKILL_PENDING'].includes(error.code))entry.diagnostics.push(diagnostic(error.code,`${entry.relativePath}/${error.path||'SKILL.md'}`));else if(['SKILLS_CHANGED','SKILLS_TOTAL_LIMIT'].includes(error.code))throw error;else throw fail('SKILLS_SCAN_FAILED');}}
 const names=new Map();for(const entry of candidates.filter(e=>e.name)){const same=names.get(entry.name)||[];same.push(entry);names.set(entry.name,same);}for(const entries of names.values())if(entries.length>1)for(const entry of entries)entry.diagnostics.push(diagnostic('SKILL_COLLISION',`${entry.relativePath}/SKILL.md`));
 let changed=true;while(changed){changed=false;for(const entry of candidates.filter(e=>!e.diagnostics.length)){for(const target of entry.references||[]){const dependency=candidates.find(p=>p.baseDir&&inside(p.baseDir,target));if(!dependency||dependency.diagnostics.length){entry.diagnostics.push(diagnostic('SKILL_DEPENDENCY',entry.relativePath));changed=true;break;}}}}
 for(const entry of candidates){entry.builtinId=Object.hasOwn(state?.packages||{},entry.relativePath)?entry.relativePath:null;entry.installationConflict=!!entry.builtinId&&!!state.conflicts?.includes(entry.builtinId);entry.modified=!!entry.builtinId&&entry.hash!==state.packages[entry.relativePath].hash;entry.builtinFiles=entry.builtinId?state.packages[entry.relativePath].files:[];delete entry.references;delete entry.baseDir;delete entry.files;}
 for(const id of state?.processed||[])if(!candidates.some(e=>e.relativePath===id))candidates.push({relativePath:id,name:id,builtinId:id,hash:'missing',modified:true,builtinFiles:state.packages[id]?.files||[],fileCount:0,bytes:0,diagnostics:[diagnostic('SKILL_MISSING',id)]});
 const packages=candidates.sort((a,b)=>a.relativePath.localeCompare(b.relativePath)),skills=packages.filter(p=>p.name&&!p.diagnostics.length).map(p=>({name:p.name,description:p.description,relativePath:p.relativePath,hash:p.hash,disableModelInvocation:p.disableModelInvocation}));
 const catalog={version:1,revision:digest(JSON.stringify(packages)),scannedAtMs:Date.now(),root:join(ctx.root,'skills'),skills,packages,diagnostics:packages.flatMap(p=>p.diagnostics)};
 const response={ok:true,value:options.restoreResult?{catalog,...options.restoreResult}:catalog};if(Buffer.byteLength(JSON.stringify(response),'utf8')>MAX_RESPONSE)throw fail('SKILL_LIMIT');
 await atomicJson(ctx,join(ctx.root,'config/skills-index.json'),catalog);await atomicJson(ctx,scanState,{version:1,status:'ready',revision:catalog.revision});return catalog;
 }catch(error){await atomicJson(ctx,scanState,{version:1,status:'failed'}).catch(()=>{});if(error.code==='SKILLS_TOTAL_LIMIT')throw fail('SKILL_LIMIT');throw fail(['SKILLS_PATH','SKILLS_CHANGED','SKILLS_RESTORE_UNKNOWN','SKILL_LIMIT'].includes(error.code)?error.code:'SKILLS_SCAN_FAILED');}
}
export async function freezeSkills(root,runDirectory,options={}){
 const ctx=await context(root),bundle=options.builtin?await recoveryBundle(ctx,options.builtin):null;await recover(ctx,bundle);const run=await realpath(runDirectory);if(dirname(run)!==join(ctx.root,'runs'))throw fail('SKILLS_PATH');await ctx.parents(run);await safeDirectory(run);
 const catalog=await jsonFile(join(ctx.root,'config/skills-index.json'));const scanState=await jsonFile(join(ctx.root,'config/skills-scan-state.json'),true);if(scanState?.version!==1||scanState.status!=='ready'||scanState.revision!==catalog.revision)throw fail('SKILLS_SCAN_REQUIRED');if(catalog.version!==1||!Array.isArray(catalog.skills)||!Array.isArray(catalog.packages)||catalog.root!==join(ctx.root,'skills'))throw fail('SKILLS_CONFIG');
 const parent=join(run,'skill-resources');await ctx.parents(parent);await mkdir(parent,{mode:0o700});const destination=join(parent,'skills');await mkdir(destination,{mode:0o700});
 try{for(const skill of catalog.skills){if(!safeRelative(skill.relativePath))throw fail('SKILLS_CONFIG');const item=catalog.packages.find(p=>p.relativePath===skill.relativePath&&p.hash===skill.hash);if(!item||item.diagnostics.length)throw fail('SKILLS_CONFIG');const source=join(ctx.root,'skills',skill.relativePath),data=await inventory(source);if(data.hash!==item.hash)throw fail('SKILLS_CHANGED');const target=join(destination,skill.relativePath);await mkdir(dirname(target),{recursive:true,mode:0o700});await populate(ctx,source,target,data.files,randomUUID());if((await inventory(target,{pending:true})).hash!==item.hash||(await inventory(source)).hash!==item.hash)throw fail('SKILLS_CHANGED');await unlink(join(target,'.sidekick-pending'));for(const file of data.files)await chmod(join(target,file.path),file.executable?0o500:0o400);}
 const refs=catalog.packages.filter(p=>catalog.skills.some(s=>s.relativePath===p.relativePath)).flatMap(p=>p.supportReferences||[]);
 if(refs.length){if(!bundle)throw fail('SKILLS_BUNDLE');for(const ref of refs){const current=(bundle.manifest.supportReferences||[]).find(r=>JSON.stringify(r)===JSON.stringify(ref));if(!current)throw fail('SKILLS_CHANGED');const path=resolve(parent,ref.snapshotPath);if(!inside(parent,path))throw fail('SKILLS_PATH');await mkdir(dirname(path),{recursive:true,mode:0o700});const bytes=(await regular(join(bundle.root,ref.resourcePath))).bytes;if(digest(bytes)!==ref.sha256||bytes.length!==ref.bytes)throw fail('SKILLS_CHANGED');await writeFile(path,bytes,{flag:'wx',mode:0o400});}}
 await ctx.check();return {revision:catalog.revision,root:destination,index:catalog.skills.map(s=>({...s,filePath:join(destination,s.relativePath,'SKILL.md'),baseDir:join(destination,s.relativePath)}))};
 }catch(error){await rm(parent,{recursive:true,force:true});throw error;}
}
export async function restoreBuiltin(root,builtin,id,expectedHash,options={}){if(!validId(id)||typeof expectedHash!=='string')throw fail('SKILLS_CONFIG');const ctx=await context(root),bundle=await recoveryBundle(ctx,builtin);await recover(ctx,bundle);const item=bundle.manifest.packages.find(item=>item.id===id);if(!item)throw fail('SKILLS_CONFIG');const result=await publish(ctx,bundle,item,expectedHash,options);const statePath=join(ctx.root,'config/skills-installation.json'),state=await jsonFile(statePath,true);if(state){state.conflicts=(state.conflicts||[]).filter(value=>value!==id);await atomicJson(ctx,statePath,state);}return result;}
