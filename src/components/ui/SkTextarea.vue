<script setup lang="ts">
import {useAttrs} from 'vue';import {useControl,useDisabled} from './control';
defineOptions({inheritAttrs:false});const props=withDefaults(defineProps<{modelValue?:string;disabled?:boolean}>(),{modelValue:''});const emit=defineEmits<{'update:modelValue':[value:string]}>(),attrs=useAttrs(),disabled=useDisabled(props),{root}=useControl(attrs,'textarea');
</script>
<template><div ref="root" class="sk-control sk-textarea" :class="attrs.class"><textarea v-bind="{...attrs,class:undefined}" :value="modelValue" :disabled="disabled" @input="emit('update:modelValue',($event.target as HTMLTextAreaElement).value)"/></div></template>
