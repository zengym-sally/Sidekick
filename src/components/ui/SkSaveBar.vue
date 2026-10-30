<script setup lang="ts">
import SkButton from './SkButton.vue';import Icon from '../Icon.vue';
withDefaults(defineProps<{dirty:boolean;busy?:boolean;disabled?:boolean;error?:string;notice?:string;label?:string;target?:string}>(),{label:'保存更改'});const emit=defineEmits<{save:[];discard:[]}>();
</script>
<template><Teleport defer :to="target||'body'" :disabled="!target"><footer class="settings-savebar"><span class="settings-save-status" :class="{danger:!!error}" role="status"><Icon :name="error?'info':dirty?'edit':'check'"/>{{error||(dirty?'有未保存的修改':notice||'没有未保存的修改')}}</span><div class="footer-actions"><SkButton kind="quiet" :disabled="!dirty||busy" @click="emit('discard')">放弃修改</SkButton><SkButton kind="commit" :disabled="!dirty||disabled" :loading="busy" @click="emit('save')">{{label}}</SkButton></div></footer></Teleport></template>
