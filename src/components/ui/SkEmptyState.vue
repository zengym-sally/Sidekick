<script setup lang="ts">
defineProps<{title:string;description:string}>();
</script>
<template><div class="sk-empty-state"><h2>{{title}}</h2><p>{{description}}</p><div v-if="$slots.actions" class="sk-empty-state__actions"><slot name="actions"/></div></div></template>
<style scoped>
.sk-empty-state{padding:32px 12px;text-align:center;color:var(--ink)}.sk-empty-state h2{margin:0;font-size:18px;font-weight:600;line-height:1.5}.sk-empty-state p{max-width:44ch;margin:10px auto 0;font-size:12px;line-height:1.8;color:var(--muted)}.sk-empty-state__actions{display:flex;align-items:center;justify-content:center;gap:12px;flex-wrap:wrap;margin-top:20px}
</style>
