<script setup lang="ts">
import {provide} from 'vue';
import {disabledKey,useDisabled} from './control';
const props=defineProps<{disabled?:boolean}>();const disabled=useDisabled(props);provide(disabledKey,disabled);
</script>
<template><fieldset :disabled="disabled"><slot/></fieldset></template>
