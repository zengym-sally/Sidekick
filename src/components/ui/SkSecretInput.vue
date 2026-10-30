<script setup lang="ts">
import {ref} from 'vue';import SkInput from './SkInput.vue';import Icon from '../Icon.vue';
defineProps<{modelValue:string;disabled?:boolean}>();const emit=defineEmits<{'update:modelValue':[value:string]}>(),visible=ref(false);
</script>
<template><SkInput :model-value="modelValue" :disabled="disabled" :type="visible?'text':'password'" autocomplete="new-password" @update:model-value="emit('update:modelValue',$event)"><template #suffix><button type="button" class="icon-button sk-secret-toggle" :aria-label="visible?'隐藏待保存的Key':'显示待保存的Key'" :disabled="disabled" @click="visible=!visible"><Icon name="eye"/></button></template></SkInput></template>
