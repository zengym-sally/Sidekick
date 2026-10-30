<script setup lang="ts">
import {computed,nextTick,onMounted,ref} from 'vue';
import {useMcpSettings} from '../stores/mcp';
import type {McpEnvironment} from '../domain/mcp';
import Icon from './Icon.vue';
import SkField from './ui/SkField.vue';import SkInput from './ui/SkInput.vue';import SkSelect from './ui/SkSelect.vue';import SkFieldset from './ui/SkFieldset.vue';import SkButton from './ui/SkButton.vue';import SkSwitch from './ui/SkSwitch.vue';import SkNumberInput from './ui/SkNumberInput.vue';import SkSaveBar from './ui/SkSaveBar.vue';
import SkSecretInput from './ui/SkSecretInput.vue';
const mcp=useMcpSettings(),draft=computed(()=>mcp.current),blocked=computed(()=>!mcp.ready||mcp.loading||mcp.saving),form=ref<HTMLFormElement>(),confirmation=ref<HTMLDialogElement>(),deletion=ref(''),attempted=ref(false);
const saved=computed(()=>mcp.find(mcp.selected));
const secureAvailable=computed(()=>mcp.configuration?.secureStorageAvailable===true);
function credentialState(name:string){return mcp.configuration?.credentialStatus?.[mcp.selected]?.[name]||'missing';}
function credentialLabel(name:string){return ({stored:'已设置',missing:'缺失',unavailable:'暂不可访问'} as Record<string,string>)[credentialState(name)]||'暂不可访问';}
function changeSource(index:number,value:McpEnvironment['source']){if(!draft.value||value==='keychain'&&!secureAvailable.value)return;const item=draft.value.env[index];mcp.clearSecret(item.name);item.source=value;item.value='';}
function changeName(index:number,value:string){if(!draft.value)return;const item=draft.value.env[index];mcp.clearSecret(item.name);item.name=value;}
function removeEnvironment(index:number){if(draft.value){mcp.clearSecret(draft.value.env[index].name);draft.value.env.splice(index,1);}}
const nameError=computed(()=>attempted.value&&!draft.value?.name.trim()?'请填写服务名称。':'');
const commandError=computed(()=>attempted.value&&!draft.value?.command.trim()?'请填写启动命令。':'');
async function load(){try{await mcp.load();}catch{}}
async function save(){attempted.value=true;await nextTick();if(nameError.value||commandError.value){form.value?.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus();return;}if(!form.value?.reportValidity())return;try{await mcp.save();attempted.value=false;}catch{}}
function select(id:string){mcp.select(id);attempted.value=false;}
function add(){mcp.add();attempted.value=false;}
function askRemove(){deletion.value=mcp.selected;confirmation.value?.showModal();}
async function remove(){if(mcp.selected!==deletion.value){confirmation.value?.close();return;}try{await mcp.remove();confirmation.value?.close();}catch{confirmation.value?.close();}}
onMounted(()=>{if(!mcp.configuration&&!mcp.loading)void load();});
</script>
<template>
 <div class="mcp-page">
  <p v-if="mcp.loading" role="status" class="muted">正在读取 MCP 服务配置…</p>
  <div v-if="!mcp.ready&&!mcp.loading" class="profile-alert" role="alert"><p>{{mcp.error||'服务配置尚未确认，请重新读取后核对。'}}</p><SkButton kind="entry" @click="load">重新读取，保留草稿</SkButton></div>
  <div v-else-if="mcp.error" class="form-error" role="alert">{{mcp.error}}</div>
  <div class="catalog-layout">
   <nav class="catalog-rail" aria-label="MCP 服务列表">
    <div class="catalog-rail-title"><span>本机服务</span><span>{{mcp.configuration?.servers.length||0}} / 20</span></div>
    <button v-for="item in mcp.entries" :key="item.id" class="catalog-provider" :class="{active:item.id===mcp.selected}" :aria-pressed="item.id===mcp.selected" :disabled="mcp.saving" @click="select(item.id)"><span><strong>{{item.name}}</strong><small>{{item.unsaved?'有未保存的修改':item.enabled?'启用 · 未测试连接':'已禁用'}}</small></span></button>
    <SkButton kind="entry" :disabled="blocked||(mcp.configuration?.servers.length||0)>=20" @click="add"><Icon name="plus"/>新增 MCP 服务</SkButton>
   </nav>
   <section class="catalog-editor" aria-label="MCP 服务配置">
    <div v-if="!draft" class="catalog-empty"><h2>添加本机工具服务</h2><p>填写一项 stdio 服务的启动方式。保存只记录配置，连接诊断与工具发现将在后续步骤开放。</p></div>
    <template v-else>
     <header class="catalog-object-heading"><div><h2>{{saved?draft.name||saved.name:'新增 MCP 服务'}}</h2><p>配置保存后供后续新任务使用；当前尚未测试连接。</p></div><SkButton v-if="saved" kind="quiet" :disabled="blocked||mcp.dirty" @click="askRemove"><Icon name="trash"/>移除配置</SkButton></header>
     <SkFieldset :disabled="blocked"><form ref="form" @submit.prevent="save">
      <div class="form-grid">
       <SkField label="服务名称" required :error="nameError"><SkInput v-model="draft.name" required maxlength="100" placeholder="例如：本机文档工具"/></SkField>
       <SkField label="连接方式"><SkInput model-value="stdio · 本机进程" readonly/></SkField>
       <SkField class="full" label="启动命令" required :error="commandError" help="填写程序路径或命令名；参数请逐项填写，认证信息不要放在命令或参数中。"><SkInput v-model="draft.command" required maxlength="4096" autocomplete="off" spellcheck="false" placeholder="程序路径或命令名"/></SkField>
      </div>
      <section class="mcp-arguments" aria-label="命令参数"><div class="catalog-section-heading"><h3>命令参数</h3><SkButton kind="quiet" :disabled="draft.args.length>=128" @click="draft.args.push('')"><Icon name="plus"/>添加参数</SkButton></div><p v-if="!draft.args.length" class="muted">没有参数。每一项会原样作为一个参数，空格不会拆分。</p><div v-for="(_arg,index) in draft.args" :key="index" class="catalog-header-row"><SkInput v-model="draft.args[index]" :aria-label="`参数 ${index+1}`" maxlength="4096" autocomplete="off" spellcheck="false" placeholder="一个完整参数，也可以留空"/><button class="icon-button" type="button" :aria-label="`移除参数 ${index+1}`" @click="draft.args.splice(index,1)"><Icon name="close"/></button></div></section>
      <div class="catalog-switch-row"><span><strong>启用服务</strong><small>保存配置不会启动程序。禁用只影响后续新任务。</small></span><SkSwitch v-model="draft.enabled" label="启用 MCP 服务"/></div>
      <details class="catalog-advanced"><summary>工作目录与超时</summary><div class="form-grid"><SkField class="full" label="工作目录（可选）" help="留空使用本次任务目录；填写时使用绝对路径。"><SkInput :model-value="draft.cwd||''" maxlength="4096" autocomplete="off" placeholder="留空使用本次任务目录" @update:model-value="draft.cwd=$event||null"/></SkField><SkField label="连接超时（秒）"><SkNumberInput :model-value="draft.connectTimeoutMs/1000" :min="1" :max="30" @update:model-value="draft.connectTimeoutMs=Number($event)*1000"/></SkField><SkField label="工具超时（秒）"><SkNumberInput :model-value="draft.toolTimeoutMs/1000" :min="1" :max="60" @update:model-value="draft.toolTimeoutMs=Number($event)*1000"/></SkField></div><p class="muted">准备与工具执行共同受单次任务120秒总期限约束。</p></details>
      <details class="catalog-advanced"><summary>环境项 <span v-if="draft.env.length">· {{draft.env.length}} 项</span></summary><p class="muted">普通值会写入配置，请勿填写密钥。宿主变量只按所填名称解析；已有安全值只显示设置状态，不回读明文。</p><p v-if="!secureAvailable" class="muted">安全存储尚未启用，当前不能新增或替换安全值；可先使用宿主环境变量引用。</p>
       <div v-for="(item,index) in draft.env" :key="index" class="mcp-env-row">
        <SkField :label="`环境项 ${index+1} 名称`" required><SkInput :model-value="item.name" required maxlength="128" autocomplete="off" placeholder="服务接收的变量名" @update:model-value="changeName(index,$event)"/></SkField>
        <SkField label="取值方式"><SkSelect :model-value="item.source" :options="[{value:'literal',label:'普通值（非秘密）'},{value:'environment',label:'宿主环境变量引用'},{value:'keychain',label:'安全值',disabled:!secureAvailable}]" @update:model-value="changeSource(index,$event)"/></SkField>
        <SkField v-if="item.source==='keychain'" :label="`安全值 · ${credentialLabel(item.name)}`" help="留空保留同服务、同名环境项的原值。改名后需重新填写；新输入仅保留在内存，保存确认后清除。"><SkSecretInput :model-value="mcp.secretDrafts[mcp.selected]?.[item.name]||''" :disabled="!secureAvailable" maxlength="4096" :placeholder="credentialState(item.name)==='stored'?'已设置 · 留空保留':'填写后保存安全值'" @update:model-value="mcp.setSecret(item.name,$event)"/></SkField>
        <SkField v-else :label="item.source==='literal'?'普通值':'宿主变量名'" :required="item.source==='environment'"><SkInput v-model="item.value" :required="item.source==='environment'" maxlength="4096" autocomplete="off" :placeholder="item.source==='literal'?'只填写非秘密值':'只填写变量名，不填写其值'"/></SkField>
        <button class="icon-button" type="button" :aria-label="`移除环境项 ${index+1}`" @click="removeEnvironment(index)"><Icon name="close"/></button>
       </div><SkButton kind="quiet" :disabled="draft.env.length>=64" @click="draft.env.push({name:'',source:'environment',value:''})"><Icon name="plus"/>添加环境项</SkButton></details>
     </form></SkFieldset>
     <details v-if="saved" class="catalog-advanced"><summary>服务标识</summary><p class="muted">{{saved.id}} · 重命名后保持不变。</p></details>
    </template>
   </section>
  </div>
  <SkSaveBar v-if="draft" target="#settings-save-slot" :dirty="mcp.dirty" :busy="mcp.saving" :disabled="!mcp.ready||mcp.loading" :error="mcp.error" :notice="mcp.notice" label="保存服务配置" @save="save" @discard="mcp.discard();attempted=false"/>
  <dialog ref="confirmation" class="dialog confirm-dialog" aria-labelledby="mcp-remove-heading" @cancel.prevent="!mcp.saving&&confirmation?.close()"><header class="dialog-header"><h2 id="mcp-remove-heading">移除这项服务配置？</h2></header><div class="dialog-body"><p>{{saved?.name}}</p><p class="muted">只移除配置，保留历史记录，不删除服务程序和运行产物。</p></div><footer class="dialog-footer"><SkButton :disabled="mcp.saving" @click="confirmation?.close()">取消</SkButton><SkButton kind="danger" :loading="mcp.saving" @click="remove">确认移除配置</SkButton></footer></dialog>
 </div>
</template>
