<script setup lang="ts">
import {h} from 'vue';
import Icon from './components/Icon.vue';
import {ConfigProvider} from 'tdesign-vue-next';
import zhCN from 'tdesign-vue-next/es/locale/zh_CN';
import Workbench from './components/Workbench.vue';
import ProbePanel from './components/ProbePanel.vue';
import QuickEntry from './components/QuickEntry.vue';
import PetWindow from './components/PetWindow.vue';
import {desktopSurface} from './domain/desktop';
const locale=JSON.parse(JSON.stringify(zhCN));
locale.icon={AddIcon:()=>h(Icon,{name:'plus'}),RemoveIcon:()=>h(Icon,{name:'minus'})};
const surface=desktopSurface(location.search);
</script>
<template><ConfigProvider :global-config="locale"><ProbePanel v-if="surface==='probe'"/><QuickEntry v-else-if="surface==='quick'"/><PetWindow v-else-if="surface==='pet'"/><Workbench v-else/></ConfigProvider></template>
