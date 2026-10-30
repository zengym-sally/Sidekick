<script setup lang="ts">
import {computed,provide,useId} from 'vue';
import {fieldKey} from './control';
const props=defineProps<{label:string;help?:string;error?:string;required?:boolean}>();
const id=`field-${useId()}`,description=computed(()=>props.error?`${id}-error`:props.help?`${id}-help`:undefined);
provide(fieldKey,{id,description,invalid:computed(()=>!!props.error),required:computed(()=>!!props.required)});
</script>
<template><div class="field sk-field"><div class="sk-label-row"><label :for="id">{{label}}<span v-if="required" class="sk-required" aria-hidden="true"> *</span></label><slot name="action"/></div><slot/><small v-if="error" :id="`${id}-error`" class="sk-error" role="alert">{{error}}</small><small v-else-if="help" :id="`${id}-help`" class="muted">{{help}}</small></div></template>
