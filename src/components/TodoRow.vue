<script setup lang="ts">
import type { Todo } from '../domain/todos';
import { displayPoint, effectivePoint, isOverdue } from '../domain/todos';
import Icon from './Icon.vue';
defineProps<{todo:Todo;busy:boolean;now:number}>();
defineEmits<{detail:[id:string];toggle:[todo:Todo]}>();
</script>
<template>
  <li class="task-row" :class="{completed:todo.status==='completed',deleted:todo.status==='deleted'}">
    <button class="complete-check" :class="{done:todo.status==='completed'}" :disabled="busy||todo.status==='deleted'" :aria-label="`${todo.status==='completed'?'重新打开':'标记完成'}：${todo.data.title}`" @click="$emit('toggle',todo)"><Icon v-if="todo.status==='completed'" name="check"/></button>
    <div class="task-copy"><button class="task-title" @click="$emit('detail',todo.id)">{{ todo.data.title }}</button><div class="task-meta">
      <span v-if="todo.data.kind==='followup'"><Icon name="user"/>{{ todo.data.owner }}执行</span><span v-else>待我处理</span>
      <span v-for="tag in todo.data.tags" :key="tag" class="task-tag">{{ tag }}</span><span v-if="todo.data.priority==='high'" class="priority">优先处理</span>
      <span v-if="todo.status==='completed'">已完成</span><span v-if="todo.status==='deleted'">已删除 · 保留历史</span>
      <span v-if="todo.data.followup">跟进 {{ displayPoint(todo.data.followup) }}</span><span v-if="todo.data.due">交付 {{ displayPoint(todo.data.due) }}</span><span v-if="!todo.data.due&&!todo.data.followup">未定期</span>
    </div></div>
    <span class="due" :class="{urgent:isOverdue(todo,now)}">{{ isOverdue(todo,now)?'已逾期':effectivePoint(todo)!==null?displayPoint(effectivePoint(todo)!):'未定期' }}</span>
  </li>
</template>
