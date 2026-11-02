import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
const api=fileURLToPath(new URL('./api.ts',import.meta.url));
export default defineConfig({
  envDir:false,
  plugins:[vue(),tailwindcss(),{name:'fixture-title',transformIndexHtml:html=>html.replace('<title>跟班 Sidekick</title>','<title>Sidekick 界面验收 · 合成资料</title>')}],
  resolve:{alias:[{find:/^@tauri-apps\/api\/(core|event|app)$/,replacement:api},{find:'@tauri-apps/plugin-dialog',replacement:api}]},
  optimizeDeps:{exclude:['@tauri-apps/api/core','@tauri-apps/api/event','@tauri-apps/api/app','@tauri-apps/plugin-dialog']},
  server:{host:'127.0.0.1',port:1475,strictPort:true},
});
