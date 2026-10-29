<script setup lang="ts">
import { computed,onMounted,ref } from 'vue';
import { Button as TButton } from 'tdesign-vue-next';
import { useModelSettings } from '../stores/models';
import { useOrganizer } from '../stores/organizer';
import { runError } from '../domain/organizer';
import Icon from './Icon.vue';
const model=useModelSettings(),organizer=useOrganizer(),testing=ref(false);
const currentProvider=computed(()=>{const m=model.configuration?.models.models.find(m=>m.id===model.basic.selected);return model.configuration?.providers.providers.find(p=>p.id===m?.providerId);});
const credential=computed(()=>currentProvider.value?model.configuration?.credentialStatus[currentProvider.value.id]:null);
const importedModels=computed(()=>{try{const value=JSON.parse(model.modelJson);return Array.isArray(value.models)?value.models.filter((m:{id?:unknown})=>typeof m.id==='string') as {id:string;name?:string}[]:[];}catch{return [];}});
async function save(){try{await model.saveBasic();}catch{}}
async function importPair(){try{await model.importPair();}catch{}}
async function test(){testing.value=true;try{await organizer.testModel();}catch{}finally{testing.value=false;}}
onMounted(()=>{if(!model.ready)void model.load();});
</script>
<template><section class="settings-panel model-settings"><h2>默认模型</h2><p class="muted">配置一个OpenAI兼容服务，先让班班能读懂你贴来的文本。密钥只写入系统钥匙串。</p>
  <p v-if="model.loading" class="muted" role="status">正在读取模型配置…</p>
  <p v-if="model.error" class="form-error" role="alert">{{ model.error }} <button class="text-button" @click="model.load">重新读取</button></p>
  <form @submit.prevent="save"><fieldset :disabled="!model.ready||model.loading||model.saving"><label v-if="model.configuration" class="field">默认模型<select :value="model.basic.selected" @change="model.select(($event.target as HTMLSelectElement).value)"><option v-for="entry in model.configuration.models.models" :key="entry.id" :value="entry.id">{{ entry.name||entry.id }}</option></select></label>
    <div class="form-grid"><label class="field">供应商名称<input v-model="model.basic.name" maxlength="100" required></label><label class="field">API模型标识<input v-model="model.basic.apiModelId" placeholder="服务商提供的模型名称" maxlength="256" required></label><label class="field full">服务地址<input v-model="model.basic.url" type="url" placeholder="OpenAI兼容API的base URL" required></label><label class="field full">API Key<input v-model="model.basic.apiKey" type="password" autocomplete="new-password" :placeholder="credential==='stored'?'已保存；留空保留现有密钥':'填写后保存到系统钥匙串'"><small class="muted">{{ credential==='stored'?'已有钥匙串凭据。':credential==='environment'?'当前使用宿主环境变量。':'尚未确认可用凭据。' }} 新填写的Key会替换当前供应商的认证引用。</small></label></div>
    <div class="model-actions"><TButton class="button primary" type="submit" :loading="model.saving"><Icon name="check"/>保存模型</TButton><button v-if="model.dirty" class="text-button" type="button" @click="model.resetBasic">还原基础表单</button><TButton class="button entry" :disabled="!model.configuration||model.dirty||organizer.running||model.saving||testing" @click="test">测试连接</TButton><button v-if="organizer.running&&organizer.run?.kind==='test'" type="button" class="text-button" @click="organizer.cancel">取消测试</button></div>
  </fieldset></form>
  <p v-if="model.notice" class="saved-notice" role="status">{{ model.notice }}</p>
  <p v-if="organizer.error" class="form-error" role="alert">{{ organizer.error }}</p>
  <div v-if="organizer.run?.kind==='test'" class="connection-result" role="status"><span v-if="model.dirty">当前有未保存修改，此测试仍对应已保存配置。请保存后重新测试。</span><span v-else-if="organizer.run.snapshot.revision!==model.configuration?.revision">模型配置已更新，请重新测试；当前任务仍使用启动时的配置。</span><span v-else-if="organizer.running">正在实际调用模型服务…</span><span v-else-if="organizer.run.status==='succeeded'">连接测试通过，模型已真实响应。</span><span v-else>{{ runError(organizer.run) }}</span></div>
  <details class="model-import"><summary>导入兼容配置JSON</summary><fieldset :disabled="model.loading||model.saving||!model.ready"><p class="muted">分别粘贴providers与models样例结构，保留元数据。配置里只能使用apiKeyEnv或apiKeyRef，不要粘贴明文密钥。</p><label class="field">providers.json<textarea v-model="model.providerJson" rows="9" spellcheck="false"/></label><label class="field">models.json<textarea v-model="model.modelJson" rows="9" spellcheck="false"/></label><label class="field">导入后的默认模型<select v-model="model.importDefault"><option value="">请选择内部模型ID</option><option v-for="entry in importedModels" :key="entry.id" :value="entry.id">{{ entry.name||entry.id }}</option></select></label><TButton class="button primary" :disabled="!model.ready||model.saving||!model.importDefault" @click="importPair">导入并保存</TButton><button class="text-button" type="button" @click="model.resetJson">还原导入草稿</button></fieldset></details>
</section></template>
