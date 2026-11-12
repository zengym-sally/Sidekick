<script setup lang="ts">
import {onMounted,onUnmounted} from 'vue';
import {storeToRefs} from 'pinia';
import {usePairing} from '../stores/pairing';
import {useTodos} from '../stores/todos';
import {useOrganizer} from '../stores/organizer';
import SkButton from './ui/SkButton.vue';
import SkInput from './ui/SkInput.vue';
import Icon from './Icon.vue';
import mark from '../assets/brand/sidekick-mark.svg';

const pairing=usePairing(),todos=useTodos(),organizer=useOrganizer();
const {ready,paired,busy,code,error}=storeToRefs(pairing);
// Event-name routing (web-api/1 §6 + intake §6.3): item hints refresh manual
// items; task/candidate/settings hints and every (re)connect handshake
// (stream.ready) refresh the organizer's authoritative sources/candidates/
// tasks — a ready frame is never a todos-only refresh. stream.reset arrives
// AFTER the pairing store consumed the snapshot into the organizer baseline,
// so the refresh here covers the sources/candidates the task snapshot does
// not carry. Handlers get the event name only, never frame payloads.
// The handler RETURNS the raw read-back promises: the pairing store gates the
// reconnect-token commit on their completion (a frame counts as applied only
// once its authoritative read-back succeeded — §6 "最后应用的 (epoch,cursor)");
// failures propagate to that gate instead of being swallowed here.
pairing.setOnItemChanged((event)=>{
  const reads:Promise<unknown>[]=[];
  if(event==='item.changed'||event==='stream.ready'||event==='stream.reset'){reads.push(todos.refresh());}
  if(event==='candidate.changed'||event==='task.changed'||event==='settings.changed'||event==='stream.ready'||event==='stream.reset'){reads.push(organizer.refresh());}
  return Promise.all(reads);
});
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
