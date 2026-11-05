<script setup lang="ts">
import {computed,nextTick,onMounted,onUnmounted,reactive,ref,watch} from 'vue';
import {createPetWindow} from '../stores/pet';
import {petArtwork,petMask} from '../stores/petArtwork';
const pet=reactive(createPetWindow());
const artwork=ref<HTMLElement|null>(null);
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
const label=computed(()=>`班班${pet.snapshot?.pendingCandidateCount?'，有待确认事项':''}。右击或按菜单键打开操作，可拖动。${pet.error||''}`);
const policy=()=>({reducedMotion:reduced.matches,pageVisible:document.visibilityState==='visible',keyboardFocused:document.hasFocus()&&document.activeElement===artwork.value&&Boolean(artwork.value?.matches(':focus-visible'))});
function updatePolicy(){void pet.setPolicy(policy());}
function keydown(event:KeyboardEvent){
 if(event.key==='ContextMenu'||(event.shiftKey&&event.key==='F10')||event.key==='Enter'||event.key===' '){event.preventDefault();void pet.openMenu(true);}
}
async function pointerdown(event:PointerEvent){if(event.button===0&&event.buttons===1){event.preventDefault();if(await pet.setPolicy({...policy(),keyboardFocused:false}))void pet.startDrag();}}
function painted(signal?:AbortSignal){
 return nextTick().then(()=>new Promise<void>(resolve=>{
  if(signal?.aborted){resolve();return;}
  let frame=0;const stop=()=>{cancelAnimationFrame(frame);signal?.removeEventListener('abort',stop);resolve();};
  signal?.addEventListener('abort',stop,{once:true});frame=requestAnimationFrame(()=>{frame=requestAnimationFrame(stop);});
 }));
}
let stopFocus:undefined|(()=>void);
watch(()=>pet.view.visible,visible=>{if(!visible)(document.activeElement as HTMLElement|null)?.blur?.();});
onMounted(()=>{
 document.documentElement.dataset.desktopWindow='pet';
 reduced.addEventListener('change',updatePolicy);document.addEventListener('visibilitychange',updatePolicy);
 const focus=()=>{updatePolicy();void pet.refresh();};window.addEventListener('focus',focus);window.addEventListener('blur',updatePolicy);stopFocus=()=>{window.removeEventListener('focus',focus);window.removeEventListener('blur',updatePolicy);};
 void pet.start({mask:petMask,paint:painted},policy());
});
onUnmounted(()=>{pet.dispose();stopFocus?.();reduced.removeEventListener('change',updatePolicy);document.removeEventListener('visibilitychange',updatePolicy);delete document.documentElement.dataset.desktopWindow;});
</script>
<template>
<main class="desktop-pet" :data-pose="pet.pose" :data-motion="pet.motion" :data-edge="pet.view.edge" :data-collapsed="pet.view.collapsed" :data-ready="pet.presentationReady">
 <div ref="artwork" class="pet-artwork" role="button" tabindex="0" aria-haspopup="menu" :aria-expanded="pet.view.menuOpen" :aria-label="label" :title="pet.error||'右击班班打开操作'" :style="{left:`${pet.view.artworkLeft}px`,top:`${pet.view.artworkTop}px`}" @focus="updatePolicy" @blur="updatePolicy" @pointerdown="pointerdown" @contextmenu.prevent="pet.openMenu()" @keydown="keydown">
  <div class="pet-glyph" aria-hidden="true"><div class="pet-drawing" v-html="petArtwork[pet.pose]"/><span v-if="pet.hasPending&&pet.pose!=='found'" class="pet-pending"/></div>
 </div>
 <span class="pet-status" role="status" aria-live="polite">{{pet.error}}</span>
</main>
</template>
<style>
html[data-desktop-window="pet"],html[data-desktop-window="pet"] body{background:transparent;overflow:hidden;width:192px;height:192px}
</style>
<style scoped>
.desktop-pet{position:relative;width:192px;height:192px;overflow:hidden;user-select:none;-webkit-user-select:none}.pet-artwork{position:absolute;width:112px;height:112px;cursor:grab;touch-action:none}.pet-artwork:active{cursor:grabbing}.pet-artwork:focus-visible{outline:2px solid var(--amber);outline-offset:-8px;border-radius:50%}.pet-glyph{position:relative;width:112px;height:112px;pointer-events:none}.pet-pending{position:absolute;left:72px;top:77px;width:8px;height:11px;background:var(--amber);border:1px solid var(--ivory);border-radius:1px}.pet-pending::after{content:"";position:absolute;left:2px;right:1px;top:3px;height:1px;background:var(--ivory)}.pet-glyph :deep(svg){display:block;width:112px;height:112px;overflow:hidden}.desktop-pet[data-edge="right"] .pet-glyph{transform:scaleX(-1)}.pet-status{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.desktop-pet[data-motion="idle"] :deep(.pet-eyes){transform-box:fill-box;transform-origin:center;animation:pet-blink 7.6s linear infinite}.desktop-pet[data-motion="idle"] :deep(.pet-buttons){transform-box:fill-box;transform-origin:center;animation:pet-breathe 4.8s ease-in-out infinite}.desktop-pet[data-motion="found"] :deep(.pet-detail){animation:pet-found 720ms ease-out 1;transform-box:fill-box;transform-origin:center}.desktop-pet[data-motion="done"] :deep(.pet-detail){stroke-dasharray:44;animation:pet-done 850ms ease-out 1}.desktop-pet[data-motion="none"] :deep(*){animation:none!important}
@keyframes pet-blink{0%,44%,48%,100%{transform:scaleY(1)}46%{transform:scaleY(.12)}}@keyframes pet-breathe{0%,100%{transform:translateY(0)}50%{transform:translateY(-1.5px)}}@keyframes pet-found{0%,100%{opacity:1}35%{opacity:.25}}@keyframes pet-done{from{stroke-dashoffset:44}to{stroke-dashoffset:0}}
@media(prefers-reduced-motion:reduce){.desktop-pet :deep(*){animation:none!important}}
</style>
