<script setup lang="ts">
import {h,onMounted,onUnmounted} from 'vue';
import Icon from './components/Icon.vue';
import {ConfigProvider} from 'tdesign-vue-next';
import zhCN from 'tdesign-vue-next/es/locale/zh_CN';
import Workbench from './components/Workbench.vue';
import ProbePanel from './components/ProbePanel.vue';
import QuickEntry from './components/QuickEntry.vue';
import PetWindow from './components/PetWindow.vue';
import PairingGate from './components/PairingGate.vue';
import {desktopSurface} from './domain/desktop';
import {nativeBridgeAvailable} from './lib/host-capabilities.ts';
import {useDesktopPreferences} from './stores/desktopPreferences';
const locale=JSON.parse(JSON.stringify(zhCN));
locale.icon={AddIcon:()=>h(Icon,{name:'plus'}),RemoveIcon:()=>h(Icon,{name:'minus'})};
const surface=desktopSurface(location.search);
const preferences=surface==='probe'?null:useDesktopPreferences();
onMounted(()=>{if(nativeBridgeAvailable())void preferences?.start(document.documentElement);});
onUnmounted(()=>preferences?.dispose());
</script>
<template><ConfigProvider :global-config="locale"><ProbePanel v-if="surface==='probe'"/><QuickEntry v-else-if="surface==='quick'"/><PetWindow v-else-if="surface==='pet'"/><PairingGate v-else><Workbench/></PairingGate></ConfigProvider></template>
