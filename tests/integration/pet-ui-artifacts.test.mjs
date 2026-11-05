import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {join,resolve} from 'node:path';
const consoleMarkers=['pet-ui-verification-console','pet-console.html','pet-console.js'];
const hasConsole=image=>consoleMarkers.some(marker=>image.includes(Buffer.from(marker)));
const bundles=resolve('src-tauri/target/release/bundle/macos');
async function entries(root){const found=[];for(const e of await readdir(root,{withFileTypes:true})){const path=join(root,e.name);found.push(path);if(e.isDirectory())found.push(...await entries(path));}return found;}
test('actual embedded positive control is caught before checking ordinary packages',async()=>{
 const positive=await readFile('build/pet-ui-entries/positive-control');assert.ok(hasConsole(positive));
 for(const key of ['pet-console.html','pet-console.js'])assert.ok(positive.includes(Buffer.from(key)));
});
test('normal and S33 bundles exclude pet UI verification console and resources',async()=>{
 for(const name of ['Sidekick.app','Sidekick MCP Verify.app']){
  const bundle=join(bundles,name),binary=join(bundle,'Contents/MacOS/sidekick');
  assert.ok(!hasConsole(await readFile(binary)),`${name} embeds pet console`);
  const paths=await entries(join(bundle,'Contents/Resources'));assert.ok(!paths.some(path=>/pet-console|pet-ui-2026|pet-ui\.nonce/.test(path)),`${name} contains fixture resource`);
 }
});
test('ordinary release rejects the pet private flag before ordinary-root startup',async()=>{
 const image=await readFile(join(bundles,'Sidekick.app/Contents/MacOS/sidekick'));
 assert.ok(image.includes(Buffer.from('Pet UI verification requires its dedicated example'))&&image.includes(Buffer.from('MCP UI verification is not enabled in this package')),'refusing to execute an artifact without both reviewed early-refusal branches');
 const binary=join(bundles,'Sidekick.app/Contents/MacOS/sidekick'),options={env:{PATH:'/usr/bin:/bin',TMPDIR:'/tmp'},encoding:'utf8',timeout:10000};
 const preflight=spawnSync(binary,['--pet-ui-verify','--s33-mcp-ui'],options);
 assert.equal(preflight.status,2,preflight.stderr);assert.match(preflight.stderr,/Pet UI verification requires its dedicated example/);
 const result=spawnSync(binary,['--pet-ui-verify'],options);
 assert.equal(result.status,2,result.stderr);assert.match(result.stderr,/Pet UI verification requires its dedicated example/);
});
