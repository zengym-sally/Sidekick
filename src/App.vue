<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { motion } from 'motion-v';
import { Button as TButton } from 'tdesign-vue-next';
import pet from '../design/brand/banban-idle.svg';

const report = ref<Record<string, unknown> | null>(null);
const error = ref('');
const busy = ref(false);
const isPet = new URLSearchParams(location.search).has('pet');
const isQuick = new URLSearchParams(location.search).has('quick');

async function run() {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try { report.value = await invoke('run_s0_probes'); }
  catch (reason) { error.value = `本地探针失败：${String(reason)}`; }
  finally { busy.value = false; }
}

onMounted(() => { if (!isPet && !isQuick) void run(); });
</script>

<template>
  <div v-if="isPet" class="pet" data-tauri-drag-region><img :src="pet" alt="班班" data-tauri-drag-region></div>
  <main v-else-if="isQuick" class="quick"><h1>快捷入口探针</h1><p>此窗口只验证原生创建与显隐；正式录入在 S1/S2 交付。</p></main>
  <main v-else>
    <header><img :src="pet" alt="班班"><div><p class="eyebrow">sidekick · S0</p><h1>先把关键通路跑通。</h1></div></header>
    <p>这是技术诊断安装包。只使用临时数据库与合成样本，不生成正式事项。</p>
    <TButton :loading="busy" :disabled="busy" theme="primary" @click="run">{{ busy ? '正在验证' : '重新运行本地探针' }}</TButton>
    <p v-if="error" role="alert">{{ error }}</p>
    <motion.div v-if="report" :initial="{ opacity: 0 }" :animate="{ opacity: 1 }"><pre aria-label="本地探针结果">{{ JSON.stringify(report, null, 2) }}</pre></motion.div>
    <p class="note">真实飞书、权限拒绝、拔屏与全屏交互另行取证；本页通过不代表完整 S0 或产品功能已完成。</p>
  </main>
</template>
