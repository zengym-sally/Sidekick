<script setup lang="ts">
import {onMounted,onUnmounted} from 'vue';
import {storeToRefs} from 'pinia';
import {usePairing} from '../stores/pairing';
import {useTodos} from '../stores/todos';
import SkButton from './ui/SkButton.vue';
import SkInput from './ui/SkInput.vue';
import Icon from './Icon.vue';
import mark from '../assets/brand/sidekick-mark.svg';

const pairing=usePairing(),todos=useTodos();
const {ready,paired,busy,code,error}=storeToRefs(pairing);
pairing.setOnItemChanged(()=>{void todos.refresh().catch(()=>{});});
onMounted(()=>{void pairing.start();});
onUnmounted(()=>pairing.dispose());
</script>
<template>
  <main v-if="!ready" class="startup"><img :src="mark" alt="跟班"><h1>正在连接本机后端…</h1><p>已保存的事项会从本机读回。</p></main>
  <main v-else-if="!paired" class="startup pairing-gate">
    <img :src="mark" alt="跟班"><h1>输入配对码</h1>
    <p>在本机后端启动终端复制一次性配对码。配对码只使用一次，请尽快输入。</p>
    <form class="pairing-form" @submit.prevent="pairing.pair()">
      <SkInput v-model="code" aria-label="配对码" placeholder="配对码" autofocus/>
      <SkButton kind="entry" type="submit" :loading="busy" :disabled="busy"><Icon name="arrow"/>进入工作台</SkButton>
    </form>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
  </main>
  <slot v-else/>
</template>
