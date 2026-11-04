<script setup lang="ts">
import {onMounted,onUnmounted,reactive} from 'vue';
import {createDesktopWindows} from '../stores/desktop';
import SkButton from './ui/SkButton.vue';
import pet from '../assets/brand/banban-idle.svg';
const desktop=reactive(createDesktopWindows());
onMounted(()=>{document.documentElement.dataset.desktopWindow='pet';});
onUnmounted(()=>{desktop.dispose();delete document.documentElement.dataset.desktopWindow;});
</script>
<template><main class="desktop-pet"><div class="pet-drag" data-tauri-drag-region><img :src="pet" alt="班班，可拖动" draggable="false" data-tauri-drag-region/></div><nav aria-label="班班快捷操作"><SkButton kind="quiet" @click="desktop.act('open_main')">工作台</SkButton><SkButton kind="entry" @click="desktop.act('open_quick')">快速录入</SkButton><SkButton kind="quiet" @click="desktop.act('hide_pet')">隐藏</SkButton></nav><p v-if="desktop.error" class="danger" role="alert">{{desktop.error}}</p></main></template>
<style>
html[data-desktop-window="pet"],html[data-desktop-window="pet"] body{background:transparent}
</style>
<style scoped>
.desktop-pet{padding:8px;text-align:center}.pet-drag{display:flex;justify-content:center;cursor:grab}.pet-drag img{width:112px;height:112px;user-select:none}nav{display:flex;justify-content:center;gap:4px;padding:4px;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius)}nav .button{padding:6px 8px;min-height:30px}.desktop-pet p{padding:8px;margin:8px 0 0;background:var(--surface);font-size:12px}
</style>
