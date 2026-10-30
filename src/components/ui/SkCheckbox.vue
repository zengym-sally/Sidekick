<script setup lang="ts">
import Icon from '../Icon.vue';import {useDisabled} from './control';
const props=defineProps<{modelValue:boolean;disabled?:boolean}>(),disabled=useDisabled(props),emit=defineEmits<{'update:modelValue':[value:boolean];change:[value:boolean]}>();
function change(event:Event){const value=(event.target as HTMLInputElement).checked;emit('update:modelValue',value);emit('change',value);}
</script>
<template><label class="sk-check" :class="{'is-checked':modelValue,'is-disabled':disabled}"><input class="sk-check-input" type="checkbox" :checked="modelValue" :disabled="disabled" @change="change"/><span class="sk-check-box" aria-hidden="true"><Icon v-if="modelValue" name="check"/></span><span class="sk-check-label"><slot/></span></label></template>
