<script setup lang="ts" generic="T extends string|number|null">
import {computed,h,nextTick,onMounted,onUnmounted,ref,useAttrs,useId,watch,watchPostEffect} from 'vue';
import {Select as TSelect} from 'tdesign-vue-next';
import Icon from '../Icon.vue';
import {useControl,useDisabled,type SelectOption} from './control';

defineOptions({inheritAttrs:false});
const props=withDefaults(defineProps<{modelValue:T;options:SelectOption[];disabled?:boolean;searchable?:boolean;placeholder?:string}>(),{placeholder:'请选择'});
const emit=defineEmits<{'update:modelValue':[value:T];change:[value:T]}>();
const attrs=useAttrs(),disabled=useDisabled(props),{root}=useControl(attrs);
const popupId='select-'+useId().replace(/[^A-Za-z0-9_-]/g,'-');
const open=ref(false),query=ref(''),activeValue=ref<string|number|null>(null),search=ref<HTMLInputElement>();
const filtered=computed(()=>{
 const matching=props.options.filter(option=>`${option.label} ${option.description||''} ${option.group||''}`.toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase()));
 const rows:(SelectOption|SelectOption[])[]=[],groups=new Map<string,SelectOption[]>();
 for(const option of matching){if(!option.group){rows.push(option);continue;}if(!groups.has(option.group)){const group:SelectOption[]=[];groups.set(option.group,group);rows.push(group);}groups.get(option.group)!.push(option);}
 return rows.flat();
});
const enabled=computed(()=>filtered.value.filter(option=>!option.disabled));
let mounted=false,generation=0,frame=0,observer:MutationObserver|undefined,owner:HTMLDialogElement|undefined;
const key=(value:string|number)=>`${typeof value}:${value}`;
function attach(){return root.value?.closest('dialog')||document.body;}
function available(){return mounted&&!!root.value?.isConnected&&!!root.value.getClientRects().length&&(!owner||owner.open);}
function overlay(){return document.querySelector<HTMLElement>('.'+popupId);}
function trigger(){return root.value?.querySelector<HTMLInputElement>('input');}
function cleanup(){generation++;cancelAnimationFrame(frame);observer?.disconnect();observer=undefined;owner?.removeEventListener('close',ownerClosed);owner=undefined;}
function ownerClosed(){visible(false);}
function sync(){
 if(!mounted)return;
 if(open.value&&!available()){visible(false);return;}
 const input=trigger(),panel=overlay(),list=panel?.querySelector<HTMLElement>('.t-select__dropdown-inner');
 const options=panel?.querySelectorAll<HTMLElement>('.t-select-option')||[];
 let activeId='';
 options.forEach((option,index)=>{
  const marker=option.querySelector<HTMLElement>('[data-sk-option-key]');
  const active=activeValue.value!==null&&marker?.dataset.skOptionKey===key(activeValue.value);
  option.id=`${popupId}-${index}`;option.setAttribute('role','option');
  option.setAttribute('aria-selected',String(option.classList.contains('t-is-selected')));
  option.setAttribute('aria-disabled',String(option.classList.contains('t-is-disabled')));
  option.dataset.skActive=String(active);if(active)activeId=option.id;
 });
 if(list){list.id=popupId;list.setAttribute('role','listbox');panel?.querySelectorAll('.t-select__list').forEach(list=>list.setAttribute('role','presentation'));}
 panel?.querySelectorAll<HTMLElement>('.t-select-option-group').forEach(group=>{group.setAttribute('role','group');group.setAttribute('aria-label',group.querySelector('.t-select-option-group__header')?.textContent||'');group.querySelector('ul')?.setAttribute('role','presentation');});
 for(const focus of [input,search.value]){
  if(!focus)continue;
  focus.setAttribute('role','combobox');focus.setAttribute('aria-expanded',String(open.value));focus.setAttribute('aria-haspopup','listbox');
  if(open.value&&list)focus.setAttribute('aria-controls',popupId);else focus.removeAttribute('aria-controls');
  if(open.value&&activeId&&document.activeElement===focus)focus.setAttribute('aria-activedescendant',activeId);else focus.removeAttribute('aria-activedescendant');
 }
}
function settle(focusSearch=false){
 const ticket=generation;
 void nextTick(()=>{
  if(ticket!==generation||!open.value||!available())return;
  sync();
  if(focusSearch){let attempts=0;const focus=()=>{if(ticket!==generation||!open.value||!available())return;if(search.value?.isConnected&&search.value.getClientRects().length){search.value.focus();sync();if(document.activeElement===search.value)return;}if(attempts++<8)frame=requestAnimationFrame(focus);};focus();}
 });
}
function visible(value:boolean){
 if(value===open.value)return;
 cleanup();open.value=value;
 if(!value){query.value='';activeValue.value=null;sync();return;}
 if(disabled.value||!available()){open.value=false;return;}
 query.value='';activeValue.value=enabled.value.find(option=>Object.is(option.value,props.modelValue))?.value??enabled.value[0]?.value??null;
 owner=root.value?.closest('dialog')||undefined;owner?.addEventListener('close',ownerClosed);
 observer=new MutationObserver(sync);observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class','style','hidden','open']});
 settle(props.searchable);
}
function choose(value:unknown){
 const option=props.options.find(option=>Object.is(option.value,value));
 if(disabled.value||!option||option.disabled)return;
 emit('update:modelValue',option.value as T);emit('change',option.value as T);visible(false);trigger()?.focus();
}
function move(direction:number,edge?:'first'|'last'){
 const items=enabled.value;if(!items.length){activeValue.value=null;sync();return;}
 const current=items.findIndex(option=>Object.is(option.value,activeValue.value));
 const index=edge==='first'?0:edge==='last'?items.length-1:current<0?(direction>0?0:items.length-1):(current+direction+items.length)%items.length;
 activeValue.value=items[index].value;settle();
 void nextTick(()=>{if(open.value&&available())overlay()?.querySelector('[data-sk-active=true]')?.scrollIntoView({block:'nearest'});});
}
function keyboard(event:KeyboardEvent,fromSearch=false){
 if(disabled.value||event.isComposing||event.keyCode===229||event.metaKey||event.ctrlKey||event.altKey)return;
 if(fromSearch&&['Home','End'].includes(event.key))return;
 if(event.key==='Tab'){if(open.value){event.stopPropagation();visible(false);if(fromSearch)trigger()?.focus();}return;}
 if(event.key==='Escape'){if(open.value){event.preventDefault();event.stopPropagation();visible(false);trigger()?.focus();}return;}
 const navigation=['ArrowDown','ArrowUp','Home','End'].includes(event.key),selection=event.key==='Enter'||(!fromSearch&&event.key===' ');
 if(!navigation&&!selection)return;
 if(!open.value&&['Home','End'].includes(event.key))return;
 event.preventDefault();event.stopPropagation();
 if(!open.value){visible(true);return;}
 if(selection){if(activeValue.value!==null)choose(activeValue.value);return;}
 move(event.key==='ArrowUp'?-1:1,event.key==='Home'?'first':event.key==='End'?'last':undefined);
}
function content(option:SelectOption){return ()=>h('span',{class:'sk-select-option-body','data-sk-option-key':key(option.value),onMouseenter:()=>{if(!option.disabled){activeValue.value=option.value;settle();}}},[
 h('span',{class:'sk-select-option-copy'},[h('span',{class:'sk-select-option-label'},option.label),option.description?h('small',{class:'sk-select-option-description'},option.description):null]),
 Object.is(option.value,props.modelValue)?h(Icon,{name:'check'}):null,
]);}
const options=computed(()=>{
 const out:({value:string|number;label:string;disabled?:boolean;content:ReturnType<typeof content>}|{group:string;children:unknown[]})[]=[],groups=new Map<string,unknown[]>();
 for(const option of filtered.value){const item={...option,content:content(option)};if(!option.group){out.push(item);continue;}if(!groups.has(option.group)){const children:unknown[]=[];groups.set(option.group,children);out.push({group:option.group,children});}groups.get(option.group)!.push(item);}
 return out;
});
watch(query,()=>{activeValue.value=enabled.value[0]?.value??null;settle();});
watch(enabled,items=>{if(open.value&&!items.some(item=>Object.is(item.value,activeValue.value))){activeValue.value=items[0]?.value??null;settle();}});
watch(disabled,value=>{if(value)visible(false);});
watchPostEffect(sync);onMounted(()=>{mounted=true;sync();});onUnmounted(()=>{mounted=false;cleanup();});
</script>
<template><div ref="root" class="sk-control sk-select" :class="attrs.class" @keydown.capture="keyboard($event)"><TSelect :value="modelValue===null?undefined:modelValue" :options="options" :popup-visible="open" :disabled="disabled" :filterable="false" :input-props="{readonly:true,value:props.options.find(option=>Object.is(option.value,modelValue))?.label||''}" :placeholder="placeholder" :status="attrs['aria-invalid']?'error':'default'" :popup-props="{attach,destroyOnClose:true,overlayClassName:'sk-select-popup '+popupId,zIndex:6000,popperOptions:{strategy:'fixed'}}" empty="没有匹配项目" @change="choose" @popup-visible-change="visible"><template #panelTopContent><div v-if="searchable" class="sk-select-search"><input ref="search" v-model="query" type="search" aria-label="搜索选项" placeholder="搜索选项…" autocomplete="off" @keydown="keyboard($event,true)" @focus="sync"/></div><span v-if="!filtered.length" class="sk-select-status" role="status">没有匹配项目</span></template></TSelect></div></template>
