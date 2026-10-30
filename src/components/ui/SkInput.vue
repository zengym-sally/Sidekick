<script setup lang="ts">
import {useAttrs} from 'vue';
import {useControl,useDisabled} from './control';
defineOptions({inheritAttrs:false});
const props=withDefaults(defineProps<{modelValue?:string;disabled?:boolean;type?:string}>(),{modelValue:'',type:'text'});
const emit=defineEmits<{'update:modelValue':[value:string]}>(),attrs=useAttrs(),disabled=useDisabled(props),{root}=useControl(attrs);
</script>
<template><div ref="root" class="sk-control sk-input" :class="attrs.class"><slot name="prefix"/><input v-bind="{...attrs,class:undefined}" :type="type" :value="modelValue" :disabled="disabled" @input="emit('update:modelValue',($event.target as HTMLInputElement).value)"><slot name="suffix"/></div></template>
