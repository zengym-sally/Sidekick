<script setup lang="ts">
import {computed,nextTick,onMounted,onUnmounted,ref,watch} from 'vue';
import {listen} from '@tauri-apps/api/event';
import {displayTime} from '../domain/todos';
import {useMcpDiagnostics,observeMcpDiagnostics,probeMessage} from '../stores/mcpDiagnostics';
import {useMcpSettings} from '../stores/mcp';
import {useMcpUpgrade} from '../stores/mcpUpgrade';
import McpStoragePanel from './McpStoragePanel.vue';
import type {McpEnvironment} from '../domain/mcp';
import Icon from './Icon.vue';
import SkField from './ui/SkField.vue';import SkInput from './ui/SkInput.vue';import SkSelect from './ui/SkSelect.vue';import SkFieldset from './ui/SkFieldset.vue';import SkButton from './ui/SkButton.vue';import SkSwitch from './ui/SkSwitch.vue';import SkNumberInput from './ui/SkNumberInput.vue';import SkSaveBar from './ui/SkSaveBar.vue';
import SkSecretInput from './ui/SkSecretInput.vue';
import SkTextarea from './ui/SkTextarea.vue';
import '../styles/mcp.css';
const storage=useMcpUpgrade();
const mcp=useMcpSettings(),draft=computed(()=>mcp.current),blocked=computed(()=>!mcp.ready||mcp.loading||mcp.saving||storage.busy||storage.unknown),form=ref<HTMLFormElement>(),confirmation=ref<HTMLDialogElement>(),deletion=ref(''),attempted=ref(false);
const stdio=computed(()=>draft.value?.transport==='stdio'?draft.value:null),http=computed(()=>draft.value?.transport==='http'?draft.value:null);
const diagnostics=useMcpDiagnostics();
const outcome=computed(()=>diagnostics.rows[mcp.selected]);
const probe=computed(()=>outcome.value?.run);
const canDiagnose=computed(()=>storage.enabled&&!blocked.value&&!mcp.dirty&&!!saved.value&&diagnostics.known&&!diagnostics.occupied);
const oldRevision=computed(()=>!!probe.value&&probe.value.snapshot.configurationRevision!==mcp.configuration?.revision);
async function reconcile(){if(!storage.enabled)return;await diagnostics.reconcile(saved.value?.id);}
async function diagnose(){try{await diagnostics.start();await reconcile();}catch{}}
async function cancelProbe(){await diagnostics.cancel();await reconcile();}
let stopObserving:(()=>void)|undefined;
watch(()=>mcp.selected,()=>{if(saved.value&&storage.enabled)void diagnostics.readLatest(saved.value.id);});
watch(()=>storage.enabled,value=>{if(value)void reconcile();});
const saved=computed(()=>mcp.find(mcp.selected));
const secureAvailable=computed(()=>mcp.configuration?.secureStorageAvailable===true);
const jsonEntry=computed(()=>mcp.jsonPreview.entries[mcp.jsonSelection]);
const jsonError=computed(()=>mcp.jsonPreview.error||jsonEntry.value?.error||'');
const jsonOptions=computed(()=>mcp.jsonPreview.entries.map((item,index)=>({value:index,label:item.name||'未命名服务',description:item.draft?`${item.draft.transport==='http'?'Streamable HTTP':'stdio'} · 可以保存`:`${item.transport} · 需要处理`})));
function mode(value:'form'|'json'){try{mcp.setMode(value);attempted.value=false;}catch(e){mcp.error=e instanceof Error?e.message:'无法切换编辑方式，草稿已保留。';}}
function addJson(){add();mode('json');}
function credentialState(name:string){return mcp.configuration?.credentialStatus?.[mcp.selected]?.[name]||'missing';}
function credentialLabel(name:string){return ({stored:'已设置',missing:'缺失',unavailable:'暂不可访问'} as Record<string,string>)[credentialState(name)]||'暂不可访问';}
function changeTransport(value:'stdio'|'http'){try{mcp.setTransport(value);attempted.value=false;}catch(e){mcp.error=e instanceof Error?e.message:'无法切换连接方式，草稿已保留。';}}
function changeHttpUrl(value:string){if(http.value)http.value.url=value;}
function changeSource(index:number,value:McpEnvironment['source']){if(!stdio.value||value==='keychain'&&!secureAvailable.value)return;const item=stdio.value.env[index];mcp.clearSecret(item.name);item.source=value;item.value='';}
function changeName(index:number,value:string){if(!stdio.value)return;const item=stdio.value.env[index];mcp.clearSecret(item.name);item.name=value;}
function removeEnvironment(index:number){if(stdio.value){mcp.clearSecret(stdio.value.env[index].name);stdio.value.env.splice(index,1);}}
const nameError=computed(()=>attempted.value&&!draft.value?.name.trim()?'请填写服务名称。':'');
const commandError=computed(()=>attempted.value&&stdio.value&&!stdio.value.command.trim()?'请填写启动命令。':'');
const urlError=computed(()=>attempted.value&&http.value&&!http.value.url.trim()?'请填写 HTTP 服务地址。':'');
async function load(){try{await mcp.load();}catch{}}
async function save(){attempted.value=true;await nextTick();if(mcp.currentMode==='form'){if(nameError.value||commandError.value||urlError.value){form.value?.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus();return;}if(!form.value?.reportValidity())return;}try{await mcp.save();attempted.value=false;}catch{}}
function select(id:string){mcp.select(id);attempted.value=false;}
function add(){mcp.add();attempted.value=false;}
function askRemove(){deletion.value=mcp.selected;confirmation.value?.showModal();}
async function remove(){if(mcp.selected!==deletion.value){confirmation.value?.close();return;}try{await mcp.remove();confirmation.value?.close();}catch{confirmation.value?.close();}}
onMounted(()=>{if(!mcp.configuration&&!mcp.loading)void load();stopObserving=observeMcpDiagnostics(reconcile,async fn=>listen('mcp-probe-changed',fn),undefined,()=>storage.enabled&&(diagnostics.occupied||!diagnostics.known));});
onUnmounted(()=>stopObserving?.());
</script>
<template>
 <div class="mcp-page">
  <McpStoragePanel/>
  <p v-if="mcp.loading" role="status" class="muted">正在读取 MCP 服务配置…</p>
  <div v-if="!mcp.ready&&!mcp.loading" class="profile-alert" role="alert"><p>{{mcp.error||'服务配置尚未确认，请重新读取后核对。'}}</p><SkButton kind="entry" @click="load">重新读取，保留草稿</SkButton></div>
  <div v-else-if="mcp.error" class="form-error" role="alert">{{mcp.error}}</div>
  <div class="catalog-layout">
   <nav class="catalog-rail" aria-label="MCP 服务列表">
    <div class="catalog-rail-title"><span>工具服务</span><span>{{mcp.configuration?.servers.length||0}} / 20</span></div>
    <button v-for="item in mcp.entries" :key="item.id" class="catalog-provider" :class="{active:item.id===mcp.selected}" :aria-pressed="item.id===mcp.selected" :disabled="mcp.saving" @click="select(item.id)"><span><strong>{{item.name}}</strong><small>{{item.unsaved?'有未保存的修改':item.enabled?'已启用':'已禁用'}}</small></span></button>
    <SkButton kind="entry" :disabled="blocked||(mcp.configuration?.servers.length||0)>=20" @click="add"><Icon name="plus"/>新增 MCP 服务</SkButton>
    <SkButton kind="quiet" :disabled="blocked||(mcp.configuration?.servers.length||0)>=20" @click="addJson">粘贴 JSON 配置</SkButton>
   </nav>
   <section class="catalog-editor" aria-label="MCP 服务配置">
    <div v-if="!draft" class="catalog-empty"><h2>添加工具服务</h2><p>填写 stdio 启动方式或 Streamable HTTP 地址。保存后手动诊断，查看本次发现的工具；不会自动调用工具。</p></div>
    <template v-else>
     <header class="catalog-object-heading mcp-editor-heading"><div><h2>{{saved?draft.name||saved.name:'新增 MCP 服务'}}</h2><p>保存配置后手动诊断，查看服务提供的工具。</p></div><div class="mcp-editor-actions"><div class="mcp-mode-switch" role="group" aria-label="配置编辑方式"><button type="button" :aria-pressed="mcp.currentMode==='form'" :disabled="blocked" @click="mode('form')">表单</button><button type="button" :aria-pressed="mcp.currentMode==='json'" :disabled="blocked" @click="mode('json')">JSON</button></div><SkButton v-if="saved" kind="quiet" :disabled="blocked||mcp.dirty||diagnostics.occupant?.input.serverId===saved.id||diagnostics.starting||!!diagnostics.uncertain" @click="askRemove"><Icon name="trash"/>移除</SkButton></div></header>
     <SkFieldset v-if="mcp.currentMode==='form'" :disabled="blocked"><form ref="form" @submit.prevent="save">
      <div class="form-grid">
       <SkField label="服务名称" required :error="nameError"><SkInput v-model="draft.name" required maxlength="100" placeholder="例如：本机文档工具"/></SkField>
       <SkField label="连接方式"><SkSelect :model-value="draft.transport" :options="[{value:'stdio',label:'stdio · 本机命令'},{value:'http',label:'Streamable HTTP'}]" @update:model-value="changeTransport"/></SkField>
       <SkField v-if="stdio" class="full" label="启动命令" required :error="commandError" help="填写程序路径或命令名；参数请逐项填写，认证信息不要放在命令或参数中。"><SkInput v-model="stdio.command" required maxlength="4096" autocomplete="off" spellcheck="false" placeholder="程序路径或命令名"/></SkField>
       <SkField v-if="http" class="full" label="HTTP 服务地址" required :error="urlError" help="使用 HTTPS 或数字本机回环 HTTP；认证信息放在请求头引用中，不放入地址。"><SkInput :model-value="http?.url||''" @update:model-value="changeHttpUrl" type="url" required maxlength="4096" autocomplete="off" spellcheck="false" placeholder="http://127.0.0.1:端口/mcp"/></SkField>
      </div>
      <section v-if="stdio" class="mcp-arguments" aria-label="命令参数"><div class="catalog-section-heading"><h3>命令参数</h3><SkButton kind="quiet" :disabled="stdio.args.length>=128" @click="stdio.args.push('')"><Icon name="plus"/>添加参数</SkButton></div><p v-if="!stdio.args.length" class="muted">没有参数。每一项会原样作为一个参数，空格不会拆分。</p><div v-for="(_arg,index) in stdio.args" :key="index" class="catalog-header-row"><SkInput v-model="stdio.args[index]" :aria-label="`参数 ${index+1}`" maxlength="4096" autocomplete="off" spellcheck="false" placeholder="一个完整参数，也可以留空"/><button class="icon-button" type="button" :aria-label="`移除参数 ${index+1}`" @click="stdio.args.splice(index,1)"><Icon name="close"/></button></div></section>
      <div class="catalog-switch-row"><span><strong>启用服务</strong><small>{{http?'保存不会建立连接；禁用的服务仍可手动诊断。':'保存不会启动程序；禁用的服务仍可手动诊断。'}}</small></span><SkSwitch v-model="draft.enabled" label="启用 MCP 服务"/></div>
      <details class="catalog-advanced"><summary>工作目录与超时</summary><div class="form-grid"><SkField v-if="stdio" class="full" label="工作目录（可选）" help="留空使用本次任务目录；填写时使用绝对路径。"><SkInput :model-value="stdio.cwd||''" maxlength="4096" autocomplete="off" placeholder="留空使用本次任务目录" @update:model-value="stdio.cwd=$event||null"/></SkField><SkField label="连接超时（秒）"><SkNumberInput :model-value="draft.connectTimeoutMs/1000" :min="1" :max="30" @update:model-value="draft.connectTimeoutMs=Number($event)*1000"/></SkField><SkField label="工具超时（秒）"><SkNumberInput :model-value="draft.toolTimeoutMs/1000" :min="1" :max="60" @update:model-value="draft.toolTimeoutMs=Number($event)*1000"/></SkField></div><p class="muted">准备与工具执行共同受单次任务120秒总期限约束。</p></details>
      <details v-if="stdio" class="catalog-advanced"><summary>环境项 <span v-if="stdio.env.length">· {{stdio.env.length}} 项</span></summary><p class="muted">普通值会写入配置，请勿填写密钥。宿主变量只按所填名称解析；已有安全值只显示设置状态，不回读明文。</p><p v-if="!secureAvailable" class="muted">安全存储尚未启用，当前不能新增或替换安全值；可先使用宿主环境变量引用。</p>
       <div v-for="(item,index) in stdio.env" :key="index" class="mcp-env-row">
        <SkField :label="`环境项 ${index+1} 名称`" required><SkInput :model-value="item.name" required maxlength="128" autocomplete="off" placeholder="服务接收的变量名" @update:model-value="changeName(index,$event)"/></SkField>
        <SkField label="取值方式"><SkSelect :model-value="item.source" :options="[{value:'literal',label:'普通值（非秘密）'},{value:'environment',label:'宿主环境变量引用'},{value:'keychain',label:'安全值',disabled:!secureAvailable}]" @update:model-value="changeSource(index,$event)"/></SkField>
        <SkField v-if="item.source==='keychain'" :label="`安全值 · ${credentialLabel(item.name)}`" help="留空保留同服务、同名环境项的原值。改名后需重新填写；新输入仅保留在内存，保存确认后清除。"><SkSecretInput :model-value="mcp.secretDrafts[mcp.selected]?.[item.name]||''" :disabled="!secureAvailable" maxlength="4096" :placeholder="credentialState(item.name)==='stored'?'已设置 · 留空保留':'填写后保存安全值'" @update:model-value="mcp.setSecret(item.name,$event)"/></SkField>
        <SkField v-else :label="item.source==='literal'?'普通值':'宿主变量名'" :required="item.source==='environment'"><SkInput v-model="item.value" :required="item.source==='environment'" maxlength="4096" autocomplete="off" :placeholder="item.source==='literal'?'只填写非秘密值':'只填写变量名，不填写其值'"/></SkField>
        <button class="icon-button" type="button" :aria-label="`移除环境项 ${index+1}`" @click="removeEnvironment(index)"><Icon name="close"/></button>
       </div><SkButton kind="quiet" :disabled="stdio.env.length>=64" @click="stdio.env.push({name:'',source:'environment',value:''})"><Icon name="plus"/>添加环境项</SkButton></details>
       <section v-if="http" class="mcp-arguments" aria-label="HTTP 请求头引用"><div class="catalog-section-heading"><h3>请求头引用</h3><SkButton kind="quiet" :disabled="http.headers.length>=64" @click="http.headers.push({name:'',source:'environment',value:''})"><Icon name="plus"/>添加请求头</SkButton></div><p class="muted">左侧填写请求头名称，右侧填写宿主变量名。变量应提供完整头值（含需要的 Bearer 前缀）；不会读取 .env 或 Shell 配置，也不保存明文认证值。</p><p v-if="!http.headers.length" class="muted">没有自定义请求头。</p><div v-for="(header,index) in http.headers" :key="index" class="catalog-header-row"><SkInput v-model="header.name" :aria-label="`请求头 ${index+1} 名称`" required maxlength="128" placeholder="例如 Authorization" autocomplete="off" spellcheck="false"/><SkInput v-model="header.value" :aria-label="`请求头 ${index+1} 宿主变量名`" required maxlength="128" placeholder="例如 SIDEKICK_HTTP_AUTH" autocomplete="off" spellcheck="false"/><button class="icon-button" type="button" :aria-label="`移除请求头 ${index+1}`" @click="http.headers.splice(index,1)"><Icon name="close"/></button></div></section>
     </form></SkFieldset>
     <SkFieldset v-else :disabled="blocked" class="mcp-json-editor">
      <SkField label="MCP 配置 JSON" :error="jsonError" help="直接粘贴配置会自动识别格式；只在点击保存时写入，不会启动服务。"><SkTextarea :model-value="mcp.jsonText" rows="14" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder='{"mcpServers": {"my-server": {"command": "node", "args": []}}}' @update:model-value="mcp.setJsonText($event)"/></SkField>
      <div v-if="mcp.jsonPreview.entries.length" class="mcp-json-preview">
       <div class="mcp-json-recognition"><Icon name="check"/><span>已识别 {{mcp.jsonPreview.format}} · {{mcp.jsonPreview.entries.length}} 项服务</span></div>
       <SkField v-if="mcp.jsonPreview.entries.length>1" label="本次保存的服务" help="每次只保存所选的一项，其余服务不会导入。"><SkSelect :model-value="mcp.jsonSelection" :options="jsonOptions" @update:model-value="mcp.selectJsonEntry(Number($event))"/></SkField>
       <p v-if="jsonEntry?.draft" class="mcp-json-summary"><strong>{{jsonEntry.draft.name}}</strong><template v-if="jsonEntry.draft.transport==='stdio'"><span>stdio</span><span>{{jsonEntry.draft.args.length}} 个参数</span><span>{{jsonEntry.draft.env.length}} 个环境项</span></template><template v-else><span>Streamable HTTP</span><span>{{jsonEntry.draft.headers.length}} 个请求头引用</span></template></p>
       <p v-if="mcp.jsonPreview.format==='单个服务对象'" class="muted">没有名称时使用当前服务名或 new-server；可切换表单修改名称。</p>
       <p v-if="saved" class="muted">将更新当前服务「{{saved.name}}」，保留服务标识；不会按名称覆盖其他服务。</p>
      </div>
      <details class="catalog-advanced mcp-json-help"><summary>支持哪些配置格式？</summary><p>支持 mcpServers、服务名包裹、单个服务对象，以及 mcp_servers / servers 的 JSON 表达；Codex 的 TOML 需先转为 JSON。</p><p>stdio 字段：command、args 数组、cwd、enabled、env、env_vars。超时支持 Pi 的 timeout（秒）、startup_timeout_sec / tool_timeout_sec，或明确以毫秒命名的字段。</p><p>环境引用使用整值 ${NAME}；不执行内插、!command 或交互输入。认证值请改成宿主环境引用。HTTP 支持 url 与 headers 对象；所有头值仅接受整值 ${NAME} 引用。旧 SSE 和其他未支持字段会提示处理，避免静默丢失。</p><p>连接期限 1–30 秒，工具期限 1–60 秒；协议版本由 Pi 自动协商。</p></details>
     </SkFieldset>
     <section class="mcp-diagnostics" aria-labelledby="mcp-diagnostic-heading">
      <div class="catalog-section-heading"><h3 id="mcp-diagnostic-heading">连接诊断与工具</h3><SkButton kind="entry" :disabled="!canDiagnose" :loading="diagnostics.starting" @click="diagnose">连接诊断</SkButton></div>
      <p class="muted">{{http?'只初始化并发现工具，不调用工具；本次完成后关闭本地连接，不停止远端服务。':'只初始化并发现工具，不调用工具；本次完成后关闭服务进程。'}}</p>
      <p v-if="!saved||mcp.dirty||!mcp.ready" class="muted">请先保存并确认这项服务配置，再开始诊断。</p>
      <div v-if="diagnostics.uncertain" class="form-error" role="alert">开始请求结果未确认，暂不重复启动；请重新核对诊断状态。</div>
      <p v-if="diagnostics.occupant" role="status">{{diagnostics.occupant.errorCode==='MCP_CLEANUP'?'进程清理未确认，活动槽仍保留。':'诊断正在准备、发现工具或收尾…'}}<span v-if="diagnostics.occupant.input.serverId!==saved?.id">（另一项服务）</span></p>
      <div class="mcp-diagnostic-actions"><SkButton v-if="diagnostics.active&&!diagnostics.uncertain" kind="quiet" :loading="!!diagnostics.cancelling" @click="cancelProbe">{{diagnostics.active?.snapshot.transport==='http'?'断开诊断':'取消诊断'}}</SkButton><SkButton kind="quiet" :disabled="diagnostics.starting||outcome?.loading" @click="reconcile">重新核对诊断状态</SkButton></div>
      <p v-if="diagnostics.error" class="form-error" role="alert">{{diagnostics.error}}</p><p v-if="diagnostics.notice" role="status" class="muted">{{diagnostics.notice}}</p>
      <p v-if="outcome?.loading" role="status" class="muted">正在核对诊断记录与目录…</p><p v-if="outcome?.error" role="alert" class="form-error">{{outcome.error}}</p>
      <template v-if="probe">
       <p v-if="diagnostics.passed(mcp.selected)" role="status" class="mcp-probe-success">最近一次诊断完成，{{probe.snapshot.transport==='http'?'本地连接已关闭':'进程已清理'}}。发现 {{outcome?.catalog?.tools.length||0}} 项工具。</p>
       <p v-else-if="probe.status==='succeeded'&&!outcome?.error" role="status" class="muted">历史记录仅有摘要，尚无已核验的完整工具目录。</p>
       <p v-else-if="['failed','cancelled','interrupted'].includes(probe.status)" role="alert" class="form-error">{{probeMessage(probe.errorCode)}}</p>
       <p v-if="probe.snapshot.transport==='http'&&probe.result?.remoteClose==='unconfirmed'" class="mcp-history-note">本地连接已关闭；远端会话关闭未确认，不会自动重试。</p><p v-if="probe.snapshot.transport==='http'&&probe.result?.remoteClose==='unsupported'" class="muted">远端未提供会话关闭接口，本地连接已关闭。</p>
       <p v-if="oldRevision" class="mcp-history-note">旧配置结果：来自先前保存的修订，请重新诊断当前配置。</p><p v-if="mcp.dirty" class="muted">当前草稿尚未保存，已有结果不会随草稿改变。</p>
       <p class="muted">若事项整理任务正在使用服务，请先在任务页取消该任务；断开不撤销已完成的外部操作。</p><p class="muted">诊断记录 · {{displayTime(probe.createdAtMs)}}</p>
       <p v-if="diagnostics.passed(mcp.selected)&&!outcome?.catalog?.tools.length" class="muted">服务初始化成功，但未提供工具。</p>
       <ul v-if="outcome?.catalog" class="mcp-tool-list"><li v-for="tool in outcome.catalog.tools" :key="tool.name"><strong>{{tool.name}}</strong><p v-if="tool.description">{{tool.description}}</p><details><summary>输入格式（只读）</summary><pre tabindex="0" :aria-label="`${tool.name} 输入格式`">{{JSON.stringify(tool.inputSchema,null,2)}}</pre></details></li></ul>
      </template><p v-else-if="saved&&!outcome?.loading&&!outcome?.error" class="muted">还没有这项服务的诊断记录。</p>
     </section>
     <details v-if="saved" class="catalog-advanced"><summary>服务标识</summary><p class="muted">{{saved.id}} · 重命名后保持不变。</p></details>
    </template>
   </section>
  </div>
  <SkSaveBar v-if="draft" target="#settings-save-slot" :dirty="mcp.dirty" :busy="mcp.saving||storage.busy" :disabled="!mcp.ready||mcp.loading||storage.busy||storage.unknown||mcp.currentMode==='json'&&!!jsonError" :error="mcp.error" :notice="mcp.notice" label="保存服务配置" @save="save" @discard="mcp.discard();attempted=false"/>
  <dialog ref="confirmation" class="dialog confirm-dialog" aria-labelledby="mcp-remove-heading" @cancel.prevent="!mcp.saving&&confirmation?.close()"><header class="dialog-header"><h2 id="mcp-remove-heading">移除这项服务配置？</h2></header><div class="dialog-body"><p>{{saved?.name}}</p><p class="muted">只移除配置，保留历史记录，不删除服务程序和运行产物。</p></div><footer class="dialog-footer"><SkButton :disabled="mcp.saving" @click="confirmation?.close()">取消</SkButton><SkButton kind="danger" :loading="mcp.saving" @click="remove">确认移除配置</SkButton></footer></dialog>
 </div>
</template>
