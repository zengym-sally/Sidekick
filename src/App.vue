<script setup lang="ts">
import {h} from 'vue';
import Icon from './components/Icon.vue';
import {ConfigProvider} from 'tdesign-vue-next';
import zhCN from 'tdesign-vue-next/es/locale/zh_CN';
import Workbench from './components/Workbench.vue';
import ProbePanel from './components/ProbePanel.vue';
const locale=JSON.parse(JSON.stringify(zhCN));
locale.icon={AddIcon:()=>h(Icon,{name:'plus'}),RemoveIcon:()=>h(Icon,{name:'minus'})};
const query=new URLSearchParams(location.search);
const diagnostic=query.has('pet')||query.has('quick')||query.has('probe');
</script>
<template><ConfigProvider :global-config="locale"><ProbePanel v-if="diagnostic"/><Workbench v-else/></ConfigProvider></template>
