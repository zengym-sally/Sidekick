<script setup lang="ts">
import {nextTick,onMounted,ref} from 'vue';
import {useMcpUpgrade} from '../stores/mcpUpgrade';
import SkButton from './ui/SkButton.vue';
import SkCheckbox from './ui/SkCheckbox.vue';
const storage=useMcpUpgrade(),region=ref<HTMLElement>(),dialog=ref<HTMLDialogElement>(),consent=ref(false),token=ref('');
async function load(){try{await storage.load();}catch{}}
async function ask(){if(!storage.canConfirm)return;consent.value=false;token.value=storage.status?.confirmationToken||'';dialog.value?.showModal();await nextTick();dialog.value?.querySelector<HTMLButtonElement>('button')?.focus();}
async function confirm(){if(!consent.value||token.value!==storage.status?.confirmationToken||!storage.canConfirm)return;try{await storage.confirm(true);}catch{}finally{dialog.value?.close();consent.value=false;await nextTick();region.value?.querySelector<HTMLButtonElement>('[data-storage-refresh]')?.focus();}}
function close(){if(!storage.busy)dialog.value?.close();}
onMounted(()=>{if(!storage.loading&&!storage.busy)void load();});
</script>
<template>
 <section ref="region" class="mcp-diagnostics mcp-storage" aria-labelledby="mcp-storage-heading">
  <div class="catalog-section-heading"><h3 id="mcp-storage-heading">诊断存储</h3><SkButton v-if="storage.canConfirm" kind="entry" @click="ask">开启诊断存储</SkButton></div>
  <p v-if="storage.loading" role="status" class="muted">正在核对工作目录…</p>
  <p v-else-if="storage.busy" role="status">正在备份并开启，请等待完成。此过程不能中途取消。</p>
  <p v-else-if="storage.enabled" role="status">诊断存储已开启。可以保存诊断记录，不会自动连接服务。</p>
  <p v-else-if="storage.canConfirm" class="muted">此工作目录需要先备份升级，才能保存 MCP 诊断记录；服务配置仍可先保存。</p>
  <p v-if="storage.status" class="muted mcp-storage-path">当前工作目录：{{storage.status.root}}</p>
  <p v-if="storage.backup" class="muted mcp-storage-path">本次已确认备份：{{storage.backup}}</p>
  <p v-if="storage.error" role="alert" class="form-error">{{storage.error}}</p>
  <SkButton v-if="!storage.busy" data-storage-refresh kind="quiet" :disabled="storage.loading" @click="load">重新核对存储状态</SkButton>
  <dialog ref="dialog" class="dialog confirm-dialog" aria-labelledby="mcp-storage-confirm-heading" @cancel.prevent="close">
   <header class="dialog-header"><h2 id="mcp-storage-confirm-heading">备份并开启诊断存储？</h2></header>
   <div class="dialog-body">
    <p class="mcp-storage-path">{{storage.status?.root}}</p>
    <p>先在此工作目录的 backups 中创建并核验数据库备份，再升级。升级后，旧版本应用将无法打开此工作目录。</p>
    <p class="muted">不会自动降级或还原。失败时保留当前文件；遗留文件不一定是有效备份。若需恢复，请先关闭应用、核实已确认备份后另行安排，不要直接覆盖当前库。</p>
    <SkCheckbox v-model="consent" :disabled="storage.busy">我已核对工作目录，并理解旧版本不能继续打开。</SkCheckbox>
    <p v-if="storage.busy" role="status">正在备份并开启，请勿退出应用…</p>
   </div>
   <footer class="dialog-footer"><SkButton :disabled="storage.busy" @click="close">取消</SkButton><SkButton kind="commit" :loading="storage.busy" :disabled="!consent||token!==storage.status?.confirmationToken" @click="confirm">备份并开启</SkButton></footer>
  </dialog>
 </section>
</template>
<style scoped>.mcp-storage-path{overflow-wrap:anywhere}</style>
