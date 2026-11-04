import assert from 'node:assert/strict';
import test,{before,after} from 'node:test';
import {existsSync,mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {build,preview} from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';

const exec=promisify(execFile),repository=fileURLToPath(new URL('../../',import.meta.url));
const fixture=join(repository,'tests/fixtures/desktop-controls'),chrome=process.env.SIDEKICK_TEST_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const available=existsSync(chrome),evidence=join(repository,'build/switch-visibility-20261104/browser');
let work,server;
before(async()=>{
 if(!available)return;
 work=mkdtempSync(join(tmpdir(),'sidekick-controls-'));mkdirSync(evidence,{recursive:true,mode:0o700});
 const aliases=[{find:/^@tauri-apps\/api\/(core|event)$/,replacement:join(fixture,'api.ts')}];
 const instrumentation={name:'synthetic-switch-probe',enforce:'pre',transform(code,id){if(id!==join(fixture,'main.ts'))return;return code+`\nimport * as fixtureApi from ${JSON.stringify(join(fixture,'api.ts'))};\nvoid(async()=>{const report=await ${probe.replace("await import('/src-api-placeholder')","fixtureApi")};document.querySelector('#result').textContent=JSON.stringify(report);})();`;}};
 await build({configFile:false,envDir:false,root:fixture,plugins:[instrumentation,vue(),tailwindcss()],resolve:{alias:aliases},logLevel:'error',build:{outDir:join(work,'dist'),emptyOutDir:true}});
 server=await preview({configFile:false,envDir:false,root:fixture,build:{outDir:join(work,'dist')},preview:{host:'127.0.0.1',port:0,strictPort:true,open:false},logLevel:'error'});
});
after(async()=>{
 if(server){server.httpServer.closeAllConnections?.();await new Promise(resolve=>server.httpServer.close(resolve));}
 if(work)rmSync(work,{recursive:true,force:true});
});
const probe=String.raw`(async()=>{
 const wait=async(predicate)=>{for(let count=0;count<100;count++){if(predicate())return;await new Promise(r=>setTimeout(r,20));}throw Error('fixture did not become ready');};
 const check=(condition,message)=>{if(!condition)throw Error(message);};
 const switches=()=>[...document.querySelectorAll('[role="switch"]')];
 const find=label=>switches().find(el=>el.getAttribute('aria-label')===label);
 const frame=()=>new Promise(resolve=>setTimeout(resolve,30));
 let initial=[];
 try{
  await wait(()=>switches().length===5&&!document.querySelector('.profile-alert')&&!document.body.textContent.includes('正在读取桌面偏好'));
  initial=switches().map(el=>{const r=el.getBoundingClientRect(),thumb=el.querySelector('.t-switch__handle').getBoundingClientRect();return {label:el.getAttribute('aria-label'),width:r.width,height:r.height,x:r.x,right:r.right,thumbWidth:thumb.width,thumbHeight:thumb.height,background:getComputedStyle(el).backgroundColor,disabled:el.getAttribute('aria-disabled')};});
  for(const m of initial){check(m.width>=32&&m.height>=18,m.label+' has no usable track: '+JSON.stringify(m));check(m.thumbWidth>=12&&m.thumbHeight>=12,m.label+' has no visible thumb');check(m.background!=='rgba(0, 0, 0, 0)',m.label+' has no track fill');check(m.x>=0&&m.right<=innerWidth,m.label+' is clipped');}
  const work=find('工作模式'),startup=find('启动时显示班班');
  const checked=el=>el.getAttribute('aria-checked')==='true';
  const click=async el=>{const r=el.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);check(el===hit||el.contains(hit),'switch center is not a pointer target');el.click();await frame();};
  const key=async(el,value,code)=>{el.focus();el.dispatchEvent(new KeyboardEvent('keydown',{key:value,code,bubbles:true,cancelable:true}));await frame();};
  check(!checked(work)&&!checked(startup),'unexpected initial values');
  await click(work);check(checked(work),'click did not update work mode');
  await key(work,' ','Space');check(!checked(work),'Space did not toggle once');
  await key(work,'Enter','Enter');check(checked(work),'Enter did not toggle once');
  await click(startup);check(checked(startup),'startup switch did not update');
  const save=[...document.querySelectorAll('button')].find(el=>el.textContent.includes('保存桌面偏好'));check(save&&!save.disabled,'save did not become available');
  save.click();await wait(()=>document.body.textContent.includes('桌面偏好已保存。'));
  const api=await import('/src-api-placeholder');
  check(api.calls.length===1,'duplicate or missing save');
  check(JSON.stringify(api.snapshot())===JSON.stringify({version:1,workMode:true,petOnStartup:true}),'saved booleans mismatch');
  const shared=find('合成复用开关');await click(shared);check(checked(shared),'existing shared switch did not toggle');
  check(api.disabledUpdates.length===0,'disabled switch emitted before interaction');
  for(const label of ['合成禁用开关','合成禁用开启开关']){
   const disabled=find(label),original=checked(disabled);
   disabled.click();await frame();check(api.disabledUpdates.length===0&&checked(disabled)===original,'disabled click emitted an update');
   await key(disabled,' ','Space');check(api.disabledUpdates.length===0&&checked(disabled)===original,'disabled Space emitted an update');
   await key(disabled,'Enter','Enter');check(api.disabledUpdates.length===0&&checked(disabled)===original,'disabled Enter emitted an update');
  }
  document.activeElement?.blur();
  await new Promise(resolve=>setTimeout(resolve,300));
  for(const el of switches()){const track=el.getBoundingClientRect(),thumb=el.querySelector('.t-switch__handle').getBoundingClientRect();check(thumb.x>=track.x&&thumb.right<=track.right,'settled switch thumb is outside its track');}
  check(document.documentElement.scrollWidth<=innerWidth,'page overflows viewport');
  return {pass:true,viewport:innerWidth,initial,saves:api.calls.length,saved:api.snapshot(),disabledUpdateEvents:api.disabledUpdates.length,inputLayer:'synthetic DOM click and keyboard events in headless Chrome'};
 }catch(error){return {pass:false,viewport:innerWidth,initial,error:String(error)};}
})()`;

for(const width of [1440,640])test(`desktop switches remain visible and editable at ${width}px`,{skip:available?false:'Chrome unavailable; browser acceptance not verified',timeout:30000},async()=>{
 const address=server.httpServer.address();assert.equal(typeof address,'object');
 const profile=join(work,'chrome-'+width),url=`http://127.0.0.1:${address.port}/`;
 const result=await exec(chrome,['--headless','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--disable-sync','--disable-extensions','--use-mock-keychain',`--user-data-dir=${profile}`,'--dump-dom','--virtual-time-budget=5000',`--window-size=${width},1000`,`--screenshot=${join(evidence,`${width}.png`)}`,url],{timeout:25000,maxBuffer:4*1024*1024});
 writeFileSync(join(evidence,`${width}.stderr.log`),result.stderr,{mode:0o600});
 const match=result.stdout.match(/<pre id="result" hidden="">(.*?)<\/pre>/s);assert.ok(match,'browser did not return fixture results');
 const report=JSON.parse(match[1].replaceAll('&quot;','"').replaceAll('&amp;','&').replaceAll('&lt;','<').replaceAll('&gt;','>'));
 writeFileSync(join(evidence,`${width}.json`),JSON.stringify(report,null,2)+'\n',{mode:0o600});assert.equal(report.pass,true,JSON.stringify(report));
});
