<script setup lang="ts">
import {computed,onMounted,onUnmounted,reactive} from 'vue';
import {createQuickEntry} from '../stores/quickEntry';
import {createDesktopWindows,workspaceEvents} from '../stores/desktop';
import {observeWorkspaceChanges} from '../domain/desktop';
import SkButton from './ui/SkButton.vue';
import SkField from './ui/SkField.vue';
import SkFieldset from './ui/SkFieldset.vue';
import SkInput from './ui/SkInput.vue';
import SkSelect from './ui/SkSelect.vue';
import TimeField from './TimeField.vue';
const entry=reactive(createQuickEntry()),desktop=reactive(createDesktopWindows());
const shortcut=computed(()=>desktop.status?desktop.status.shortcutRegistered?'⌘⇧K 打开此窗口':'全局快捷键未能注册，可通过托盘的快速录入打开。':desktop.statusError?'全局快捷键状态无法确认，可通过托盘打开。':'');
const blocked=computed(()=>!entry.ready||entry.loading||entry.saving||entry.uncertain);
let observation:ReturnType<typeof observeWorkspaceChanges>|undefined;
function focus(){void observation?.refresh().catch(()=>{});void desktop.refreshStatus();}
onMounted(()=>{
 observation=observeWorkspaceChanges(workspaceEvents,entry.activate,entry.activate);
 void observation.ready.catch(()=>{});window.addEventListener('focus',focus);
 void desktop.refreshStatus();
});
onUnmounted(()=>{observation?.stop();entry.dispose();desktop.dispose();window.removeEventListener('focus',focus);});
</script>
<template>
<main class="quick-entry-surface"><header><div><h1>快速录入</h1><p class="muted">手工保存事项，文字智能整理在工作台中使用。</p></div><SkButton kind="quiet" @click="desktop.act('open_main')">打开工作台</SkButton></header>
<p v-if="shortcut" class="muted">{{shortcut}}</p>
<p v-if="entry.error||desktop.error" class="danger" role="alert">{{entry.error||desktop.error}}</p><p v-if="entry.notice" role="status">{{entry.notice}}</p>
<p v-if="entry.loading" role="status">正在核对工作目录和日期规则…</p>
<p v-else-if="!entry.ready&&!entry.uncertain" class="muted">请先在工作台选择工作目录，完成后返回此窗口重新核对。</p>
<form @submit.prevent="entry.save"><SkFieldset :disabled="blocked"><div class="form-grid">
<SkField label="标题" class="full" required><SkInput v-model="entry.form.title" maxlength="200" required placeholder="记下要做或跟进的事"/></SkField>
<SkField label="类型"><SkSelect v-model="entry.form.kind" :options="[{value:'action',label:'待我处理'},{value:'followup',label:'待我跟进'}]"/></SkField>
<SkField label="负责人" required><SkInput v-model="entry.form.owner" maxlength="100" required/></SkField>
<SkField label="优先级"><SkSelect v-model="entry.form.priority" :options="[{value:'low',label:'低'},{value:'medium',label:'中'},{value:'high',label:'高'}]"/></SkField>
<SkField label="标签"><SkInput v-model="entry.form.tags" placeholder="用逗号分隔，可留空"/></SkField>
<TimeField :state="entry.form.due" label="交付截止"/><TimeField v-if="entry.form.kind==='followup'" :state="entry.form.followup" label="下次跟进"/>
</div></SkFieldset><footer><SkButton kind="quiet" :disabled="entry.loading||entry.saving" @click="entry.activate">重新核对</SkButton><SkButton kind="commit" type="submit" :loading="entry.saving" :disabled="!entry.ready||entry.loading">{{entry.uncertain?'重试原保存':'保存事项'}}</SkButton></footer></form>
</main>
</template>
<style scoped>
.quick-entry-surface{max-width:700px;min-height:100vh;margin:auto;padding:24px;background:var(--ivory)}header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:16px}header p{margin-bottom:0}.form-grid{margin-top:20px}footer{display:flex;justify-content:flex-end;gap:12px;margin-top:24px;padding-top:16px;border-top:1px solid var(--line)}@media(max-width:480px){.quick-entry-surface{padding:20px}header{flex-wrap:wrap}}
</style>
