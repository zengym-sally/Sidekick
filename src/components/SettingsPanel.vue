<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { getVersion } from '@tauri-apps/api/app';
import { Button as TButton } from 'tdesign-vue-next';
import { useProfile } from '../stores/profile';
import { currentZone } from '../domain/todos';
import Icon from './Icon.vue';
const props=defineProps<{tab:'profile'|'general'|'about';root:string}>();
const emit=defineEmits<{selectTab:[tab:'profile'|'general'|'about'];openDirectory:[]}>();
const profile=useProfile(),version=ref(''),versionError=ref(false),savedNotice=ref('');
const tabs=[{id:'profile',label:'个人信息'},{id:'general',label:'通用设置'},{id:'about',label:'关于'}] as const;
async function save(){savedNotice.value='';try{await profile.save();savedNotice.value=profile.warning?'':'个人信息已保存。';}catch{}}
async function loadVersion(){versionError.value=false;try{version.value=await getVersion();}catch{versionError.value=true;}}
function tabKey(event:KeyboardEvent){
  const index=tabs.findIndex(tab=>tab.id===props.tab);let next=index;
  if(event.key==='ArrowRight')next=(index+1)%tabs.length;else if(event.key==='ArrowLeft')next=(index+tabs.length-1)%tabs.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=tabs.length-1;else return;
  event.preventDefault();emit('selectTab',tabs[next].id);document.getElementById(`settings-tab-${tabs[next].id}`)?.focus();
}
onMounted(loadVersion);
</script>
<template>
  <div class="page-intro"><h1>让班班更懂你。</h1><p>个人偏好和工作空间，都在这里安排。</p></div>
  <div class="settings-tabs" role="tablist" aria-label="设置分类" @keydown="tabKey"><button v-for="item in tabs" :id="`settings-tab-${item.id}`" :key="item.id" role="tab" :aria-selected="tab===item.id" :aria-controls="`settings-panel-${item.id}`" :tabindex="tab===item.id?0:-1" @click="emit('selectTab',item.id)">{{ item.label }}</button></div>
  <section v-show="tab==='profile'" id="settings-panel-profile" class="settings-panel" role="tabpanel" aria-labelledby="settings-tab-profile">
    <p class="muted">告诉班班怎么认识你、怎么称呼你。这些偏好只保存在当前工作目录。</p>
    <p v-if="profile.loading" class="muted" role="status">正在读取个人信息…</p>
    <div v-if="profile.loadError" class="profile-alert" role="alert"><p>{{ profile.loadError }}</p><p class="muted">暂用默认称呼 BOSS，重新读取前不会覆盖原配置。</p><TButton class="button entry" :disabled="profile.loading" @click="profile.load">重新读取</TButton></div>
    <form class="profile-form" @submit.prevent="save"><div class="field"><label for="profile-name">昵称</label><input id="profile-name" v-model="profile.draft.name" maxlength="60" placeholder="小明同学" :disabled="!profile.ready||profile.loading||profile.saving" @input="savedNotice=''"></div><div class="field"><div class="address-heading"><label for="profile-address">班班对我的称呼</label><button class="text-button" type="button" :disabled="!profile.ready||profile.loading||profile.saving" @click="profile.useNickname();savedNotice=''">与昵称一致</button></div><input id="profile-address" v-model="profile.draft.address" maxlength="60" placeholder="BOSS" aria-describedby="profile-address-help" :disabled="!profile.ready||profile.loading||profile.saving" @input="savedNotice=''"><small id="profile-address-help" class="muted">默认 BOSS。可复制当前昵称，保存后生效。</small></div>
      <div class="profile-preview"><Icon name="user"/><span>保存后，班班会这样招呼你：<strong>{{ profile.draft.address.trim()||'BOSS' }}，随时交给我。</strong></span></div>
      <p v-if="profile.saveError" class="form-error" role="alert">{{ profile.saveError }}</p><p v-if="profile.warning" class="profile-alert" role="status">{{ profile.warning }}</p><p v-if="savedNotice" class="saved-notice" role="status">{{ savedNotice }}</p>
      <TButton class="button primary" type="submit" :loading="profile.saving" :disabled="!profile.ready||profile.loading||profile.saving"><Icon name="check"/>保存个人信息</TButton>
    </form>
  </section>
  <section v-show="tab==='general'" id="settings-panel-general" class="settings-panel" role="tabpanel" aria-labelledby="settings-tab-general"><h2>工作目录</h2><label for="workspace-location">当前保存位置</label><input id="workspace-location" class="path-input" :value="root" readonly><TButton class="button ghost" @click="emit('openDirectory')"><Icon name="folder"/>打开目录</TButton><p class="muted">事项与个人偏好保存在这个工作目录，重开应用后会继续使用。</p><h2>时间显示</h2><p>当前设备时区：{{ currentZone() }}</p><p class="muted">交付截止与下次跟进分别保存，修改一个时间不会连带修改另一个。</p></section>
  <section v-show="tab==='about'" id="settings-panel-about" class="settings-panel" role="tabpanel" aria-labelledby="settings-tab-about"><h2>跟班 Sidekick</h2><p>盯着呢，老板。</p><p v-if="version">版本 {{ version }}</p><p v-else-if="versionError">暂时无法读取版本。<button class="text-button" @click="loadVersion">重新读取</button></p><p v-else class="muted">正在读取版本…</p><h2>当前可用</h2><p>手工录入、事项管理与本地保存。</p><p class="muted">智能整理、持续收集、提醒与日报仍在开发中。</p></section>
</template>
