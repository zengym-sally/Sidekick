import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,writeFile,readFile,open,stat,rm,mkdir,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {copyExecutable} from '../../scripts/build/copy-executable.mjs';

async function fixture(run){
 const directory=await mkdtemp(join(tmpdir(),'sidekick-executable-'));
 try{await run({directory,source:join(directory,'source'),target:join(directory,'node')});}
 finally{await rm(directory,{recursive:true,force:true});}
}
test('replacing executable gives it a fresh inode and preserves the old opened image',()=>fixture(async({source,target})=>{
 await writeFile(source,'new executable');await writeFile(target,'old executable');
 const original=await open(target,'r');
 try{
  const before=await original.stat();await copyExecutable(source,target);
  assert.notEqual((await stat(target)).ino,before.ino,'executable inode was overwritten in place');
  assert.equal(await original.readFile('utf8'),'old executable');
  assert.equal(await readFile(target,'utf8'),'new executable');
  assert.equal((await stat(target)).mode&0o777,0o755);
 }finally{await original.close();}
}));
test('a missing source leaves the previous executable intact',()=>fixture(async({source,target})=>{
 await writeFile(target,'old executable');const before=await stat(target);
 await assert.rejects(copyExecutable(source,target),{code:'ENOENT'});
 assert.equal((await stat(target)).ino,before.ino);assert.equal(await readFile(target,'utf8'),'old executable');
}));
test('first install publishes executable bytes with executable permissions',()=>fixture(async({source,target})=>{
 await writeFile(source,'first executable',{mode:0o600});await copyExecutable(source,target);
 assert.equal(await readFile(target,'utf8'),'first executable');assert.equal((await stat(target)).mode&0o777,0o755);
 assert.equal((await stat(source)).mode&0o777,0o600);
}));
test('a failed publish leaves no staging files or modified destination directory',()=>fixture(async({directory,source,target})=>{
 await writeFile(source,'new executable');await mkdir(target);
 await assert.rejects(copyExecutable(source,target));
 assert.equal((await stat(target)).isDirectory(),true);assert.deepEqual((await readdir(directory)).sort(),['node','source']);
}));
