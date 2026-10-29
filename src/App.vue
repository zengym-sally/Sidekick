<script setup lang="ts">
import Workbench from './components/Workbench.vue';
import ProbePanel from './components/ProbePanel.vue';
const query=new URLSearchParams(location.search);
const diagnostic=query.has('pet')||query.has('quick')||query.has('probe');
</script>
<template><ProbePanel v-if="diagnostic"/><Workbench v-else/></template>
