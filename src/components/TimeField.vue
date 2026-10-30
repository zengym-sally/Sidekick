<script setup lang="ts">
import {computed,watch} from 'vue';import {currentZone,localCandidates} from '../domain/todos';import {rezoneDraft,type TimeDraft} from '../domain/time';
import SkCheckbox from './ui/SkCheckbox.vue';import SkSelect from './ui/SkSelect.vue';import SkDateTimeField from './ui/SkDateTimeField.vue';import SkField from './ui/SkField.vue';
const props=defineProps<{state:TimeDraft;label:string}>();
const candidates=computed(()=>props.state.enabled&&!props.state.dayOnly?localCandidates(props.state.raw,props.state.zone):[]);
watch(()=>currentZone(),()=>rezoneDraft(props.state),{immediate:true});
function precision(){props.state.raw=props.state.dayOnly?props.state.raw.split('T')[0]:'';props.state.choice=null;props.state.needsReview=false;}
function update(value:string){props.state.raw=value;props.state.choice=null;props.state.needsReview=false;}
</script>
<template><div class="field time-field"><div class="time-field-options"><SkCheckbox v-model="state.enabled">设置{{label}}</SkCheckbox><SkCheckbox v-if="state.enabled" v-model="state.dayOnly" @change="precision">仅日期</SkCheckbox></div><SkField v-if="state.enabled" class="time-primary" :label="label" :error="state.needsReview?'请重新核对时间后再保存。':''"><SkDateTimeField :model-value="state.raw" :date-only="state.dayOnly" @update:model-value="update"/></SkField><SkField v-if="candidates.length>1" label="这个时刻出现两次"><SkSelect v-model="state.choice" :aria-label="`${label}出现两次，请选择`" :options="candidates.map((at,index)=>({value:at,label:index===0?'较早一次':'较晚一次'}))" placeholder="请选择具体一次"/></SkField><span v-if="!state.enabled" class="muted optional-time">暂不设置</span></div></template>
