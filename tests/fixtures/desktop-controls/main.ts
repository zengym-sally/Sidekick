import {createApp,defineComponent,h,ref} from 'vue';
import {createPinia} from 'pinia';
import DesktopSettingsPanel from '../../../src/components/DesktopSettingsPanel.vue';
import SkSwitch from '../../../src/components/ui/SkSwitch.vue';
import SkFieldset from '../../../src/components/ui/SkFieldset.vue';
import {disabledUpdates} from './api';
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
 ]),h('div',{id:'settings-save-slot',class:'settings-save-host'}),
])});
createApp(app).use(createPinia()).mount('#app');
