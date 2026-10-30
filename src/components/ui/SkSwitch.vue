<script setup lang="ts">
import {Switch as TSwitch} from 'tdesign-vue-next';import {useDisabled} from './control';
const props=defineProps<{modelValue:boolean;disabled?:boolean;label:string}>(),disabled=useDisabled(props),emit=defineEmits<{'update:modelValue':[value:boolean]}>();
</script>
<template><TSwitch class="sk-switch" :value="modelValue" :disabled="disabled" :aria-label="label" role="switch" :aria-checked="modelValue" :aria-disabled="disabled" :tabindex="disabled?-1:0" @keydown.space.prevent="!disabled&&emit('update:modelValue',!modelValue)" @keydown.enter.prevent="!disabled&&emit('update:modelValue',!modelValue)" @change="emit('update:modelValue',!!$event)"/></template>
