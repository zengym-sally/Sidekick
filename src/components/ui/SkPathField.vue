<script setup lang="ts">
import SkInput from './SkInput.vue';import Icon from '../Icon.vue';
defineProps<{path:string}>();const emit=defineEmits<{open:[]}>();
</script>
<template><SkInput :model-value="path" readonly :title="path"><template #suffix><span class="sk-path-actions"><span title="选择新目录将在 S5 目录迁移阶段开放"><button class="icon-button" type="button" disabled aria-label="选择新目录，尚未开放"><Icon name="folderPick"/></button></span><button class="icon-button" type="button" title="打开目录" aria-label="打开目录" @click="emit('open')"><Icon name="folderOpen"/></button></span></template></SkInput></template>
