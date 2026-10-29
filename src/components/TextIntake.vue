<script setup lang="ts">
import { computed,ref } from 'vue';
import { Button as TButton } from 'tdesign-vue-next';
import { zonedCandidates } from '../../runtime/dates.mjs';
import { offsetLabel } from '../domain/todos';
import { useOrganizer } from '../stores/organizer';
import Icon from './Icon.vue';
const organizer=useOrganizer(),localError=ref('');const emit=defineEmits<{submitted:[sourceId:string];models:[]}>();
const candidates=computed(()=>{try{return organizer.text.sourceTime?zonedCandidates(organizer.text.sourceTime,organizer.text.timeZone):[];}catch{return [];}});
async function submit(){localError.value='';try{
  let at:number|null=null;if(organizer.text.sourceTime){if(!candidates.value.length)throw new Error('来源时刻或时区无效，请检查。');at=candidates.value.length===1?candidates.value[0]:organizer.text.sourceChoice;if(at===null||!candidates.value.includes(at))throw new Error('来源时刻出现两次，请选择明确的UTC偏移。');}
  const run=await organizer.organize(at);if(run.sourceId)emit('submitted',run.sourceId);
}catch(e){localError.value=e instanceof Error?e.message:'';}}
</script>
<template><form class="text-intake" @submit.prevent="submit"><div class="dialog-body"><fieldset :disabled="organizer.starting"><label class="field">要整理的原文<textarea v-model="organizer.text.body" rows="9" maxlength="64000" placeholder="贴入纪要、邮件或一段工作记录。班班先整理成候选，你签收后才成为正式事项。" required/></label><div class="form-grid source-anchor"><label class="field">来源时间（可选）<input v-model="organizer.text.sourceTime" type="datetime-local"></label><label class="field">来源时区<input v-model="organizer.text.timeZone" required placeholder="Asia/Shanghai"></label></div><label v-if="candidates.length>1" class="field">来源时刻的UTC偏移<select v-model="organizer.text.sourceChoice" required><option :value="null">请选择明确偏移</option><option v-for="at in candidates" :key="at" :value="at">{{ offsetLabel(at) }}</option></select></label><p class="muted">不填来源时间时，按这段文本首次录入时的时间理解“今天／下周”；相同文本重试不会更换锚点。原文会直接交给你配置的模型。</p><p v-if="localError||organizer.error" class="form-error" role="alert">{{ localError||organizer.error }}</p><button class="text-button" type="button" :disabled="organizer.starting" @click="emit('models')">配置或检查默认模型<Icon name="arrow"/></button></fieldset></div><footer class="dialog-footer"><span class="muted">先整理成候选，签收前不入库。</span><TButton class="button primary" type="submit" :loading="organizer.starting" :disabled="organizer.running||organizer.starting"><Icon name="check"/>开始整理</TButton></footer></form></template>
