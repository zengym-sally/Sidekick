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
const available=existsSync(chrome),evidence=join(repository,'build/inbox-width-20261105/browser');
let work,server;
before(async()=>{
 if(!available)return;
 work=mkdtempSync(join(tmpdir(),'sidekick-controls-'));mkdirSync(evidence,{recursive:true,mode:0o700});
 const aliases=[{find:/^@tauri-apps\/api\/(core|event|app)$|^@tauri-apps\/plugin-dialog$/,replacement:join(fixture,'api.ts')},{find:/web-api-client/,replacement:join(fixture,'api.ts')}];
 const instrumentation={name:'synthetic-controls-probe',enforce:'pre',transform(code,id){if(id!==join(fixture,'main.ts'))return;return code+`\nimport * as fixtureApi from ${JSON.stringify(join(fixture,'api.ts'))};\nvoid(async()=>{const report=new URLSearchParams(location.search).get('surface')==='workbench'?await ${uiProbe}:await ${probe.replace("await import('/src-api-placeholder')","fixtureApi")};document.querySelector('#result').textContent=JSON.stringify(report);})();`;}};
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
 let initial=[],buttons=[];
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
  for(const el of switches())for(const animation of el.getAnimations({subtree:true})){const timing=animation.effect?.getTiming();if(timing&&Number.isFinite(Number(timing.iterations)))animation.finish();}
  await frame();
  for(const el of switches()){const track=el.getBoundingClientRect(),thumb=el.querySelector('.t-switch__handle').getBoundingClientRect();check(thumb.x>=track.x&&thumb.right<=track.right,'settled switch thumb is outside its track');}
  check(document.documentElement.scrollWidth<=innerWidth,'page overflows viewport');
  buttons=[];
  for(const id of ['button-before','button-after','button-plain','button-badge','button-compact']){
   const el=document.getElementById(id),r=el.getBoundingClientRect(),content=el.querySelector('.t-button__text'),icon=content.querySelector('svg'),badge=content.querySelector('kbd');
   const text=[...content.childNodes].find(node=>node.nodeType===Node.TEXT_NODE&&node.textContent.trim()),range=document.createRange();range.selectNodeContents(text);const label=range.getBoundingClientRect();
   const metric={id,height:r.height,icon:icon?{width:icon.getBoundingClientRect().width,height:icon.getBoundingClientRect().height,centerOffset:Math.abs(icon.getBoundingClientRect().y+icon.getBoundingClientRect().height/2-(label.y+label.height/2))}:null,badgeHeight:badge?.getBoundingClientRect().height||0,gap:parseFloat(getComputedStyle(content).columnGap)||0};buttons.push(metric);
  }
  for(const b of buttons){check(Math.abs(b.height-(b.id==='button-compact'?30:38))<.6,'button size differs: '+JSON.stringify(b));if(b.icon){check(b.icon.width===16&&b.icon.height===16,'icon size differs: '+JSON.stringify(b));check(b.icon.centerOffset<=1.5,'icon/text not centered: '+JSON.stringify(b));check(b.gap>=6,'icon and text touch: '+JSON.stringify(b));}if(b.badgeHeight)check(b.badgeHeight===20,'shortcut badge stretches button');}
  const loading=document.getElementById('button-loading'),spinner=loading.querySelector('.t-loading'),spinnerIcon=spinner.querySelector('svg'),loadingText=loading.querySelector('.t-button__text').getBoundingClientRect();
  check(spinnerIcon.clientWidth===16&&spinnerIcon.clientHeight===16&&Math.abs(loadingText.x-spinner.getBoundingClientRect().right-8)<.6,'loading symbol size or gap differs: '+JSON.stringify({width:spinnerIcon.clientWidth,height:spinnerIcon.clientHeight,gap:loadingText.x-spinner.getBoundingClientRect().right}));
  document.getElementById('button-before').click();document.getElementById('button-disabled').click();document.getElementById('button-loading').click();await frame();check(JSON.stringify(api.buttonEvents)===JSON.stringify(['before']),'button disabled/loading event contract changed');
  return {pass:true,viewport:innerWidth,initial,saves:api.calls.length,saved:api.snapshot(),disabledUpdateEvents:api.disabledUpdates.length,buttons,inputLayer:'synthetic DOM click and keyboard events in headless Chrome'};
 }catch(error){return {pass:false,viewport:innerWidth,initial,buttons,error:String(error)};}
})()`;

const uiProbe=String.raw`(async()=>{
 const check=(condition,message)=>{if(!condition)throw Error(message);};
 const wait=async predicate=>{for(let n=0;n<150;n++){if(predicate())return;await new Promise(r=>setTimeout(r,20));}throw Error('workbench fixture did not become ready');};
 const frame=()=>new Promise(r=>setTimeout(r,40)),nav=title=>document.querySelector('nav button[title="'+title+'"]'),empty=()=>document.querySelector('.sk-empty-state');
 const button=(scope,label)=>[...scope.querySelectorAll('button')].find(el=>el.textContent.includes(label));
 const refresh=async()=>{await wait(()=>!document.querySelector('button[aria-label="刷新清单"]').disabled);document.querySelector('button[aria-label="刷新清单"]').click();await frame();};
 const metrics=[];
 try{
  await wait(()=>document.querySelector('.workbench')&&document.getElementById('quick-entry')&&!document.getElementById('quick-entry').disabled);
  for(const title of ['今日工作台','待确认','全部事项']){
   nav(title).click();await wait(()=>document.querySelector('.sk-empty-state,.first-task,.empty-state')&&!document.querySelector('.view[aria-busy="true"]'));
   const panel=document.querySelector('.sk-empty-state,.first-task,.empty-state'),heading=panel.querySelector('h2'),description=panel.querySelector('p'),primary=panel.querySelector('button');
   check(heading&&description&&primary,'empty hierarchy incomplete on '+title);
   check(heading.getBoundingClientRect().bottom<=description.getBoundingClientRect().top&&description.getBoundingClientRect().bottom<primary.getBoundingClientRect().top,'empty order differs on '+title);
   check(!panel.querySelector('img'),'empty illustration differs on '+title);
   metrics.push({page:title,headingSize:getComputedStyle(heading).fontSize,descriptionSize:getComputedStyle(description).fontSize,buttonHeight:primary.getBoundingClientRect().height});
   primary.click();await frame();await wait(()=>document.querySelector('dialog[open]'));check(document.querySelector('dialog[open] [role="tab"][aria-selected="true"]').textContent.includes(title==='待确认'?'文本':'手工'),'empty CTA opens wrong flow');
   document.querySelector('button[aria-label="关闭录入"]').click();await frame();
  }
  check(metrics.every(m=>m.headingSize===metrics[0].headingSize&&m.descriptionSize===metrics[0].descriptionSize&&Math.abs(m.buttonHeight-38)<.6),'empty type or button sizing differs');
  check(Math.abs(document.getElementById('quick-entry').getBoundingClientRect().height-38)<.6,'toolbar shortcut button is taller than a normal button');
  check((getComputedStyle(document.querySelector('#quick-entry kbd')).display==='none')===(innerWidth<=760),'toolbar shortcut badge lost its narrow-window rule');
  fixtureApi.setUiCase('populated');await refresh();await frame();
  const search=document.querySelector('input[aria-label="搜索事项标题"]');search.value='不存在的合成关键词';search.dispatchEvent(new Event('input',{bubbles:true}));await wait(()=>empty());
  check(empty().textContent.includes('没有符合条件'),'filter result is mislabeled as first data');button(empty(),'清除筛选').click();await wait(()=>!empty());check(search.value==='','clear filter action did not reset query');
  fixtureApi.setUiCase('deleted');await refresh();await wait(()=>empty());check(!empty().textContent.includes('第一条')&&!button(empty(),'清除筛选'),'hidden history offers a misleading first-data or clear-filter action');
  fixtureApi.setUiCase('empty');await refresh();await wait(()=>empty());
  fixtureApi.setUiCase('loading');await refresh();await frame();check(!empty(),'loading is presented as empty success');fixtureApi.setUiCase('empty');fixtureApi.releaseUiRead();await wait(()=>empty());
  fixtureApi.setUiCase('error');await refresh();await wait(()=>document.querySelector('.inline-error'));check(!empty(),'failed read is presented as fresh empty success');
  fixtureApi.setUiCase('completed');await refresh();await frame();nav('今日工作台').click();await wait(()=>empty());check(!empty().textContent.includes('第一条'),'completed records are presented as first-ever data');
  fixtureApi.setUiCase('inbox-loading');nav('待确认').click();await refresh();await frame();check(!empty(),'inbox loading is presented as empty');fixtureApi.setUiCase('empty');fixtureApi.releaseUiRead();await wait(()=>empty());
  fixtureApi.setUiCase('inbox-error');await refresh();await wait(()=>document.querySelector('.inbox-page [role="alert"]'));check(!empty(),'inbox error is presented as fresh empty success');
  fixtureApi.setUiCase('empty');await refresh();await wait(()=>empty());
  fixtureApi.setUiCase('width-batch');nav('待确认').click();await refresh();await wait(()=>document.querySelector('.review-grid .candidate-card'));
  const tools=document.querySelector('.inbox-tools').getBoundingClientRect(),column=document.querySelector('.review-grid>div').getBoundingClientRect(),field=document.querySelector('.inbox-tools>.sk-field').getBoundingClientRect(),action=document.querySelector('.inbox-tools>.sk-button').getBoundingClientRect();
  const inboxWidth={toolsLeft:tools.left,toolsRight:tools.right,columnLeft:column.left,columnRight:column.right,fieldWidth:field.width,fieldRight:field.right,buttonLeft:action.left,buttonRight:action.right,buttonTop:action.top,fieldBottom:field.bottom};
  check(Math.abs(tools.left-column.left)<1&&Math.abs(tools.right-column.right)<1,'source toolbar does not match candidate column: '+JSON.stringify(inboxWidth));
  check(Math.abs(action.right-column.right)<1,'source toolbar button leaves unused candidate width: '+JSON.stringify(inboxWidth));
  if(innerWidth<=760)check(action.top>=field.bottom&&field.width>column.width-1,'narrow source toolbar did not wrap its button');else check(action.left-field.right>=11&&action.left-field.right<=13,'source select did not stretch to its button');
  const capture=new URLSearchParams(location.search).get('capture')||'inbox';
  if(capture!=='inbox'){fixtureApi.setUiCase('empty');await refresh();nav({today:'今日工作台',all:'全部事项'}[capture]).click();await wait(()=>empty());}
  check(!fixtureApi.calls.some(c=>['organize_text','test_model','start_agent_trial','start_today_advice','sign_candidates'].includes(c.command)),'visual navigation started a business/model call');
  check(document.documentElement.scrollWidth<=innerWidth,'page overflows viewport');return {pass:true,viewport:innerWidth,metrics,inboxWidth,businessCalls:0};
 }catch(error){return {pass:false,viewport:innerWidth,metrics,error:String(error)};}
})()`;

for(const surface of ['controls','workbench'])for(const capture of surface==='workbench'?['today','inbox','all']:['controls'])for(const width of capture==='inbox'?[1440,1024,640]:[1440,640])test(`${surface}/${capture} remains consistent and usable at ${width}px`,{skip:available?false:'Chrome unavailable; browser acceptance not verified',timeout:30000},async()=>{
 const address=server.httpServer.address();assert.equal(typeof address,'object');
 const profile=join(work,'chrome-'+width+'-'+capture),url=`http://127.0.0.1:${address.port}/`;
 const result=await exec(chrome,['--headless','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--disable-sync','--disable-extensions','--use-mock-keychain',`--user-data-dir=${profile}-${surface}`,'--dump-dom','--virtual-time-budget=15000',`--window-size=${width},1000`,`--screenshot=${join(evidence,`${surface}-${capture}-${width}.png`)}`,url+'?surface='+surface+'&capture='+capture],{timeout:25000,maxBuffer:4*1024*1024});
 writeFileSync(join(evidence,`${surface}-${capture}-${width}.stderr.log`),result.stderr,{mode:0o600});
 const match=result.stdout.match(/<pre id="result" hidden="">(.*?)<\/pre>/s);assert.ok(match,'browser did not return fixture results');
 const report=JSON.parse(match[1].replaceAll('&quot;','"').replaceAll('&amp;','&').replaceAll('&lt;','<').replaceAll('&gt;','>'));
 writeFileSync(join(evidence,`${surface}-${capture}-${width}.json`),JSON.stringify(report,null,2)+'\n',{mode:0o600});assert.equal(report.pass,true,JSON.stringify(report));
});
