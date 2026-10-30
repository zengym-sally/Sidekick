<script setup lang="ts">
import {Button as TButton} from 'tdesign-vue-next';import {useDisabled} from './control';
const props=withDefaults(defineProps<{kind?:'entry'|'commit'|'secondary'|'quiet'|'danger';disabled?:boolean;loading?:boolean;type?:'button'|'submit'|'reset'}>(),{kind:'secondary',type:'button'});const disabled=useDisabled(props);
</script>
<template><TButton class="button sk-button" :class="{entry:kind==='entry',primary:kind==='commit',ghost:kind==='secondary',quiet:kind==='quiet',destructive:kind==='danger'}" :type="type" :disabled="disabled||loading" :loading="loading"><slot/></TButton></template>
