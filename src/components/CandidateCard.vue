<script setup lang="ts">
import { computed,ref,watch } from 'vue';
import SkButton from './ui/SkButton.vue';
import SkInput from './ui/SkInput.vue';
import SkTextarea from './ui/SkTextarea.vue';
import SkSelect from './ui/SkSelect.vue';
import SkField from './ui/SkField.vue';
import SkFieldset from './ui/SkFieldset.vue';
import SkCheckbox from './ui/SkCheckbox.vue';
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
<template><article class="candidate-card" :aria-label="`候选：${candidate.draft.fields.title}`"><header class="candidate-heading"><SkCheckbox v-if="candidate.status==='pending'" v-model="state.selected" class="candidate-select" :disabled="organizer.saving"><strong>{{candidate.draft.fields.title}}</strong></SkCheckbox><strong v-else>{{candidate.draft.fields.title}}</strong><span class="pill">{{ candidate.status==='pending'?'未签收':candidate.status==='accepted'?'已签收':'已丢弃' }}</span></header>
  <template v-if="candidate.status==='pending'"><p v-if="state.stale" class="profile-alert" role="alert">这条候选已有更新，未保存输入仍保留。<button class="text-button" @click="organizer.sync(candidate,true)">重新载入候选</button></p>
  <SkFieldset class="candidate-fields" :disabled="organizer.saving||organizer.reconcileRequired||state.stale"><div class="form-grid"><SkField class="full" label="事项标题" required><SkInput v-model="state.title" required maxlength="200"/></SkField><SkField label="事项类型"><SkSelect v-model="state.kind" :options="[{value:'action',label:'待我处理'},{value:'followup',label:'待我跟进'}]"/></SkField><SkField label="实际负责人" required><SkInput v-model="state.owner" required maxlength="100"/></SkField><TimeField :state="state.due" label="交付截止"/><TimeField v-if="state.kind==='followup'" :state="state.followup" label="下次跟进"/><SkField label="优先级"><SkSelect v-model="state.priority" :options="[{value:'low',label:'低'},{value:'medium',label:'中'},{value:'high',label:'高'}]"/></SkField><SkField label="标签"><SkInput v-model="state.tags" placeholder="用逗号分隔"/></SkField></div>
  <SkField class="candidate-link" label="签收方式"><SkSelect v-model="state.targetId" placeholder="新建事项" :options="[{value:'',label:'新建事项'},...todos.filter(t=>t.status!=='deleted').map(todo=>({value:todo.id,label:'关联：'+todo.data.title+(todo.status==='completed'?'（已完成）':'')}))]" searchable @change="target"/></SkField><p class="muted">{{ state.targetId?'只增加原文来源，不覆盖目标事项的状态、负责人和时间。':'签收后才新增正式事项。' }}{{ related.length?'发现同标题事项，可在上方人工选择关联。':'' }}</p>
  <SkCheckbox v-if="candidate.draft.unresolved" v-model="state.timeReviewed" class="review-time">我已核对时间，未设置的部分保留为未定期</SkCheckbox>
  <div class="candidate-actions"><SkButton kind="secondary" @click="save">保存候选修改</SkButton><button class="text-button danger" @click="discard">丢弃这条</button></div>
  </SkFieldset></template>
  <blockquote>{{ candidate.draft.evidence }}</blockquote><div class="candidate-time-evidence"><span v-if="candidate.draft.dueExpression">截止原文：{{ candidate.draft.dueExpression }}</span><span v-if="candidate.draft.followupExpression">跟进原文：{{ candidate.draft.followupExpression }}</span></div><ul v-if="candidate.draft.warnings.length" class="date-warnings"><li v-for="warning in candidate.draft.warnings" :key="warning">{{ warning }}</li></ul>
  <details v-if="candidate.status==='pending'" class="candidate-revision"><summary>告诉班班怎么改</summary><SkField label="修改要求"><SkTextarea v-model="state.instruction" rows="2" maxlength="2000" placeholder="例如：把标题改得更具体，截止改为下周五。"/></SkField><SkButton kind="entry" :disabled="organizer.running||organizer.starting||organizer.saving||dirty||!state.instruction.trim()" @click="revise">生成修改预览</SkButton><p class="muted">先保存当前候选修改；预览基于已保存版本，按本次指令时间理解相对日期，不直接签收。</p></details>
  <section v-for="preview in previews.slice(0,1)" :key="preview.id" class="revision-preview" aria-label="修改预览"><h3>班班的修改预览</h3><p v-if="dirty" class="muted">当前有未保存修改，先保存或重新载入候选，预览不会覆盖输入。</p><template v-if="preview.preview"><dl><dt>标题</dt><dd><span class="preview-before">原：{{ candidate.draft.fields.title }}</span>拟改：{{ preview.preview.fields.title }}</dd><dt>负责人</dt><dd><span class="preview-before">原：{{ candidate.draft.fields.owner }}</span>拟改：{{ preview.preview.fields.owner }}</dd><dt>截止</dt><dd><span class="preview-before">原：{{ candidate.draft.fields.due?displayPoint(candidate.draft.fields.due):'未定期' }}</span>拟改：{{ preview.preview.fields.due?displayPoint(preview.preview.fields.due):'未定期' }}</dd><dt v-if="preview.preview.fields.kind==='followup'">下次跟进</dt><dd v-if="preview.preview.fields.kind==='followup'"><span class="preview-before">原：{{ candidate.draft.fields.followup?displayPoint(candidate.draft.fields.followup):'未设置' }}</span>拟改：{{ preview.preview.fields.followup?displayPoint(preview.preview.fields.followup):'未设置' }}</dd></dl><SkButton v-if="candidate.status==='pending'&&candidate.version===preview.candidateVersion" kind="entry" :disabled="organizer.saving||dirty" @click="apply(preview.id)">应用到候选</SkButton><p v-else class="muted">候选已更新或处理，此预览不能再应用。</p></template><p v-else-if="preview.status==='running'" class="muted" role="status">正在准备修改预览…</p><p v-else class="form-error" role="alert">{{ runError(preview) }}</p></section>
  <p v-if="error" class="form-error" role="alert">{{ error }}</p>
</article></template>
