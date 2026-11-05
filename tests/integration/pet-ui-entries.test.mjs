import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {copyFileSync,mkdirSync,readdirSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir,release} from 'node:os';
import {randomUUID} from 'node:crypto';
import {copyExecutable} from '../../scripts/build/copy-executable.mjs';
const root=resolve('.'),output=join(root,'build/pet-ui-entries',randomUUID()),env={...process.env};
assert.equal(env.TAURI_CONFIG,undefined,'entry checks require ordinary configuration');
if(process.platform==='darwin'&&Number(release().split('.')[0])>=26){assert.equal(env.RUSTC_WRAPPER,undefined);env.RUSTC_WRAPPER=join(root,'scripts/probes/rustc-host-macro.py');}
mkdirSync(output,{recursive:true,mode:0o700});
const roots=()=>readdirSync(tmpdir()).filter(name=>name.startsWith('sidekick-pet-ui-')).sort();
function build(features,...targets){const result=spawnSync('cargo',['build','--manifest-path','src-tauri/Cargo.toml','--features',features,...targets],{cwd:root,env,encoding:'utf8',timeout:180000});assert.equal(result.status,0,result.stderr);}
function refuse(binary,args,pattern){const before=roots(),result=spawnSync(binary,args,{env:{PATH:'/usr/bin:/bin',TMPDIR:tmpdir()},encoding:'utf8',timeout:10000});assert.equal(result.status,2,result.stderr);assert.match(result.stderr,pattern);assert.deepEqual(roots(),before,'rejected entry created a fixture root');}
test('dedicated pet fixture refuses wrong arguments and feature main refuses before appData',()=>{
 build('pet-ui-verification','--bin','sidekick','--example','pet-ui-verification');
 const ordinary=join(output,'feature-main'),example=join(output,'dedicated-entry');copyFileSync('src-tauri/target/debug/sidekick',ordinary);copyFileSync('src-tauri/target/debug/examples/pet-ui-verification',example);
 refuse(ordinary,['--pet-ui-verify'],/requires its dedicated example/);
 refuse(example,['--pet-ui-verify','--workspace-root','/synthetic-not-consumed'],/requires its dedicated entry/);
});
test('pet fixture refuses mixed S33 features before constructing any root',()=>{
 build('pet-ui-verification,s33-mcp-ui-verification,s33-mcp-verification','--example','pet-ui-verification');
 const example=join(output,'mixed-feature-entry');copyFileSync('src-tauri/target/debug/examples/pet-ui-verification',example);
 refuse(example,['--pet-ui-verify'],/cannot mix S33 features/);
});

test('compressed embedded console is detected by its actual asset keys',async()=>{
 env.TAURI_CONFIG=JSON.stringify({build:{devUrl:null,frontendDist:join(root,'tests/fixtures/pet-ui')},app:{windows:[]}});
 try{build('pet-ui-verification','--example','pet-ui-verification');}finally{delete env.TAURI_CONFIG;}
 const positive=join(root,'build/pet-ui-entries/positive-control');await copyExecutable(join(root,'src-tauri/target/debug/examples/pet-ui-verification'),positive);
 const image=readFileSync(positive);for(const key of ['pet-console.html','pet-console.js'])assert.ok(image.includes(Buffer.from(key)),`actual positive control misses ${key}`);
 assert.match(readFileSync('tests/fixtures/pet-ui/pet-console.html','utf8'),/pet-ui-verification-console/);
});
