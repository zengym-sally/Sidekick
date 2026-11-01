<script setup lang="ts">
import { computed,ref } from 'vue';
import SkButton from './ui/SkButton.vue';
import SkSelect from './ui/SkSelect.vue';
import SkField from './ui/SkField.vue';
import { useOrganizer } from '../stores/organizer';
import { useTodos,errorMessage } from '../stores/todos';
import { signChoice } from '../domain/candidate';
import { displayInZone,currentZone } from '../domain/todos';
import { runError, mcpCloseWarning } from '../domain/organizer';
import CandidateCard from './CandidateCard.vue';
import Icon from './Icon.vue';
const organizer=useOrganizer(),todos=useTodos(),error=ref('');const emit=defineEmits<{capture:[];signed:[];models:[]}>();
const pending=computed(()=>organizer.batch?.candidates.filter(c=>c.status==='pending')||[]);
const selected=computed(()=>pending.value.filter(c=>organizer.drafts[c.id]?.selected));
let signature='',operation='';
function selectAll(){const checked=selected.value.length!==pending.value.length;for(const c of pending.value)organizer.drafts[c.id].selected=checked;}
async function sign(){error.value='';try{
  const choices=selected.value.map(c=>signChoice(c,organizer.drafts[c.id]));const next=JSON.stringify(choices);if(next!==signature){signature=next;operation=crypto.randomUUID();}
  const result=await organizer.sign(choices,operation);todos.applyCommitted(result);try{await todos.refresh();}catch{}emit('signed');
}catch(e){error.value=e instanceof Error?e.message:errorMessage(e);}}
</script>
<template><section class="inbox-page"><div class="inbox-scroll"><div class="page-intro"><h1>先过一眼，再交给班班盯。</h1><p>原文与时间都能核对；你签收之前，候选不会成为正式事项。</p></div>
  <div class="inbox-tools"><SkField label="来源批次"><SkSelect :model-value="organizer.selected" :options="organizer.batches.map(batch=>({value:batch.id,label:batch.excerpt.slice(0,28)+' · 待确认 '+batch.pending+' 条'}))" searchable placeholder="还没有整理记录" @update:model-value="organizer.select($event).catch(()=>{})"/></SkField><SkButton kind="entry" @click="emit('capture')"><Icon name="plus"/>整理新文本</SkButton></div>
  <p v-if="organizer.error||error" class="form-error" role="alert">{{ error||organizer.error }} <button class="text-button" @click="organizer.refresh">重新读取</button></p>
  <div v-if="organizer.running" class="task-progress" role="status"><Icon name="refresh"/><div><strong>{{ organizer.run?.kind==='revise'?'班班在准备修改预览…':organizer.run?.kind==='test'?'正在测试模型…':'班班在整理原文…' }}</strong><p>原文已保留，完成后候选会出现在这里。</p></div><button class="text-button" @click="organizer.cancel().catch(()=>{})">取消任务</button></div>
  <template v-if="organizer.batch"><p v-if="organizer.batch.run?.status==='succeeded'&&mcpCloseWarning(organizer.batch.run)" class="muted" role="status">{{mcpCloseWarning(organizer.batch.run)}}</p><div v-if="organizer.batch.run&&['failed','cancelled','interrupted'].includes(organizer.batch.run.status)" class="profile-alert" role="alert"><p>{{ runError(organizer.batch.run) }}</p><SkButton kind="entry" :disabled="organizer.running||organizer.starting" @click="organizer.retry().catch(()=>{})">{{ organizer.batch.run.errorCode==='MCP_RESULT_UNKNOWN'?'核对外部结果后重新整理':'重试整理' }}</SkButton><button class="text-button" @click="emit('models')">检查模型设置</button></div>
    <div class="review-grid"><div><CandidateCard v-for="candidate in organizer.batch.candidates" :key="candidate.id" :candidate="candidate" :todos="todos.rows"/><div v-if="!organizer.batch.candidates.length&&!organizer.running" class="empty-state"><h2>{{ organizer.batch.run?.status==='succeeded'?'这段原文没有发现事项。':'原文已经保留。' }}</h2><p>可以重新核对内容，或继续手工录入。</p></div></div>
      <aside class="source-evidence" aria-label="原文依据"><h2>原文依据</h2><p class="muted">{{ organizer.batch.source.sourceAtMs?'来源时间':'首次录入锚点' }}：{{ displayInZone(organizer.batch.source.anchorAtMs,currentZone()) }}</p><pre>{{ organizer.batch.source.rawText }}</pre></aside></div>
  </template><div v-else-if="!organizer.loading" class="empty-state"><h2>把一段原文交给班班。</h2><p>先配置模型，再贴入纪要、邮件或工作记录。</p><SkButton kind="entry" @click="emit('capture')">整理第一段文本</SkButton></div>
  </div><footer class="review-bar"><button class="text-button" :disabled="!pending.length||organizer.saving" @click="selectAll">{{ selected.length===pending.length&&pending.length?'取消全选':'全选' }}</button><span>已选 {{ selected.length }} / {{ pending.length }} 条</span><SkButton kind="commit" :loading="organizer.saving" :disabled="!selected.length||organizer.saving||organizer.reconcileRequired" @click="sign"><Icon name="check"/>签收选中事项</SkButton></footer></section></template>
