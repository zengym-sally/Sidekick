import {createApp,defineComponent,h,ref} from 'vue';
import {createPinia} from 'pinia';
import DesktopSettingsPanel from '../../../src/components/DesktopSettingsPanel.vue';
import SkSwitch from '../../../src/components/ui/SkSwitch.vue';
import SkFieldset from '../../../src/components/ui/SkFieldset.vue';
import SkButton from '../../../src/components/ui/SkButton.vue';
import Icon from '../../../src/components/Icon.vue';
import Workbench from '../../../src/components/Workbench.vue';
import {disabledUpdates,buttonEvents} from './api';
import '../../../src/style.css';
import '../../../src/styles/forms.css';
import '../../../src/styles/settings.css';

const common=ref(false);
const app=defineComponent({setup:()=>()=>h('section',{class:'settings-shell',style:{height:'100vh'}},[
 h('div',{class:'settings-scroll'},[
  h('header',{class:'settings-heading'},[h('div',[h('h1','桌面'),h('p','合成浏览器验收：工作模式与启动时的班班。')])]),
  h(DesktopSettingsPanel),
  h('section',{class:'settings-section'},[h('div',{class:'settings-section-label'},[h('h2','公共开关回归')]),h('div',{class:'settings-section-body'},[
   h('div',{class:'catalog-switch-row'},[h('span','合成复用开关'),h(SkSwitch,{modelValue:common.value,label:'合成复用开关','onUpdate:modelValue':(value:boolean)=>common.value=value})]),
   h(SkFieldset,{disabled:true},()=>h(SkSwitch,{modelValue:false,label:'合成禁用开关','onUpdate:modelValue':(value:boolean)=>disabledUpdates.push({label:'合成禁用开关',value})})),
   h(SkFieldset,{disabled:true},()=>h(SkSwitch,{modelValue:true,label:'合成禁用开启开关','onUpdate:modelValue':(value:boolean)=>disabledUpdates.push({label:'合成禁用开启开关',value})})),
  ])]),
  h('section',{id:'button-gallery',class:'settings-section'},[h('h2','按钮排版回归'),h('div',{style:{display:'flex',flexWrap:'wrap',gap:'12px'}},[
   h(SkButton,{id:'button-before',kind:'entry',onClick:()=>buttonEvents.push('before')},()=>[h(Icon,{name:'plus'}),'记录一条']),
   h(SkButton,{id:'button-after',kind:'entry'},()=>['继续',h(Icon,{name:'arrow'})]),
   h(SkButton,{id:'button-plain',kind:'entry'},()=>'记录一条'),
   h(SkButton,{id:'button-badge',kind:'entry'},()=>[h(Icon,{name:'plus'}),'快速录入',h('kbd','⌘ K')]),
   h(SkButton,{id:'button-disabled',disabled:true,onClick:()=>buttonEvents.push('disabled')},()=>[h(Icon,{name:'plus'}),'不可操作']),
   h(SkButton,{id:'button-loading',loading:true,onClick:()=>buttonEvents.push('loading')},()=>'正在保存'),
   h('div',{class:'catalog-object-actions'},[h(SkButton,{id:'button-compact',kind:'entry'},()=>[h(Icon,{name:'plus'}),'紧凑操作'])]),
  ])]),
 ]),h('div',{id:'settings-save-slot',class:'settings-save-host'}),
])});
createApp(new URLSearchParams(location.search).get('surface')==='workbench'?Workbench:app).use(createPinia()).mount('#app');
