<script setup lang="ts">
defineProps<{name:string}>();
const paths:Record<string,string>={today:'M5 5h14v16H5z M8 3v4m8-4v4M5 10h14M9 14h6',list:'M9 6h12M9 12h12M9 18h12M3 6h.1M3 12h.1M3 18h.1',settings:'M4 6h16M4 18h16M4 12h16M8 3v6m8 0v6m-6 0v6',plus:'M12 5v14M5 12h14',check:'m5 12 4 4L19 6',close:'m6 6 12 12M18 6 6 18',search:'M16 16l5 5M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0',clock:'M12 7v6l4 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',folder:'M3 6h7l2 3h9v11H3z',arrow:'M4 12h16m-6-6 6 6-6 6',edit:'m4 17 13-13 4 4L8 21H4z',trash:'M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6m4-6v6',user:'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0M4 21v-2a8 8 0 0 1 16 0v2',refresh:'M20 7v5h-5M4 17v-5h5M5 7a8 8 0 0 1 13-2l2 3M4 16l2 3a8 8 0 0 0 13-2'};
</script>
<template><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="paths[name]||paths.list"/></svg></template>
