<script setup lang="ts">
import { computed } from 'vue';
import { localCandidates,offsetLabel } from '../domain/todos';
import type { TimeDraft } from '../domain/time';
const props=defineProps<{state:TimeDraft;label:string}>();
const candidates=computed(()=>props.state.enabled&&!props.state.dayOnly?localCandidates(props.state.raw):[]);
function precision(){props.state.raw=props.state.dayOnly?props.state.raw.split('T')[0]:'';props.state.choice=null;}
</script>
<template><div class="field time-field"><label class="time-toggle"><input v-model="state.enabled" type="checkbox">设置{{ label }}</label><template v-if="state.enabled"><label class="day-toggle"><input v-model="state.dayOnly" type="checkbox" @change="precision">仅日期，不指定时刻</label><input v-model="state.raw" :type="state.dayOnly?'date':'datetime-local'" :aria-label="label" required><select v-if="candidates.length>1" v-model="state.choice" :aria-label="`${label}的UTC偏移`" required><option :value="null">请选择明确偏移</option><option v-for="at in candidates" :key="at" :value="at">{{ offsetLabel(at) }}</option></select></template><span v-else class="muted optional-time">暂不设置</span></div></template>
