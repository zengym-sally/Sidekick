<script setup lang="ts">
import {ref} from 'vue';
import SkillsSettingsPanel from './SkillsSettingsPanel.vue';
import McpSettingsPanel from './McpSettingsPanel.vue';
const section=ref<'skills'|'mcp'>('skills');
function keydown(event:KeyboardEvent){if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();section.value=event.key==='Home'?'skills':event.key==='End'?'mcp':section.value==='skills'?'mcp':'skills';document.getElementById(`tools-tab-${section.value}`)?.focus();}
</script>
<template>
 <div class="tools-sections" role="tablist" aria-label="工具分类" @keydown="keydown">
  <button v-for="item in [{id:'skills' as const,label:'Skills'},{id:'mcp' as const,label:'MCP 服务'}]" :id="`tools-tab-${item.id}`" :key="item.id" role="tab" :aria-selected="section===item.id" :aria-controls="`tools-panel-${item.id}`" :tabindex="section===item.id?0:-1" @click="section=item.id">{{item.label}}</button>
 </div>
 <section v-if="section==='skills'" id="tools-panel-skills" role="tabpanel" aria-labelledby="tools-tab-skills"><SkillsSettingsPanel/></section>
 <section v-else id="tools-panel-mcp" role="tabpanel" aria-labelledby="tools-tab-mcp"><McpSettingsPanel/></section>
</template>
