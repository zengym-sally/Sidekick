<script setup lang="ts">
import { computed,ref,watch } from 'vue';
import { Button as TButton } from 'tdesign-vue-next';
import { runError,type Candidate } from '../domain/organizer';
import { candidateFields,editorSignature } from '../domain/candidate';
import type { Todo } from '../domain/todos';
import { displayPoint } from '../domain/todos';
import { useOrganizer } from '../stores/organizer';
import { errorMessage } from '../stores/todos';
import TimeField from './TimeField.vue';
import Icon from './Icon.vue';
const props=defineProps<{candidate:Candidate;todos:Todo[]}>();const organizer=useOrganizer(),error=ref('');
organizer.sync(props.candidate);const state=computed(()=>organizer.drafts[props.candidate.id]);
watch(()=>props.candidate.version,()=>organizer.sync(props.candidate));
const dirty=computed(()=>editorSignature(state.value)!==state.value.baseline);
const previews=computed(()=>organizer.batch?.previews.filter(r=>r.candidateId===props.candidate.id)||[]);
const related=computed(()=>props.todos.filter(t=>t.status!=='deleted'&&t.data.title.trim()===state.value.title.trim()));
let lastSignature='',operationId='';
function operation(value:unknown){const signature=JSON.stringify(value);if(signature!==lastSignature){lastSignature=signature;operationId=crypto.randomUUID();}return operationId;}
async function save(){error.value='';try{const fields=candidateFields(state.value);await organizer.saveCandidate(props.candidate,fields,state.value.timeReviewed,operation(['save',props.candidate.version,fields,state.value.timeReviewed]));}catch(e){error.value=e instanceof Error?e.message:errorMessage(e);}}
async function discard(){error.value='';try{await organizer.discard(props.candidate,operation(['discard',props.candidate.version]));}catch(e){error.value=errorMessage(e);}}
async function revise(){error.value='';try{await organizer.revise(props.candidate,state.value.instruction);}catch(e){error.value=errorMessage(e);}}
async function apply(id:string){error.value='';const preview=previews.value.find(r=>r.id===id);if(!preview)return;try{await organizer.apply(preview,operation(['apply',id,preview.candidateVersion]));}catch(e){error.value=errorMessage(e);}}
function target(){state.value.targetVersion=props.todos.find(t=>t.id===state.value.targetId)?.version||0;}
</script>
<template><article class="candidate-card" :aria-label="`候选：${candidate.draft.fields.title}`"><header class="candidate-heading"><label class="candidate-select"><input v-model="state.selected" type="checkbox" :disabled="candidate.status!=='pending'||organizer.saving"><strong>{{ candidate.draft.fields.title }}</strong></label><span class="pill">{{ candidate.status==='pending'?'未签收':candidate.status==='accepted'?'已签收':'已丢弃' }}</span></header>
  <template v-if="candidate.status==='pending'"><p v-if="state.stale" class="profile-alert" role="alert">这条候选已有更新，未保存输入仍保留。<button class="text-button" @click="organizer.sync(candidate,true)">重新载入候选</button></p>
  <fieldset class="candidate-fields" :disabled="organizer.saving||organizer.reconcileRequired||state.stale"><div class="form-grid"><label class="field full">事项标题<input v-model="state.title" required maxlength="200"></label><label class="field">事项类型<select v-model="state.kind"><option value="action">待我处理</option><option value="followup">待我跟进</option></select></label><label class="field">实际负责人<input v-model="state.owner" required maxlength="100"></label><TimeField :state="state.due" label="交付截止"/><TimeField v-if="state.kind==='followup'" :state="state.followup" label="下次跟进"/><label class="field">优先级<select v-model="state.priority"><option value="low">低</option><option value="medium">中</option><option value="high">高</option></select></label><label class="field">标签<input v-model="state.tags" placeholder="用逗号分隔"></label></div>
  <label class="field candidate-link">签收方式<select v-model="state.targetId" @change="target"><option value="">新建事项</option><option v-for="todo in todos.filter(t=>t.status!=='deleted')" :key="todo.id" :value="todo.id">关联：{{ todo.data.title }}{{ todo.status==='completed'?'（已完成）':'' }}</option></select></label><p class="muted">{{ state.targetId?'只增加原文来源，不覆盖目标事项的状态、负责人和时间。':'签收后才新增正式事项。' }}{{ related.length?'发现同标题事项，可在上方人工选择关联。':'' }}</p>
  <label v-if="candidate.draft.unresolved" class="review-time"><input v-model="state.timeReviewed" type="checkbox">我已核对时间，未设置的部分保留为未定期</label>
  <div class="candidate-actions"><TButton class="button ghost" @click="save">保存候选修改</TButton><button class="text-button danger" @click="discard">丢弃这条</button></div>
  </fieldset></template>
  <blockquote>{{ candidate.draft.evidence }}</blockquote><div class="candidate-time-evidence"><span v-if="candidate.draft.dueExpression">截止原文：{{ candidate.draft.dueExpression }}</span><span v-if="candidate.draft.followupExpression">跟进原文：{{ candidate.draft.followupExpression }}</span></div><ul v-if="candidate.draft.warnings.length" class="date-warnings"><li v-for="warning in candidate.draft.warnings" :key="warning">{{ warning }}</li></ul>
  <details v-if="candidate.status==='pending'" class="candidate-revision"><summary>告诉班班怎么改</summary><label class="field">修改要求<textarea v-model="state.instruction" rows="2" maxlength="2000" placeholder="例如：把标题改得更具体，截止改为下周五。"/></label><TButton class="button entry" :disabled="organizer.running||organizer.starting||organizer.saving||dirty||!state.instruction.trim()" @click="revise">生成修改预览</TButton><p class="muted">先保存当前候选修改；预览基于已保存版本，按本次指令时间理解相对日期，不直接签收。</p></details>
  <section v-for="preview in previews.slice(0,1)" :key="preview.id" class="revision-preview" aria-label="修改预览"><h3>班班的修改预览</h3><p v-if="dirty" class="muted">当前有未保存修改，先保存或重新载入候选，预览不会覆盖输入。</p><template v-if="preview.preview"><dl><dt>标题</dt><dd><span class="preview-before">原：{{ candidate.draft.fields.title }}</span>拟改：{{ preview.preview.fields.title }}</dd><dt>负责人</dt><dd><span class="preview-before">原：{{ candidate.draft.fields.owner }}</span>拟改：{{ preview.preview.fields.owner }}</dd><dt>截止</dt><dd><span class="preview-before">原：{{ candidate.draft.fields.due?displayPoint(candidate.draft.fields.due):'未定期' }}</span>拟改：{{ preview.preview.fields.due?displayPoint(preview.preview.fields.due):'未定期' }}</dd><dt v-if="preview.preview.fields.kind==='followup'">下次跟进</dt><dd v-if="preview.preview.fields.kind==='followup'"><span class="preview-before">原：{{ candidate.draft.fields.followup?displayPoint(candidate.draft.fields.followup):'未设置' }}</span>拟改：{{ preview.preview.fields.followup?displayPoint(preview.preview.fields.followup):'未设置' }}</dd></dl><TButton v-if="candidate.status==='pending'&&candidate.version===preview.candidateVersion" class="button entry" :disabled="organizer.saving||dirty" @click="apply(preview.id)">应用到候选</TButton><p v-else class="muted">候选已更新或处理，此预览不能再应用。</p></template><p v-else-if="preview.status==='running'" class="muted" role="status">正在准备修改预览…</p><p v-else class="form-error" role="alert">{{ runError(preview) }}</p></section>
  <p v-if="error" class="form-error" role="alert">{{ error }}</p>
</article></template>
