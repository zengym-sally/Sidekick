<script setup lang="ts">
import {onMounted,useId} from 'vue';
import {useDesktopPreferences} from '../stores/desktopPreferences';
import SkSwitch from './ui/SkSwitch.vue';
import SkFieldset from './ui/SkFieldset.vue';
import SkButton from './ui/SkButton.vue';
import SkSaveBar from './ui/SkSaveBar.vue';
const preferences=useDesktopPreferences(),workHelp=`work-mode-${useId()}`,startupHelp=`pet-startup-${useId()}`;
onMounted(()=>{void preferences.load(false);});
</script>
<template><div>
 <p v-if="preferences.loading" role="status" class="muted">正在读取桌面偏好…</p>
 <div v-if="!preferences.ready&&!preferences.loading" class="profile-alert" role="alert"><p>{{preferences.error||'桌面偏好尚未确认，请重新读取后继续。'}}</p><SkButton kind="entry" :disabled="preferences.saving" @click="preferences.load()">重新读取，保留草稿</SkButton></div>
 <SkFieldset :disabled="!preferences.ready||preferences.loading||preferences.saving">
  <div class="settings-section"><div class="settings-section-label"><h2>工作模式</h2><p>减少界面打扰。</p></div><div class="settings-section-body"><div class="catalog-switch-row"><span><strong>减少装饰动效</strong><small :id="workHelp">保存后同步到各窗口，保留文字状态、操作反馈与全部入口。</small></span><SkSwitch v-model="preferences.draft.workMode" label="工作模式" :aria-describedby="workHelp"/></div></div></div>
  <div class="settings-section"><div class="settings-section-label"><h2>启动时的班班</h2><p>下次打开应用时生效。</p></div><div class="settings-section-body"><div class="catalog-switch-row"><span><strong>启动时显示班班</strong><small :id="startupHelp">本次显隐仍由托盘控制；此项不会更改系统登录启动设置。</small></span><SkSwitch v-model="preferences.draft.petOnStartup" label="启动时显示班班" :aria-describedby="startupHelp"/></div></div></div>
 </SkFieldset>
 <SkSaveBar target="#settings-save-slot" :dirty="preferences.dirty" :busy="preferences.saving" :disabled="!preferences.ready||preferences.loading" :error="preferences.error" :notice="preferences.notice" label="保存桌面偏好" @save="preferences.save" @discard="preferences.discard"/>
</div></template>
